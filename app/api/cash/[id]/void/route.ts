import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/dal";
import { recalculateCustomerCounters } from "@/lib/customer-counters";

const schema = z.object({
  voidReason: z.string().optional().nullable(),
});

/**
 * Satış iptali (void) — yan etkileriyle birlikte geri alır (FAZ 2 · Sıra 5).
 *
 * Satış oluşturulurken dört yan etki doğar; void bunların hepsini geri almalı:
 *   1. appointment.status = "completed"      → `confirmed`'a döner
 *   2. customer.completedCount += 1          → azaltılır (0'ın altına inmez)
 *   3. customer.lastVisitAt = saleDate       → kalan kayıtlardan yeniden hesaplanır
 *   4. CustomerPayment (tahsilat kaydı)      → void gününe TERS KAYIT yazılır
 *
 * ÜRÜN KARARLARI (kullanıcıya soruldu):
 *   • Randevu `confirmed`'a döner: void "bu kayıt hiç olmamış gibi olsun"
 *     demektir. Böylece randevu Beklenen Gelir'den düşer, Dashboard'daki
 *     "kasa kaydı eksik" uyarısına girer ve doğru tutarla yeniden satış
 *     girilebilir.
 *   • Para ters kayıtla iade edilir ve kayıt VOID GÜNÜNE yazılır. Dünkü
 *     satışın bugün void edilmesi dünün kapanmış raporunu DEĞİŞTİRMEZ;
 *     para bugünün kasasından düşer. (Bkz. FAZ 2 · Sıra 3 — aynı ilke.)
 *
 * `sale.paidAmount` bilerek DEĞİŞTİRİLMEZ: iptal edilen satışın tarihsel
 * kaydıdır ve Kasa listesinde ne iptal edildiğini gösterir. Nakit akışı
 * gerçeği ödeme defterindedir; orada net 0'a iner.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireAdmin();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);

  const existing = await db.sale.findUnique({ where: { id } });
  if (!existing) return Response.json({ error: "Satış bulunamadı." }, { status: 404 });
  if (existing.saleStatus === "VOIDED") return Response.json({ error: "Zaten iptal edilmiş." }, { status: 400 });

  const voidedAt = new Date();
  const voidReason = parsed.success ? (parsed.data.voidReason ?? null) : null;

  const sale = await db.$transaction(async (tx) => {
    const updated = await tx.sale.update({
      where: { id },
      data: { saleStatus: "VOIDED", voidedAt, voidReason },
    });

    // 1) Randevu durumu geri alınır.
    if (existing.appointmentId) {
      await tx.appointment.updateMany({
        where: { id: existing.appointmentId, status: "completed" },
        data: { status: "confirmed" },
      });
    }

    // 2 + 3) Sayaclar ve son ziyaret gercek kayitlardan yeniden hesaplanir.
    // Randevu yukarida 'confirmed'a dondugu ve bu satis VOIDED oldugu icin
    // recompute dogru sonucu uretir; ayri bir düşürme mantigi gerekmez
    // (FAZ 2 · Sira 7).
    if (existing.customerId) {
      await recalculateCustomerCounters(tx, existing.customerId);
    }

    // 4) Tahsil edilmiş para void gününe ters kayıtla iade edilir.
    const odemeler = await tx.customerPayment.findMany({
      where: { saleId: id },
      select: { amount: true },
    });
    const netTahsilat = Math.round(odemeler.reduce((s, p) => s + p.amount, 0) * 100) / 100;
    if (netTahsilat !== 0) {
      await tx.customerPayment.create({
        data: {
          customerId: existing.customerId,
          saleId: id,
          amount: -netTahsilat,
          paymentMethod: existing.paymentMethod,
          paymentDate: voidedAt,
          note: "Satış iptali (void) — tahsilat iadesi",
        },
      });
    }

    return updated;
  });

  return Response.json({ sale });
}
