import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/dal";
import { calcStatus } from "@/lib/sale";
import { acquireAdvisoryLock, SALE_PAYMENT_LOCK } from "@/lib/advisory-lock";
import { money, round2, toNumber, serializeMoney, serializeSale } from "@/lib/money";
import { moneyAmount } from "@/lib/money-schema";
import { idempotencyKeySchema, isIdempotencyConflict, normalizeKey } from "@/lib/idempotency";

const schema = z.object({
  saleId: z.string().min(1),
  customerId: z.string().optional().nullable(),
  amount: moneyAmount.positive(),
  paymentMethod: z.enum(["CASH", "CARD", "TRANSFER", "OTHER"]).default("CASH"),
  note: z.string().optional().nullable(),
  idempotencyKey: idempotencyKeySchema,
});

/**
 * Aynı satışa, aynı tutarda, aynı yöntemle gelen ikinci isteği mükerrer sayan
 * pencere. Çift tıklama ve istek tekrarı bu aralığa düşer; gerçek ikinci bir
 * tahsilat ise birkaç saniye sonra girilebilir.
 *
 * Not: Kesin idempotency (istemciden gelen benzersiz anahtar) yeni bir DB alanı
 * ve unique index gerektirir. Bu pencere, migration'sız elde edilebilecek en
 * güçlü koruma; kalan borç kontrolüyle birlikte tam ödemenin tekrarını zaten
 * kesin olarak engeller.
 */
const MUKERRER_PENCERE_MS = 10_000;

export async function POST(req: NextRequest) {
  const unauthorized = await requireAdmin();
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Geçersiz veri." }, { status: 400 });

  const { saleId, amount, paymentMethod, note } = parsed.data;
  const idempotencyKey = normalizeKey(parsed.data.idempotencyKey);
  const customerId = parsed.data.customerId ?? null;

  // Tüm kontrol ve yazma işlemi TEK transaction içinde, satış bazlı advisory
  // lock altında yapılır. Kilitsiz hâlde satış "oku → hesapla → yaz" arasında
  // ikinci bir istek araya giriyor ve ödeme defteri ile sale.paidAmount
  // birbirinden kopuyordu (FAZ 2 · Sıra 6).
  const outcome = await calistir().catch(async (e) => {
    // Advisory lock ayni satis icin yarisi zaten serilestirir; bu yakalama
    // farkli satislara ayni anahtarla gelen es zamanli istekler icindir.
    // Unique index son sozu soyler, kod ona guvenir.
    if (!isIdempotencyConflict(e) || !idempotencyKey) throw e;
    const payment = await db.customerPayment.findUnique({ where: { idempotencyKey } });
    if (!payment) throw e;
    const sale = payment.saleId ? await db.sale.findUnique({ where: { id: payment.saleId } }) : null;
    return { kind: "replay" as const, payment, sale };
  });

  function calistir() {
    return db.$transaction(
    async (tx) => {
      await acquireAdvisoryLock(tx, SALE_PAYMENT_LOCK, saleId);

      // Ayni anahtarla kayit zaten varsa istek TEKRARIDIR: yeni bir tahsilat
      // yazilmaz, var olan kayit geri dondurulur (FAZ 2 · Sira 9b).
      if (idempotencyKey) {
        const varOlan = await tx.customerPayment.findUnique({ where: { idempotencyKey } });
        if (varOlan) {
          const iliskiliSatis = await tx.sale.findUnique({ where: { id: varOlan.saleId ?? saleId } });
          return { kind: "replay" as const, payment: varOlan, sale: iliskiliSatis };
        }
      }

      const sale = await tx.sale.findUnique({ where: { id: saleId } });
      if (!sale) return { kind: "not_found" as const };
      if (sale.saleStatus === "VOIDED") return { kind: "voided" as const };

      const kalan = round2(money(sale.saleAmount).minus(sale.paidAmount));

      if (kalan.lessThanOrEqualTo(0)) {
        return { kind: "no_debt" as const };
      }

      // Kalan borçtan fazlası SESSİZCE KIRPILMAZ; istek reddedilir ve
      // hiçbir veri değişmez.
      if (round2(amount).greaterThan(kalan)) {
        return { kind: "too_much" as const, kalan: toNumber(kalan) };
      }

      // Mükerrer istek koruması — kilit altında okunur, yarışa açık değildir.
      //
      // Istemci ACIK BIR ANAHTAR gonderdiyse bu sezgisel atlanir: anahtar
      // "bu istek sudur" demenin kesin yoludur ve tekrar kontrolu zaten
      // yukarida yapildi. Pencereyi burada da uygulamak, ayni tutarda MESRU
      // ikinci bir tahsilati yanlislikla reddederdi (FAZ 2 · Sira 9b).
      const pencereBasi = new Date(Date.now() - MUKERRER_PENCERE_MS);
      const ayni = idempotencyKey ? null : await tx.customerPayment.findFirst({
        where: {
          saleId,
          amount: round2(amount),
          paymentMethod,
          createdAt: { gte: pencereBasi },
        },
        select: { id: true, createdAt: true },
      });
      if (ayni) {
        return { kind: "duplicate" as const, paymentId: ayni.id };
      }

      const yeniOdenen = round2(money(sale.paidAmount).plus(amount));
      const yeniKalan = round2(money(sale.saleAmount).minus(yeniOdenen));

      const payment = await tx.customerPayment.create({
        data: { customerId, saleId, amount: round2(amount), paymentMethod, note: note ?? null, idempotencyKey },
      });
      const updatedSale = await tx.sale.update({
        where: { id: saleId },
        data: {
          paidAmount: yeniOdenen,
          remainingAmount: yeniKalan,
          saleStatus: calcStatus(yeniOdenen, sale.saleAmount),
        },
      });

      return { kind: "created" as const, payment, sale: updatedSale };
    },
    { maxWait: 5_000, timeout: 15_000 }
    );
  }

  switch (outcome.kind) {
    case "not_found":
      return Response.json({ error: "Satış bulunamadı." }, { status: 404 });
    case "voided":
      return Response.json({ error: "İptal edilmiş satışa ödeme yapılamaz." }, { status: 400 });
    case "no_debt":
      return Response.json(
        { error: "Bu satışın kalan borcu yok; tahsilat kaydedilmedi.", code: "NO_REMAINING_DEBT" },
        { status: 400 }
      );
    case "too_much":
      return Response.json(
        {
          error: `Kalan borç ${outcome.kalan.toFixed(2)} ₺. Daha fazlası tahsil edilemez.`,
          code: "EXCEEDS_REMAINING",
          remainingAmount: outcome.kalan,
        },
        { status: 400 }
      );
    case "replay":
      // Idempotent tekrar: islem zaten yapilmis. Hata degil, "tamam" denir.
      return Response.json(
        {
          payment: serializeMoney(outcome.payment, ["amount"]),
          sale: outcome.sale ? serializeSale(outcome.sale) : null,
          idempotent: true,
        },
        { status: 200 }
      );
    case "duplicate":
      return Response.json(
        {
          error:
            "Aynı tutarda bir tahsilat az önce kaydedildi. Mükerrer kayıt olmasın diye bu istek işlenmedi. " +
            "Gerçekten ikinci bir tahsilat ise birkaç saniye sonra tekrar deneyin.",
          code: "DUPLICATE_PAYMENT",
          paymentId: outcome.paymentId,
        },
        { status: 409 }
      );
    default:
      return Response.json(
        { payment: serializeMoney(outcome.payment, ["amount"]), sale: serializeSale(outcome.sale) },
        { status: 201 }
      );
  }
}
