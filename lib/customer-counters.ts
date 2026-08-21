import "server-only";
import { db } from "@/lib/db";

/**
 * Müşteri randevu sayaçlarının TEK doğruluk kaynağı (FAZ 2 · Sıra 7).
 *
 * ─── İLKE ────────────────────────────────────────────────────────────────
 * Sayaçlar ayrı bir gerçek değil, gerçek veriden türetilmiş bir ÖNBELLEKTİR.
 * Bu yüzden `increment`/`decrement` yerine her olayda gerçek kayıtlardan
 * YENİDEN HESAPLANIR. Bunun üç sonucu var:
 *
 *   1. İdempotent — aynı olay iki kez işlenirse sayaç iki kez değişmez.
 *   2. Eksiksiz  — silme, birleştirme, cron iptali, void gibi "geri alma"
 *                  akışları için ayrı bir düşürme mantığı yazmak gerekmez.
 *   3. Yarışa dayanıklı — eşzamanlı iki istek de aynı doğru değeri yazar.
 *
 * ─── DEĞİŞMEZLER ─────────────────────────────────────────────────────────
 *   I1  completedCount    == status='completed' randevu adedi
 *   I2  cancelledCount    == status='cancelled' randevu adedi
 *   I3  totalAppointments == mevcut randevu adedi
 *   I4  lastVisitAt       == max(tamamlanmış randevu tarihi,
 *                                iptal edilmemiş satış tarihi) ?? null
 *
 * Bu dosya randevu DURUM MAKİNESİNİ tanımlamaz; o `lib/appointment-status.ts`
 * içindedir ve tek kaynak orasıdır. Burada yalnızca sayım yapılır.
 */

/** Transaction içinde de çalışabilmesi için asgari istemci arayüzü. */
type CounterClient = Pick<typeof db, "appointment" | "sale" | "customer">;

/**
 * Bir müşterinin tüm randevu sayaçlarını gerçek kayıtlardan yeniden hesaplar.
 *
 * Durum geçişiyle aynı transaction içinde çağrılmalıdır; böylece sayaç ile
 * randevu durumu birlikte commit olur ve arada tutarsız bir an oluşmaz.
 */
export async function recalculateCustomerCounters(
  client: CounterClient,
  customerId: string
): Promise<void> {
  const [total, completed, cancelled, sonRandevu, sonSatis] = await Promise.all([
    client.appointment.count({ where: { customerId } }),
    client.appointment.count({ where: { customerId, status: "completed" } }),
    client.appointment.count({ where: { customerId, status: "cancelled" } }),
    client.appointment.findFirst({
      where: { customerId, status: "completed" },
      orderBy: { date: "desc" },
      select: { date: true },
    }),
    client.sale.findFirst({
      where: { customerId, saleStatus: { not: "VOIDED" } },
      orderBy: { saleDate: "desc" },
      select: { saleDate: true },
    }),
  ]);

  const adaylar = [sonRandevu?.date, sonSatis?.saleDate].filter((d): d is Date => !!d);
  const lastVisitAt = adaylar.length ? new Date(Math.max(...adaylar.map((d) => d.getTime()))) : null;

  await client.customer.update({
    where: { id: customerId },
    data: {
      totalAppointments: total,
      completedCount: completed,
      cancelledCount: cancelled,
      lastVisitAt,
    },
  });
}

/** Birden çok müşteri için sırayla yeniden hesaplar (cron, birleştirme). */
export async function recalculateManyCustomerCounters(
  client: CounterClient,
  customerIds: string[]
): Promise<void> {
  for (const id of new Set(customerIds)) {
    await recalculateCustomerCounters(client, id);
  }
}
