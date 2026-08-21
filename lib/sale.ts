import { startOfIstanbulDay, endOfIstanbulDay } from "./tz";

export function calcShares(
  saleAmount: number,
  workerType: string,
  commissionRate: number
): { barberShare: number; businessShare: number } {
  const barberShare =
    workerType === "COMMISSION"
      ? Math.round(saleAmount * (commissionRate / 100) * 100) / 100
      : 0;
  return { barberShare, businessShare: Math.round((saleAmount - barberShare) * 100) / 100 };
}

export function calcStatus(paidAmount: number, saleAmount: number): string {
  if (paidAmount >= saleAmount) return "PAID";
  if (paidAmount > 0) return "PARTIAL";
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
