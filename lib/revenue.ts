import { money, round2, sum, ZERO, toNumber, type Money, type MoneyInput } from "./money";

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
 * TAHSILAT EKSENI (FAZ 2 · Sıra 3): `collected` ödeme defterinden
 * (`CustomerPayment.paymentDate`) gelir — satışın gününden DEĞİL. Böylece
 * dünkü veresiye satışın bugünkü tahsilatı bugünün kasasına girer ve dünün
 * raporu geriye dönük değişmez.
 *
 * PARA TİPİ (FAZ 2 · Sıra 9a): Hesap Decimal ile yapılır, sonuç `number`
 * olarak döner. Bu dosya veritabanına erişmez; girdi olarak Decimal de
 * `number` de kabul eder, çıktısı daima sunuma hazır `number`'dır.
 */

/** İptal edilmiş satış durumu. */
export const VOIDED_STATUS = "VOIDED";

/** Ciro hesabı için gereken asgari satış alanları. */
export type RevenueSale = {
  saleStatus: string;
  /** Hizmetin liste (etiket) fiyatı. İndirim bundan türetilir. */
  listedPrice?: MoneyInput;
  saleAmount: MoneyInput;
  paidAmount: MoneyInput;
  remainingAmount: MoneyInput;
  barberShare: MoneyInput;
  businessShare: MoneyInput;
  paymentMethod: string;
};

/** Ciro hesabı için gereken asgari gider alanları. */
export type RevenueExpense = { amount: MoneyInput };

/**
 * Tahsilat kaydı (ödeme defteri satırı).
 *
 * Tahsilat, paranın ALINDIĞI güne yazılır — satışın gününe değil. Dünkü
 * veresiye satışın bugün yapılan ödemesi bugünün kasasına girer ve dünün
 * raporu geriye dönük değişmez.
 */
export type RevenuePayment = { amount: MoneyInput; paymentMethod: string };

export type RevenueSummary = {
  /**
   * Toplam Liste Fiyatı — indirim uygulanmadan önceki tutar.
   *
   * `listedPrice` kaydedilmemiş (0) satışlarda satış tutarının kendisi
   * kullanılır: liste fiyatı bilinmiyorken indirim iddia edilemez.
   */
  listedTotal: number;
  /**
   * Toplam İndirim = Liste Fiyatı − Gerçekleşen Ciro.
   *
   * Üç rakam daima birbirini tutar: `listedTotal − discount = realizedRevenue`.
   * Liste fiyatının üstünde satış yapıldıysa negatif çıkar; bu bilinçli olarak
   * gizlenmez.
   */
  discount: number;
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

  let realizedRevenue = ZERO;
  let listedTotal = ZERO;
  let credit = ZERO;
  let barberShare = ZERO;
  let businessShare = ZERO;

  for (const sale of active) {
    realizedRevenue = realizedRevenue.plus(money(sale.saleAmount));
    // Liste fiyatı kaydedilmemişse (0) satış tutarı esas alınır — aksi hâlde
    // eski kayıtlar tüm tutar kadar "indirim" gibi görünürdü.
    const liste = money(sale.listedPrice ?? 0);
    listedTotal = listedTotal.plus(liste.greaterThan(0) ? liste : money(sale.saleAmount));
    credit = credit.plus(money(sale.remainingAmount));
    barberShare = barberShare.plus(money(sale.barberShare));
    businessShare = businessShare.plus(money(sale.businessShare));
  }

  // Tahsilat ödeme defterinden — tahsil edildiği güne yazılır.
  let collected = ZERO;
  const byMethodDecimal: Record<string, Money> = {};
  for (const payment of payments) {
    collected = collected.plus(money(payment.amount));
    const onceki = byMethodDecimal[payment.paymentMethod] ?? ZERO;
    byMethodDecimal[payment.paymentMethod] = round2(onceki.plus(money(payment.amount)));
  }

  const byMethod: Record<string, number> = {};
  for (const [k, v] of Object.entries(byMethodDecimal)) byMethod[k] = toNumber(v);

  const totalExpenses = sum(expenses.map((e) => e.amount));

  const listedRounded = round2(listedTotal);
  const realizedRounded = round2(realizedRevenue);

  return {
    listedTotal: toNumber(listedRounded),
    discount: toNumber(round2(listedRounded.minus(realizedRounded))),
    realizedRevenue: toNumber(realizedRounded),
    collected: toNumber(round2(collected)),
    credit: toNumber(round2(credit)),
    barberShare: toNumber(round2(barberShare)),
    businessShare: toNumber(round2(businessShare)),
    expenses: toNumber(round2(totalExpenses)),
    netCash: toNumber(round2(collected.minus(money(totalExpenses)))),
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
  barberCommissionRate: MoneyInput;
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

type BarberAccumulator = {
  barberId: string;
  barberName: string;
  workerType: string;
  commissionRate: Money;
  count: number;
  realizedRevenue: Money;
  paidOnSales: Money;
  credit: Money;
  barberShare: Money;
  businessShare: Money;
};

/** Berber bazlı ciro kırılımı — Gün Sonu ve Hakedişler aynı sonucu görür. */
export function summarizeByBarber(sales: BarberRevenueSale[]): BarberRevenueRow[] {
  const map = new Map<string, BarberAccumulator>();

  for (const sale of activeSales(sales)) {
    let row = map.get(sale.barberId);
    if (!row) {
      row = {
        barberId: sale.barberId,
        barberName: sale.barberName,
        workerType: sale.barberWorkerType,
        commissionRate: money(sale.barberCommissionRate),
        count: 0,
        realizedRevenue: ZERO,
        paidOnSales: ZERO,
        credit: ZERO,
        barberShare: ZERO,
        businessShare: ZERO,
      };
      map.set(sale.barberId, row);
    }
    row.count += 1;
    row.realizedRevenue = row.realizedRevenue.plus(money(sale.saleAmount));
    row.paidOnSales = row.paidOnSales.plus(money(sale.paidAmount));
    row.credit = row.credit.plus(money(sale.remainingAmount));
    row.barberShare = row.barberShare.plus(money(sale.barberShare));
    row.businessShare = row.businessShare.plus(money(sale.businessShare));
  }

  return Array.from(map.values()).map((row) => ({
    barberId: row.barberId,
    barberName: row.barberName,
    workerType: row.workerType,
    commissionRate: toNumber(row.commissionRate),
    count: row.count,
    realizedRevenue: toNumber(round2(row.realizedRevenue)),
    paidOnSales: toNumber(round2(row.paidOnSales)),
    credit: toNumber(round2(row.credit)),
    barberShare: toNumber(round2(row.barberShare)),
    businessShare: toNumber(round2(row.businessShare)),
  }));
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
  appointments: { status: string; appointmentPrice: MoneyInput }[]
): number {
  return toNumber(
    round2(sum(appointments.filter((a) => a.status === "completed").map((a) => a.appointmentPrice)))
  );
}
