import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/dal";
import { acquireAdvisoryLock, BARBER_PAYOUT_LOCK } from "@/lib/advisory-lock";
import {
  ACTIVE_SALE_FILTER,
  PAYOUT_METHODS,
  canReceivePayout,
  payoutRejectionMessage,
  remainingPayout,
  resolvePeriod,
} from "@/lib/payout";
import { buildCommissionReport } from "@/lib/commission-report";
import { money, round2, toNumber, serializeMoney } from "@/lib/money";
import { moneyAmount } from "@/lib/money-schema";

/**
 * Hakediş ödeme defteri (FAZ 2 · Sıra 8).
 *
 * Bu uç nokta yalnızca **ödenen** parayı kaydeder. Hakedişin DOĞMASI ayrı bir
 * olaydır ve satış kaydından türetilir; buraya hiçbir tahakkuk yazılmaz.
 */

const schema = z.object({
  barberId: z.string().min(1),
  amount: moneyAmount.positive(),
  paymentMethod: z.enum(PAYOUT_METHODS).default("CASH"),
  periodStart: z.string().min(1),
  periodEnd: z.string().min(1),
  note: z.string().max(500).optional().nullable(),
});

/**
 * Çift tıklama / istek tekrarı penceresi.
 *
 * Aynı berbere, aynı tutarda, aynı dönem için gelen ikinci istek bu aralıkta
 * mükerrer sayılır. Kesin idempotency (istemciden benzersiz anahtar) yeni bir
 * alan ve unique index — yani ikinci bir migration — gerektirir; bu bilinçli
 * olarak Sıra 9'a bırakıldı. Migration'sız elde edilebilecek en güçlü koruma
 * budur ve kalan hakediş kontrolüyle birlikte fazla ödemeyi zaten kesin
 * olarak engeller: pencere kaçırsa bile ikinci ödeme kalanı aşarsa reddedilir.
 */
const MUKERRER_PENCERE_MS = 10_000;

export async function GET(req: NextRequest) {
  const unauthorized = await requireAdmin();
  if (unauthorized) return unauthorized;

  const { searchParams } = req.nextUrl;
  const report = await buildCommissionReport({
    range: searchParams.get("range"),
    from: searchParams.get("from"),
    to: searchParams.get("to"),
  });

  const barberId = searchParams.get("barberId");
  return Response.json({
    payouts: barberId ? report.payouts.filter((p) => p.barberId === barberId) : report.payouts,
    commissions: barberId ? report.commissions.filter((c) => c.barberId === barberId) : report.commissions,
    range: report.range,
    dateFrom: report.dateFrom,
    dateTo: report.dateTo,
  });
}

