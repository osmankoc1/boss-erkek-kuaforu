import { startOfIstanbulDay, endOfIstanbulDay } from "./tz";
import { money, round2, ZERO, type Money, type MoneyInput } from "./money";

/**
 * Berber payı ve işletme payı (FAZ 2 · Sıra 9a: Decimal).
 *
 * İşletme payı çıkarmayla bulunur (`saleAmount − barberShare`); böylece iki
 * pay her zaman satış tutarına TAM eşit olur, yuvarlama artığı kaybolmaz.
 */
export function calcShares(
  saleAmount: MoneyInput,
  workerType: string,
  commissionRate: MoneyInput
): { barberShare: Money; businessShare: Money } {
  const tutar = money(saleAmount);
  const barberShare =
    workerType === "COMMISSION" ? round2(tutar.times(money(commissionRate)).dividedBy(100)) : ZERO;
  return { barberShare, businessShare: round2(tutar.minus(barberShare)) };
}

/**
 * Satış durumu.
 *
 * Karşılaştırma Decimal metotlarıyla yapılır: `>=` operatörü Decimal
 * nesnesini sayıya zorlar ve büyük değerlerde hassasiyet kaybeder.
 */
export function calcStatus(paidAmount: MoneyInput, saleAmount: MoneyInput): string {
  const odenen = money(paidAmount);
  if (odenen.greaterThanOrEqualTo(money(saleAmount))) return "PAID";
  if (odenen.greaterThan(0)) return "PARTIAL";
  return "CREDIT";
}

/**
 * Kasa/rapor gun sinirlari — Europe/Istanbul.
 *
 * Onceden `setHours(0,0,0,0)` ile sunucunun yerel saatine gore kuruluyordu;
 * Vercel UTC calistigi icin bir "gun" 03:00 Istanbul'da basliyordu. Artik
 * sinirlar `lib/tz.ts` uzerinden acikca Istanbul takvimine gore hesaplanir.
 *
 * Metin girdi ("YYYY-MM-DD") dogrudan takvim gunu sayilir; boylece cagiranin
 * `new Date(dateString)` ile UTC gece yarisina cevirmesi gerekmez.
 */
export function startOfDay(d: Date | string): Date {
  return startOfIstanbulDay(d);
}

export function endOfDay(d: Date | string): Date {
  return endOfIstanbulDay(d);
}
