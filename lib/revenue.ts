/**
 * Ciro hesaplamasının TEK doğruluk kaynağı (FAZ 2 · Sıra 2).
 *
 * ÜRÜN KARARI:
 *   `Sale` kayıtları **Gerçekleşen Ciro** için tek kaynaktır.
 *   `Appointment.appointmentPrice` ciro DEĞİLDİR; randevu tabanlı toplam
 *   ayrı bir metriktir ve **Beklenen Gelir** adıyla gösterilir.
 *
 * KAVRAMLAR — birbirine karıştırılmamalı:
 *   Gerçekleşen Ciro (realizedRevenue) = Σ saleAmount   → yapılan işin tutarı
 *   Tahsilat        (collected)        = Σ paidAmount   → kasaya giren para
 *   Veresiye        (credit)           = Σ remainingAmount → henüz alınmayan
 *   Net Kasa        (netCash)          = collected − expenses
 *
 * Veresiye satışta ciro tam yazılır, tahsilat kısmi kalır; ikisi eşit olmak
 * zorunda değildir. VOID satışlar hiçbirine girmez.
 *
 * Bu dosya bilinçli olarak saftır: veritabanı veya Next.js bağımlılığı yoktur.
 * Veriyi toplamak çağıranın işidir; kural burada tek yerde durur.
 *
 * NOT (Sıra 3'ün konusu): `collected` şu an satışın `paidAmount` alanından
 * gelir, yani tahsilat satışın gününe yazılır. Veresiye tahsilatının gerçek
 * tahsil gününe taşınması ayrı bir iştir; bu dosyanın imzası o değişikliği
 * kaldıracak şekilde tasarlandı.
 */

/** İptal edilmiş satış durumu. */
export const VOIDED_STATUS = "VOIDED";

/** Ciro hesabı için gereken asgari satış alanları. */
export type RevenueSale = {
  saleStatus: string;
  saleAmount: number;
  paidAmount: number;
  remainingAmount: number;
  barberShare: number;
  businessShare: number;
  paymentMethod: string;
};

/** Ciro hesabı için gereken asgari gider alanları. */
export type RevenueExpense = { amount: number };

export type RevenueSummary = {
  /** Gerçekleşen Ciro — yapılan işin tutarı (VOID hariç). */
  realizedRevenue: number;
  /** Tahsilat — kasaya giren para. */
  collected: number;
  /** Veresiye — henüz tahsil edilmemiş kalan. */
  credit: number;
  barberShare: number;
  businessShare: number;
  expenses: number;
  /** Net Kasa = Tahsilat − Gider. */
  netCash: number;
  /** Ödeme yöntemine göre tahsilat kırılımı. */
  byMethod: Record<string, number>;
  /** Geçerli (VOID olmayan) satış adedi. */
  count: number;
  /** İptal edilmiş satış adedi. */
  voidedCount: number;
};

/** Satış gerçekleşen ciroya sayılır mı? */
export function isActiveSale(sale: Pick<RevenueSale, "saleStatus">): boolean {
  return sale.saleStatus !== VOIDED_STATUS;
}

/** VOID olmayan satışlar. */
export function activeSales<T extends Pick<RevenueSale, "saleStatus">>(sales: T[]): T[] {
  return sales.filter(isActiveSale);
}

/** Kuruş hassasiyetinde toplama (Float birikimini sınırlar). */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Bir tarih aralığındaki satış ve giderlerden ciro özetini üretir.
 *
 * Kasa, Gün Sonu ve Dashboard aynı aralık için bu fonksiyonu çağırdığında
 * birebir aynı rakamı görür.
 */
export function summarizeRevenue(
  sales: RevenueSale[],
  expenses: RevenueExpense[] = []
): RevenueSummary {
  const active = activeSales(sales);

  let realizedRevenue = 0;
  let collected = 0;
  let credit = 0;
  let barberShare = 0;
  let businessShare = 0;
  const byMethod: Record<string, number> = {};

  for (const sale of active) {
    realizedRevenue += sale.saleAmount;
    collected += sale.paidAmount;
    credit += sale.remainingAmount;
    barberShare += sale.barberShare;
    businessShare += sale.businessShare;
    byMethod[sale.paymentMethod] = round2((byMethod[sale.paymentMethod] ?? 0) + sale.paidAmount);
  }

  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);

  return {
    realizedRevenue: round2(realizedRevenue),
    collected: round2(collected),
    credit: round2(credit),
    barberShare: round2(barberShare),
    businessShare: round2(businessShare),
    expenses: round2(totalExpenses),
    netCash: round2(collected - totalExpenses),
    byMethod,
    count: active.length,
    voidedCount: sales.length - active.length,
  };
}

/** Berber bazlı kırılım için gereken ek alanlar. */
export type BarberRevenueSale = RevenueSale & {
  barberId: string;
  barberName: string;
  barberWorkerType: string;
  barberCommissionRate: number;
};

export type BarberRevenueRow = {
  barberId: string;
  barberName: string;
  workerType: string;
  commissionRate: number;
  count: number;
  /** Gerçekleşen Ciro (bu berber). */
  realizedRevenue: number;
  collected: number;
  credit: number;
  barberShare: number;
  businessShare: number;
};

/** Berber bazlı ciro kırılımı — Gün Sonu ve Hakedişler aynı sonucu görür. */
export function summarizeByBarber(sales: BarberRevenueSale[]): BarberRevenueRow[] {
  const map = new Map<string, BarberRevenueRow>();

  for (const sale of activeSales(sales)) {
    let row = map.get(sale.barberId);
    if (!row) {
      row = {
        barberId: sale.barberId,
        barberName: sale.barberName,
        workerType: sale.barberWorkerType,
        commissionRate: sale.barberCommissionRate,
        count: 0,
        realizedRevenue: 0,
        collected: 0,
        credit: 0,
        barberShare: 0,
        businessShare: 0,
      };
      map.set(sale.barberId, row);
    }
    row.count += 1;
    row.realizedRevenue += sale.saleAmount;
    row.collected += sale.paidAmount;
    row.credit += sale.remainingAmount;
    row.barberShare += sale.barberShare;
    row.businessShare += sale.businessShare;
  }

  for (const row of map.values()) {
    row.realizedRevenue = round2(row.realizedRevenue);
    row.collected = round2(row.collected);
    row.credit = round2(row.credit);
    row.barberShare = round2(row.barberShare);
    row.businessShare = round2(row.businessShare);
  }

  return Array.from(map.values());
}

/**
 * Beklenen Gelir — randevu tabanlı potansiyel.
 *
 * Bu bir CİRO DEĞİLDİR: kasa kaydı girilmemiş olabilir, tutar kasada
 * değişmiş olabilir, satış void edilmiş ama randevu `completed` kalmış
 * olabilir. Yalnızca "randevulardan beklenen tutar" anlamına gelir ve
 * ekranlarda bu adla gösterilmelidir.
 */
export function expectedRevenue(
  appointments: { status: string; appointmentPrice: number }[]
): number {
  return round2(
    appointments
      .filter((a) => a.status === "completed")
      .reduce((sum, a) => sum + a.appointmentPrice, 0)
  );
}
