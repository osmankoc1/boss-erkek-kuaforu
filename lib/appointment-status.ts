/**
 * Randevu durum makinesi — TEK doğruluk kaynağı.
 *
 * Burada olmayan her geçiş yasaktır. Kural hem `PATCH /api/appointments/[id]`
 * hem de `POST /api/cash` tarafından kullanılır; ikisi ayrı ayrı yazıldığında
 * kasa tarafı makineyi bypass ediyordu (FAZ 2 · Sıra 4).
 */

/**
 * İzin verilen durum geçişleri.
 *
 * - `completed` uçtur: kasa kaydı oluşmuş olabilir, iptali para tutarsızlığı
 *   yaratır. Yanlış satış için kasa tarafındaki void akışı kullanılmalıdır.
 * - `cancelled` uçtur: geri alınmaz. Müşteri yeniden randevu almalıdır —
 *   böylece slot doğrulaması (Faz 1 · Sıra 5–8) yeniden çalışır.
 */
export const ALLOWED_TRANSITIONS: Record<string, readonly string[]> = {
  pending_verification: ["cancelled"],
  pending: ["confirmed", "cancelled"],
  confirmed: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

/**
 * Kasa kaydı açılabilecek randevu durumları.
 *
 * ÜRÜN KARARI (FAZ 2 · Sıra 4):
 *   confirmed → normal akış; kasa kaydı randevuyu `completed` yapar.
 *   completed → BİLEREK izinli. Dashboard'daki "N tamamlanan randevunun kasa
 *               kaydı eksik" uyarısı tam olarak bu akışı bekler. Mükerrer
 *               satış ayrıca 409 ile engellenir.
 *
 * İzinli OLMAYANLAR ve gerekçeleri:
 *   pending              → önce onaylanmalı; onaysız randevu doğrudan
 *                          tamamlanmış sayılamaz.
 *   pending_verification → e-postası hiç doğrulanmamış; 24 saat içinde cron
 *                          iptal ediyor. Müşteri gerçekten geldiyse randevusuz
 *                          (walk-in) satış girilmelidir.
 *   cancelled            → uç durum, geri dönüşü yok. Kasa üzerinden
 *                          `completed` yapmak hem durum makinesini deler hem
 *                          de müşteri sayaçlarını iki kez saydırır.
 */
export const CASH_ELIGIBLE_STATUSES = ["confirmed", "completed"] as const;

export type CashEligibleStatus = (typeof CASH_ELIGIBLE_STATUSES)[number];

/** Bu durumdaki bir randevu için kasa kaydı açılabilir mi? */
export function canCreateSaleFor(status: string): boolean {
  return (CASH_ELIGIBLE_STATUSES as readonly string[]).includes(status);
}

/** Reddedilen duruma göre kullanıcıya gösterilecek açıklama. */
export function cashRejectionMessage(status: string): string {
  switch (status) {
    case "cancelled":
      return "İptal edilmiş bir randevu için kasa kaydı açılamaz. Müşteri geldiyse randevusuz satış girin.";
    case "pending":
      return "Bu randevu henüz onaylanmadı. Önce randevuyu onaylayın, sonra kasaya girin.";
    case "pending_verification":
      return "Bu randevunun e-postası doğrulanmadı. Müşteri geldiyse randevusuz satış girin.";
    default:
      return `"${status}" durumundaki bir randevu için kasa kaydı açılamaz.`;
  }
}
