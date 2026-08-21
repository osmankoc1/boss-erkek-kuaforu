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
 *   Tahsilat        (collected)        = Σ ödeme defteri → o gün alınan para
 *   Veresiye        (credit)           = Σ remainingAmount → henüz alınmayan
 *   Net Kasa        (netCash)          = collected − expenses
 *
 * Veresiye satışta ciro tam yazılır, tahsilat kısmi kalır; ikisi eşit olmak
 * zorunda değildir. VOID satışlar hiçbirine girmez.
 *
 * Bu dosya bilinçli olarak saftır: veritabanı veya Next.js bağımlılığı yoktur.
 * Veriyi toplamak çağıranın işidir; kural burada tek yerde durur.
 *
 * TAHSILAT EKSENI (FAZ 2 · Sıra 3): `collected` ödeme defterinden
 * (`CustomerPayment.paymentDate`) gelir — satışın gününden DEĞİL. Böylece
 * dünkü veresiye satışın bugünkü tahsilatı bugünün kasasına girer ve dünün
 * raporu geriye dönük değişmez.
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

/**
 * Tahsilat kaydı (ödeme defteri satırı).
 *
 * Tahsilat, paranın ALINDIĞI güne yazılır — satışın gününe değil. Dünkü
 * veresiye satışın bugün yapılan ödemesi bugünün kasasına girer ve dünün
 * raporu geriye dönük değişmez.
 */
export type RevenuePayment = { amount: number; paymentMethod: string };

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
 * Bir tarih aralığındaki ciro özetini üretir.
 *
 * İKİ AYRI ZAMAN EKSENİ (FAZ 2 · Sıra 3):
 *   `sales`    → o aralıkta YAPILAN satışlar (saleDate). Ciro ve veresiye
 *                buradan gelir.
 *   `payments` → o aralıkta ALINAN paralar (paymentDate). Tahsilat ve ödeme
 *                yöntemi kırılımı buradan gelir.
 * İkisi aynı aralık için farklı kayıtları kapsayabilir; veresiye satışta
 * zaten kapsar.
 *
 * Kasa, Gün Sonu ve Dashboard aynı aralık için bu fonksiyonu çağırdığında
 * birebir aynı rakamı görür.
 */
export function summarizeRevenue(input: {
  sales: RevenueSale[];
  payments: RevenuePayment[];
  expenses?: RevenueExpense[];
}): RevenueSummary {
  const { sales, payments, expenses = [] } = input;
  const active = activeSales(sales);

  let realizedRevenue = 0;
  let credit = 0;
  let barberShare = 0;
  let businessShare = 0;

  for (const sale of active) {
    realizedRevenue += sale.saleAmount;
    credit += sale.remainingAmount;
    barberShare += sale.barberShare;
    businessShare += sale.businessShare;
  }

  // Tahsilat ödeme defterinden — tahsil edildiği güne yazılır.
  let collected = 0;
  const byMethod: Record<string, number> = {};
  for (const payment of payments) {
    collected += payment.amount;
    byMethod[payment.paymentMethod] = round2((byMethod[payment.paymentMethod] ?? 0) + payment.amount);
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
  /** Bu berberin satışlarının şu ana kadar ödenmiş kısmı (tarih ekseni YOK). */
  paidOnSales: number;
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
        paidOnSales: 0,
        credit: 0,
        barberShare: 0,
        businessShare: 0,
      };
      map.set(sale.barberId, row);
    }
    row.count += 1;
    row.realizedRevenue += sale.saleAmount;
    row.paidOnSales += sale.paidAmount;
    row.credit += sale.remainingAmount;
    row.barberShare += sale.barberShare;
    row.businessShare += sale.businessShare;
  }

  for (const row of map.values()) {
    row.realizedRevenue = round2(row.realizedRevenue);
    row.paidOnSales = round2(row.paidOnSales);
    row.credit = round2(row.credit);
    row.barberShare = round2(row.barberShare);
    row.businessShare = round2(row.businessShare);
  }

  return Array.from(map.values());
}

/**
 * Bir tahsilatın gerçekleşen tahsilata sayılıp sayılmayacağı.
 *
 * VOID edilmiş satışın ödemeleri sayılmaz — satış ciroya girmediği gibi
 * tahsilatı da girmez. (VOID sonrası paranın iadesi/mahsubu ayrı bir iştir;
 * bkz. FAZ 2 · Sıra 5.)
 */
export function isCollectablePayment(payment: { sale?: { saleStatus: string } | null }): boolean {
  return !payment.sale || payment.sale.saleStatus !== VOIDED_STATUS;
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
