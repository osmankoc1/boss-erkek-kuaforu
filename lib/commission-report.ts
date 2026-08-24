import "server-only";
import { db } from "@/lib/db";
import { startOfDay, endOfDay } from "@/lib/sale";
import { addIstanbulDays, startOfIstanbulMonth } from "@/lib/tz";
import { ACTIVE_SALE_FILTER, canReceivePayout, remainingPayout } from "@/lib/payout";

/**
 * Hakediş raporunun TEK üretim yeri (FAZ 2 · Sıra 8).
 *
 * Önce aynı hesap iki yerde ayrı ayrı yazılmıştı: `/api/commissions` içinde
 * bir kez, `/admin/hakedisler` sayfasında bir kez daha. İki kopya zamanla
 * ayrışabilir; ekran ile rapor farklı rakam gösterebilirdi. Artık ikisi de bu
 * fonksiyonu çağırır — tanım gereği aynı sonucu görürler.
 *
 * ─── İKİ AYRI ZAMAN EKSENİ ───────────────────────────────────────────────
 * Tahakkuk satışın gününe (`Sale.saleDate`), ödeme paranın verildiği güne
 * (`BarberPayout.payoutDate`) yazılır. Geçmiş bir dönemin hakedişi bugün
 * ödenirse dünün tahakkuk raporu geriye dönük DEĞİŞMEZ; ödeme bugünün
 * satırında görünür. (Aynı ilke tahsilat için FAZ 2 · Sıra 3'te kuruldu.)
 *
 * Bu yüzden her satır iki eksende de raporlanır:
 *   accrued / paid / periodRemaining   → seçilen dönem
 *   totalAccrued / totalPaid / totalRemaining → tüm zamanlar
 * Her iki eksende de `kalan = tahakkuk − ödenen` denklemi kendi içinde tutar.
 * Borcun gerçek ölçüsü `totalRemaining`'dir; fazla ödeme koruması da onu
 * kullanır (bkz. `app/api/payouts/route.ts`).
 */

export type CommissionRange = {
  range: string;
  dateFrom: Date;
  dateTo: Date;
};

/**
 * Rapor aralığını çözer — Europe/Istanbul takvimine göre (bkz. lib/tz.ts).
 * Sunucunun `TZ` değerine bağlı değildir.
 */
export function resolveCommissionRange(input: {
  range?: string | null;
  from?: string | null;
  to?: string | null;
  now?: Date;
}): CommissionRange {
  const now = input.now ?? new Date();
  const range = input.range ?? "today";

  if (range === "custom" && input.from && input.to) {
    return { range, dateFrom: startOfDay(input.from), dateTo: endOfDay(input.to) };
  }
  if (range === "yesterday") {
    const y = addIstanbulDays(now, -1);
    return { range, dateFrom: startOfDay(y), dateTo: endOfDay(y) };
  }
  if (range === "week") {
    return { range, dateFrom: addIstanbulDays(now, -6), dateTo: endOfDay(now) };
  }
  if (range === "month") {
    return { range, dateFrom: startOfIstanbulMonth(now), dateTo: endOfDay(now) };
  }
  return { range: "today", dateFrom: startOfDay(now), dateTo: endOfDay(now) };
}

export type CommissionRow = {
  barberId: string;
  barberName: string;
  /** Satış anındaki tip (snapshot); satışı olmayan berberde güncel tip. */
  workerType: string;
  commissionRate: number;
  /** Bu berbere hakediş ödemesi kaydedilebilir mi (GÜNCEL çalışan tipi). */
  eligible: boolean;
  count: number;
  totalSale: number;
  businessShare: number;
  creditSale: number;

  // ── Dönem ekseni ───────────────────────────────────────────────────────
  /** Tahakkuk eden hakediş (dönem). Eski adı `barberShare` ile aynı değer. */
  accrued: number;
  /** Geriye dönük uyumluluk için korunan ad — `accrued` ile aynıdır. */
  barberShare: number;
  /** Bu dönemde berbere ÖDENEN hakediş (payoutDate ekseni). */
  paid: number;
  /** Dönem içi kalan = accrued − paid. */
  periodRemaining: number;

  // ── Tüm zamanlar ───────────────────────────────────────────────────────
  totalAccrued: number;
  totalPaid: number;
  /** Berbere hâlâ borçlu olunan tutar. Negatifse fazla ödenmiştir. */
  totalRemaining: number;
};

export type PayoutHistoryRow = {
  id: string;
  barberId: string;
  barberName: string;
  amount: number;
  paymentMethod: string;
  periodStart: string;
  periodEnd: string;
  note: string | null;
  payoutDate: string;
};