export async function POST(req: NextRequest) {
  const unauthorized = await requireAdmin();
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Geçersiz veri." }, { status: 400 });

  const { barberId, amount, paymentMethod, note } = parsed.data;

  // Dönem ZORUNLU ve tutarlı olmalı. Zod `strip` semantiği sayesinde istemciden
  // gelen `payoutDate` gibi fazladan alanlar sessizce atılır; ödeme tarihini
  // daima sunucu koyar.
  const period = resolvePeriod(parsed.data.periodStart, parsed.data.periodEnd);
  if (!period.ok) {
    return Response.json({ error: period.error, code: "INVALID_PERIOD" }, { status: 400 });
  }

  // Kontrol ve yazma TEK transaction içinde, berber bazlı advisory lock
  // altında. Kilitsiz hâlde iki eşzamanlı istek aynı kalanı okuyup ikisi de
  // geçerli sayılır ve kalan negatife düşerdi.
  const outcome = await db.$transaction(
    async (tx) => {
      await acquireAdvisoryLock(tx, BARBER_PAYOUT_LOCK, barberId);

      const barber = await tx.barber.findUnique({
        where: { id: barberId },
        select: { id: true, name: true, workerType: true },
      });
      if (!barber) return { kind: "not_found" as const };

      // Defter yalnızca COMMISSION için. OWNER / FIXED_SALARY reddedilir.
      if (!canReceivePayout(barber.workerType)) {
        return { kind: "not_eligible" as const, workerType: barber.workerType };
      }

      // Tahakkuk kilit altında, tüm zamanlar üzerinden yeniden hesaplanır —
      // saklanan bir sayaçtan okunmaz. VOID edilmiş satış zaten dışarıdadır.
      const [accrualAgg, paidAgg] = await Promise.all([
        tx.sale.aggregate({ where: { barberId, ...ACTIVE_SALE_FILTER }, _sum: { barberShare: true } }),
        tx.barberPayout.aggregate({ where: { barberId }, _sum: { amount: true } }),
      ]);
      const accrued = toNumber(round2(accrualAgg._sum.barberShare ?? 0));
      const paid = toNumber(round2(paidAgg._sum.amount ?? 0));
      const kalan = remainingPayout(accrued, paid);

      if (kalan <= 0) return { kind: "no_remaining" as const, accrued, paid, kalan };

      // Kalanın üstü SESSİZCE KIRPILMAZ; istek reddedilir, hiçbir şey yazılmaz.
      if (round2(amount).greaterThan(kalan)) return { kind: "too_much" as const, accrued, paid, kalan };

      const pencereBasi = new Date(Date.now() - MUKERRER_PENCERE_MS);
      const ayni = await tx.barberPayout.findFirst({
        where: {
          barberId,
          amount: round2(amount),
          periodStart: period.periodStart,
          periodEnd: period.periodEnd,
          createdAt: { gte: pencereBasi },
        },
        select: { id: true },
      });
      if (ayni) return { kind: "duplicate" as const, payoutId: ayni.id };

      const payout = await tx.barberPayout.create({
        data: {
          barberId,
          amount: round2(amount),
          paymentMethod,
          periodStart: period.periodStart,
          periodEnd: period.periodEnd,
          note: note ?? null,
          // payoutDate bilinçli olarak verilmez: şema varsayılanı (now())
          // devreye girer. Geçmişe ödeme tarihi girilemez; geçmiş dönem
          // periodStart/periodEnd ile ifade edilir.
        },
      });

      return {
        kind: "created" as const,
        payout,
        summary: {
          accrued,
          paid: toNumber(round2(money(paid).plus(amount))),
          remaining: remainingPayout(accrued, round2(money(paid).plus(amount))),
        },
      };
    },
    { maxWait: 5_000, timeout: 15_000 }
  );

  switch (outcome.kind) {
    case "not_found":
      return Response.json({ error: "Çalışan bulunamadı." }, { status: 404 });
    case "not_eligible":
      return Response.json(
        { error: payoutRejectionMessage(outcome.workerType), code: "WORKER_TYPE_NOT_ELIGIBLE" },
        { status: 400 }
      );
    case "no_remaining":
      return Response.json(
        {
          error:
            outcome.kalan < 0
              ? `Bu çalışana zaten ${Math.abs(outcome.kalan).toFixed(2)} ₺ fazla ödenmiş; yeni ödeme kaydedilemez.`
              : "Bu çalışanın kalan hakedişi yok; ödeme kaydedilmedi.",
          code: "NO_REMAINING_PAYOUT",
          accrued: outcome.accrued,
          paid: outcome.paid,
          remaining: outcome.kalan,
        },
        { status: 400 }
      );
    case "too_much":
      return Response.json(
        {
          error: `Kalan hakediş ${outcome.kalan.toFixed(2)} ₺. Daha fazlası ödenemez.`,
          code: "EXCEEDS_REMAINING_PAYOUT",
          accrued: outcome.accrued,
          paid: outcome.paid,
          remaining: outcome.kalan,
        },
        { status: 400 }
      );
    case "duplicate":
      return Response.json(
        {
          error:
            "Aynı tutarda ve aynı döneme ait bir hakediş ödemesi az önce kaydedildi. " +
            "Mükerrer kayıt olmasın diye bu istek işlenmedi. Gerçekten ikinci bir ödeme ise " +
            "birkaç saniye sonra tekrar deneyin.",
          code: "DUPLICATE_PAYOUT",
          payoutId: outcome.payoutId,
        },
        { status: 409 }
      );
    default:
      return Response.json(
        { payout: serializeMoney(outcome.payout, ["amount"]), summary: outcome.summary },
        { status: 201 }
      );
  }
}
