/**
 * Hakediş kurallarının TEK doğruluk kaynağı (FAZ 2 · Sıra 8).
 *
 * ─── ÜRÜN KARARI ─────────────────────────────────────────────────────────
 * Hakediş **tahakkuk esaslıdır**: iş yapıldıysa hakediş doğar. Müşterinin
 * parayı ödeyip ödememesi hakedişi etkilemez.
 *
 *   Tahakkuk (accrued)  = Σ Sale.barberShare   (VOID olmayan satışlar)
 *   Ödenen   (paid)     = Σ BarberPayout.amount
 *   Kalan    (remaining)= Tahakkuk − Ödenen
 *
 * "Tahakkuk eden hakediş" ile "berbere gerçekten ödenmiş hakediş" AYRI
 * kavramlardır ve asla tek bir rakamda birleştirilmez.
 *
 * ─── NEDEN TAHAKKUK TABLODA TUTULMUYOR ───────────────────────────────────
 * Tahakkuk satışlardan **türetilir**, ayrı bir sayaçta saklanmaz. Böylece:
 *   • VOID edilen satış tahakkuktan kendiliğinden düşer (ayrı geri alma yok)
 *   • aynı satış iki kez hakediş üretemez (kaynak tek: satış kaydının kendisi)
 *   • walk-in ve randevulu satış aynı kurala tabidir (ikisi de Sale)
 * Bu, FAZ 2 · Sıra 7'deki "sayaç değil, gerçek kayıttan hesapla" ilkesinin
 * aynısıdır.
 *
 * Bu dosya veritabanına ERİŞMEZ ve Next.js'e bağımlı değildir; yalnızca
 * `lib/money.ts` üzerinden Decimal sınıfını kullanır. Girdi olarak Decimal de
 * `number` de kabul eder, çıktısı daima sunuma hazır `number`'dır
 * (FAZ 2 · Sıra 9a).
 */
import { startOfIstanbulDay, endOfIstanbulDay } from "./tz";
import { VOIDED_STATUS, isActiveSale } from "./revenue";
import { money, round2, sum, ZERO, toNumber, type MoneyInput } from "./money";

/**
 * Hakediş ödeme defterini kullanabilen çalışan tipleri.
 *
 * ÜRÜN KARARI: defter YALNIZCA `COMMISSION` için kullanılır.
 *   • `OWNER`        → işletme sahibinin para çekimi bu sistemin konusu değil
 *   • `FIXED_SALARY` → sabit maaş ayrı bir muhasebe akışıdır
 * Bu iki tipin tahakkuku zaten 0'dır (bkz. `calcShares` — lib/sale.ts);
 * onlara "hakediş ödemesi" kaydı açmak kavramı bozardı.
 */
export const PAYOUT_ELIGIBLE_WORKER_TYPES = ["COMMISSION"] as const;

/** Geçerli hakediş ödeme yöntemleri. */
export const PAYOUT_METHODS = ["CASH", "CARD", "TRANSFER", "OTHER"] as const;
export type PayoutMethod = (typeof PAYOUT_METHODS)[number];

/** Bu çalışan tipine hakediş ödemesi kaydedilebilir mi? */
export function canReceivePayout(workerType: string): boolean {
  return (PAYOUT_ELIGIBLE_WORKER_TYPES as readonly string[]).includes(workerType);
}

/** Reddedilen çalışan tipi için kullanıcıya gösterilecek gerekçe. */
export function payoutRejectionMessage(workerType: string): string {
  if (workerType === "OWNER") {
    return "İşletme sahibi için hakediş ödemesi kaydedilemez; sahip para çekimi bu defterin konusu değildir.";
  }
  if (workerType === "FIXED_SALARY") {
    return "Sabit maaşlı çalışan için hakediş ödemesi kaydedilemez; maaş ayrı bir muhasebe akışıdır.";
  }
  return "Bu çalışan tipi için hakediş ödemesi kaydedilemez; yalnızca yüzdeli (COMMISSION) çalışanlar hakediş alır.";
}

/** Tahakkuk hesabı için gereken asgari satış alanları. */
export type PayoutAccrualSale = { saleStatus: string; barberShare: MoneyInput };

/** Ödeme defteri satırının hesap için gereken asgari alanı. */
export type PayoutRecord = { amount: MoneyInput };

/**
 * Tahakkuk eden hakediş — VOID satışlar sayılmaz.
 *
 * Hesap Decimal ile yapılır, sonuç sunuma hazır `number` döner
 * (FAZ 2 · Sıra 9a).
 */
export function accruedShare(sales: PayoutAccrualSale[]): number {
  let toplam = ZERO;
  for (const s of sales) if (isActiveSale(s)) toplam = toplam.plus(money(s.barberShare));
  return toNumber(round2(toplam));
}

/** Berbere fiilen ödenmiş toplam. */
export function paidOut(payouts: PayoutRecord[]): number {
  return toNumber(round2(sum(payouts.map((p) => p.amount))));
}

/**
 * Kalan hakediş = tahakkuk − ödenen.
 *
 * Negatif çıkabilir ve bu bilinçli olarak GİZLENMEZ: ödendikten sonra bir
 * satış VOID edilirse berbere fazla ödenmiş olur. Rakamı sıfıra kırpmak
 * gerçeği saklardı; ekran bunu "fazla ödenmiş" olarak gösterir.
 */
export function remainingPayout(accrued: MoneyInput, paid: MoneyInput): number {
  return toNumber(round2(round2(accrued).minus(round2(paid))));
}

export type PayoutSummary = { accrued: number; paid: number; remaining: number };

/** Bir berberin tahakkuk / ödenen / kalan üçlüsü. */
export function summarizePayout(input: {
  sales: PayoutAccrualSale[];
  payouts: PayoutRecord[];
}): PayoutSummary {
  const accrued = accruedShare(input.sales);
  const paid = paidOut(input.payouts);
  return { accrued, paid, remaining: remainingPayout(accrued, paid) };
}

export type PeriodResult =
  | { ok: true; periodStart: Date; periodEnd: Date }
  | { ok: false; error: string };

/**
 * Ödeme dönemini doğrular ve Istanbul gün sınırlarına oturtur.
 *
 * Dönem ZORUNLUDUR: her hakediş ödemesinin hangi çalışma dönemine ait olduğu
 * açıkça kaydedilir. `periodStart <= periodEnd` şartı aranır.
 *
 * Sınırlar `lib/tz.ts` üzerinden Europe/Istanbul takvimine göre kurulur;
 * sunucunun `TZ` değerine bağlı değildir (FAZ 2 · Sıra 1).
 */
export function resolvePeriod(startInput: string, endInput: string): PeriodResult {
  const gunDeseni = /^\d{4}-\d{2}-\d{2}$/;
  if (!gunDeseni.test(startInput) || !gunDeseni.test(endInput)) {
    return { ok: false, error: "Dönem tarihleri YYYY-AA-GG biçiminde olmalıdır." };
  }

  const periodStart = startOfIstanbulDay(startInput);
  const periodEnd = endOfIstanbulDay(endInput);

  if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) {
    return { ok: false, error: "Dönem tarihleri geçersiz." };
  }
  if (periodStart.getTime() > periodEnd.getTime()) {
    return { ok: false, error: "Dönem başlangıcı bitişinden sonra olamaz." };
  }

  return { ok: true, periodStart, periodEnd };
}

/** VOID satışları tahakkuk dışında bırakan Prisma filtresi. */
export const ACTIVE_SALE_FILTER = { saleStatus: { not: VOIDED_STATUS } } as const;
