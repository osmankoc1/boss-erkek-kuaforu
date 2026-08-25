import { NextRequest } from "next/server";
import { writeAudit } from "@/lib/audit";
import { adminActor } from "@/lib/audit-actor";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/dal";
import { recalculateCustomerCounters } from "@/lib/customer-counters";
import { money, round2, serializeSale, ZERO, type Money } from "@/lib/money";

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

  const actor = await adminActor();

  const sale = await db.$transaction(async (tx) => {
    const updated = await tx.sale.update({
      where: { id },
      data: { saleStatus: "VOIDED", voidedAt, voidReason },
    });

    // 1) Randevu durumu geri alınır.
    if (existing.appointmentId) {
      const geri = await tx.appointment.updateMany({
        where: { id: existing.appointmentId, status: "completed" },
        data: { status: "confirmed" },
      });
      // Yalnizca gercekten geri alindiysa kaydedilir.
      if (geri.count > 0) {
        await writeAudit(tx, {
          entity: "Appointment",
          entityId: existing.appointmentId,
          action: "STATUS_CHANGE",
          actor,
          changes: { status: { before: "completed", after: "confirmed" } },
        });
      }
    }

    // 2 + 3) Sayaclar ve son ziyaret gercek kayitlardan yeniden hesaplanir.
    // Randevu yukarida 'confirmed'a dondugu ve bu satis VOIDED oldugu icin
    // recompute dogru sonucu uretir; ayri bir düşürme mantigi gerekmez
    // (FAZ 2 · Sira 7).
    if (existing.customerId) {
      await recalculateCustomerCounters(tx, existing.customerId);
    }

    // 4) Tahsil edilmiş para void gününe ters kayıtla iade edilir.
    //
    // Ters kayıt ÖDEME YÖNTEMİ BAZINDA üretilir (FAZ 2 · Sıra 10). Önceden
    // tek satır yazılıyor ve tamamı satışın `paymentMethod` alanına
    // yükleniyordu; toplam doğru çıkıyor ama yöntem kırılımı bozuluyordu:
    //
    //   100 NAKİT + 200 KART tahsilat, tek satır -300 NAKİT ters kayıt
    //   → CASH -200 (kasadan hiç 200 çıkmadı), CARD +200 (iade görünmüyor)
    //
    // Artık satışın gerçek tahsilat satırları yönteme göre gruplanır ve her
    // yöntem kendi netini ters kayıtla kapatır. Gün sonunda "bugün kartla ne
    // aldık" sorusu doğru cevaplanır.
    const odemeler = await tx.customerPayment.findMany({
      where: { saleId: id },
      select: { amount: true, paymentMethod: true },
    });

    const yontemNet = new Map<string, Money>();
    for (const p of odemeler) {
      yontemNet.set(p.paymentMethod, (yontemNet.get(p.paymentMethod) ?? ZERO).plus(money(p.amount)));
    }

    for (const [yontem, ham] of yontemNet) {
      const net = round2(ham);
      // Nette sıfırlanmış yöntem için ters kayıt gerekmez.
      if (net.isZero()) continue;
      await tx.customerPayment.create({
        data: {
          customerId: existing.customerId,
          saleId: id,
          amount: net.negated(),
          paymentMethod: yontem,
          paymentDate: voidedAt,
          note: "Satış iptali (void) — tahsilat iadesi",
        },
      });
    }

    // Denetim izi — ayni transaction (FAZ 2 · Sira 10b).
    await writeAudit(tx, {
      entity: "Sale",
      entityId: id,
      action: "VOID",
      actor,
      changes: {
        saleStatus: { before: existing.saleStatus, after: "VOIDED" },
        voidReason: { before: null, after: voidReason ?? null },
        saleAmount: { before: String(existing.saleAmount), after: String(existing.saleAmount) },
      },
    });

    return updated;
  });

  return Response.json({ sale: serializeSale(sale) });
}