export type CommissionReport = CommissionRange & {
  commissions: CommissionRow[];
  payouts: PayoutHistoryRow[];
  totals: {
    totalSale: number;
    accrued: number;
    barberShare: number;
    businessShare: number;
    creditSale: number;
    paid: number;
    periodRemaining: number;
    totalRemaining: number;
  };
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function buildCommissionReport(input: {
  range?: string | null;
  from?: string | null;
  to?: string | null;
  now?: Date;
}): Promise<CommissionReport> {
  const { range, dateFrom, dateTo } = resolveCommissionRange(input);

  const [sales, periodPayouts, lifetimeSales, lifetimePayouts, barbers] = await Promise.all([
    db.sale.findMany({
      where: { saleDate: { gte: dateFrom, lte: dateTo }, ...ACTIVE_SALE_FILTER },
    }),
    db.barberPayout.findMany({
      where: { payoutDate: { gte: dateFrom, lte: dateTo } },
      orderBy: { payoutDate: "desc" },
      include: { barber: { select: { name: true } } },
    }),
    // Tüm zamanlar tahakkuku — VOID satışlar zaten dışarıda.
    db.sale.groupBy({ by: ["barberId"], where: ACTIVE_SALE_FILTER, _sum: { barberShare: true } }),
    db.barberPayout.groupBy({ by: ["barberId"], _sum: { amount: true } }),
    db.barber.findMany({ select: { id: true, name: true, workerType: true, commissionRate: true } }),
  ]);

  const barberById = new Map(barbers.map((b) => [b.id, b]));
  const lifetimeAccruedById = new Map(lifetimeSales.map((g) => [g.barberId, g._sum.barberShare ?? 0]));
  const lifetimePaidById = new Map(lifetimePayouts.map((g) => [g.barberId, g._sum.amount ?? 0]));

  const rows = new Map<string, CommissionRow>();

  function satirAl(barberId: string, fallbackName: string, workerType: string, rate: number): CommissionRow {
    let row = rows.get(barberId);
    if (!row) {
      const guncel = barberById.get(barberId);
      const totalAccrued = r2(lifetimeAccruedById.get(barberId) ?? 0);
      const totalPaid = r2(lifetimePaidById.get(barberId) ?? 0);
      row = {
        barberId,
        barberName: guncel?.name ?? fallbackName,
        workerType,
        commissionRate: rate,
        // Uygunluk GÜNCEL çalışan tipinden belirlenir: ödeme bugün yapılır,
        // geçmişteki bir satışın anlık görüntüsünden değil.
        eligible: canReceivePayout(guncel?.workerType ?? workerType),
        count: 0,
        totalSale: 0,
        businessShare: 0,
        creditSale: 0,
        accrued: 0,
        barberShare: 0,
        paid: 0,
        periodRemaining: 0,
        totalAccrued,
        totalPaid,
        totalRemaining: remainingPayout(totalAccrued, totalPaid),
      };
      rows.set(barberId, row);
    }
    return row;
  }

  for (const s of sales) {
    const row = satirAl(s.barberId, s.barberName, s.barberWorkerType, s.barberCommissionRate);
    row.count += 1;
    row.totalSale += s.saleAmount;
    row.accrued += s.barberShare;
    row.businessShare += s.businessShare;
    if (s.saleStatus !== "PAID") row.creditSale += s.remainingAmount;
  }

  // Dönemde satışı olmayıp ödemesi olan berber de raporda görünmeli; aksi
  // hâlde ödenen para hiçbir satırda yer almaz ve toplamlar tutmaz.
  for (const p of periodPayouts) {
    const guncel = barberById.get(p.barberId);
    const row = satirAl(
      p.barberId,
      p.barber.name,
      guncel?.workerType ?? "COMMISSION",
      guncel?.commissionRate ?? 0
    );
    row.paid += p.amount;
  }

  for (const row of rows.values()) {
    row.totalSale = r2(row.totalSale);
    row.accrued = r2(row.accrued);
    row.barberShare = row.accrued;
    row.businessShare = r2(row.businessShare);
    row.creditSale = r2(row.creditSale);
    row.paid = r2(row.paid);
    row.periodRemaining = r2(row.accrued - row.paid);
  }

  const commissions = Array.from(rows.values()).sort((a, b) => b.accrued - a.accrued);

  const totals = commissions.reduce(
    (acc, c) => ({
      totalSale: r2(acc.totalSale + c.totalSale),
      accrued: r2(acc.accrued + c.accrued),
      barberShare: r2(acc.barberShare + c.accrued),
      businessShare: r2(acc.businessShare + c.businessShare),
      creditSale: r2(acc.creditSale + c.creditSale),
      paid: r2(acc.paid + c.paid),
      periodRemaining: r2(acc.periodRemaining + c.periodRemaining),
      totalRemaining: r2(acc.totalRemaining + c.totalRemaining),
    }),
    { totalSale: 0, accrued: 0, barberShare: 0, businessShare: 0, creditSale: 0, paid: 0, periodRemaining: 0, totalRemaining: 0 }
  );

  const payouts: PayoutHistoryRow[] = periodPayouts.map((p) => ({
    id: p.id,
    barberId: p.barberId,
    barberName: p.barber.name,
    amount: p.amount,
    paymentMethod: p.paymentMethod,
    periodStart: p.periodStart.toISOString(),
    periodEnd: p.periodEnd.toISOString(),
    note: p.note,
    payoutDate: p.payoutDate.toISOString(),
  }));

  return { range, dateFrom, dateTo, commissions, payouts, totals };
}
