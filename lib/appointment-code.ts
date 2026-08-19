/**
 * Randevu kodu — müşterinin randevusuna erişmek için kullandığı kısa anahtar.
 *
 * Kod, randevu id'sinin (cuid) son 8 karakteridir. Ayrı bir alan tutulmadığı
 * için şema değişikliği gerektirmez; onay sayfasında ve e-postalarda bu
 * biçimde gösterilir.
 *
 * Tek başına bir sır değildir: id'yi bilen kodu da türetebilir. Asıl koruma,
 * kodun her zaman telefon numarasıyla BİRLİKTE doğrulanmasıdır — bkz.
 * `GET /api/appointments` ve `PATCH /api/appointments/[id]`.
 */

/** Karşılaştırma için normalize edilmiş kod (küçük harf). */
export function appointmentCode(appointmentId: string): string {
  return appointmentId.slice(-8).toLowerCase();
}

/** Müşteriye gösterilen biçim (büyük harf). */
export function displayAppointmentCode(appointmentId: string): string {
  return appointmentId.slice(-8).toUpperCase();
}

/** Kullanıcı girdisini karşılaştırmaya hazırlar; boşluk ve harf durumuna toleranslıdır. */
export function normalizeCodeInput(input: string): string {
  return input.trim().toLowerCase();
}

/** Girilen kod bu randevuya ait mi? */
export function matchesAppointmentCode(appointmentId: string, input: string): boolean {
  const normalized = normalizeCodeInput(input);
  return normalized.length > 0 && normalized === appointmentCode(appointmentId);
}
