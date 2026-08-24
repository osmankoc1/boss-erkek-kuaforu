import Decimal from "decimal.js";

/**
 * Para aritmetiğinin TEK katmanı (FAZ 2 · Sıra 9a).
 *
 * ─── NEDEN ───────────────────────────────────────────────────────────────
 * Tutarlar `Float` (DOUBLE PRECISION) olarak saklanıyor ve JS'te
 * `Math.round(n * 100) / 100` ile yuvarlanıyordu. İki ayrı kusur vardı:
 *
 *   0.07 x 1000 birikimi  = 69.99999999999966   (70 olmalı)
 *   Math.round(1.005*100)/100 = 1.00            (1.01 olmalı)
 *   Math.round(8.165*100)/100 = 8.16            (8.17 olmalı)
 *
 * `.xx5` sınırında aşağı yuvarlama, ikili kayan noktada 8.165'in aslında
 * 8.16499999... olarak saklanmasından geliyordu. Kuruş kaybı küçüktü ama
 * sistematikti ve daima aynı yöne (berber aleyhine) kayıyordu.
 *
 * ─── KURAL ───────────────────────────────────────────────────────────────
 * Decimal YALNIZCA veritabanı, Prisma ve hesaplama katmanında yaşar.
 * API yanıtlarında ve Client Component prop'larında **daima `number`'a
 * çevrilir** — bu dosyadaki `toNumber` / `serializeMoney` ile.
 *
 * Bu sınır isteğe bağlı değildir: Next.js bir Decimal nesnesini Client
 * Component'e geçirmeyi reddeder ve değeri SESSİZCE boşaltır (sayfa 200
 * döner, tutar kaybolur):
 *
 *   "Only plain objects can be passed to Client Components from Server
 *    Components. Decimal objects are not supported."
 *
 * `Response.json` ise Decimal'i **string**'e çevirir ve sondaki sıfırı
 * düşürür (`1234.50` → `"1234.5"`), bu da istemcideki `.toFixed(2)`
 * çağrılarını patlatır. İki durumda da dönüşüm zorunludur.
 *
 * ─── NEDEN `decimal.js`, Prisma'nın Decimal'i DEĞİL ──────────────────────
 * Bu dosya bilinçli olarak SAFTIR: Prisma'ya bağımlı değildir. İlk sürümü
 * Prisma'nın Decimal sınıfını kullanıyordu ve `lib/revenue.ts` üzerinden bir
 * Client Component'e sızarak tüm sayfaları 500'e düşürdü:
 *
 *   KasaClient.tsx → lib/revenue.ts → lib/money.ts → @prisma/client runtime
 *   "the chunking context does not support external modules (node:module)"
 *
 * `revenue.ts`'in tarayıcıda da çalışabilmesi FAZ 2 · Sıra 2'de bilinçli
 * olarak kurulmuş bir özellikti. Prisma'nın kendi kullandığı `decimal.js`
 * doğrudan kullanılarak bu özellik korunuyor. Prisma, decimal.js örneklerini
 * yazmada, `where` filtresinde ve `aggregate`'te kabul eder — bu ölçülerek
 * doğrulandı, varsayılmadı.
 */

/** Uygulama genelinde tek Decimal sınıfı (decimal.js). */
export const Money = Decimal;
export type Money = Decimal;

/**
 * Para değeri olarak kabul edilen girdi tipleri.
 *
 * Prisma satırından gelen `Decimal`, koddan gelen `number` ve tam hassasiyet
 * gereken yerlerde `string` — üçü de kabul edilir. Böylece hesap fonksiyonları
 * hem DB satırıyla hem düz sayıyla çağrılabilir.
 */
export type MoneyInput = string | number | Decimal | { toString(): string };

/** Kuruş hassasiyeti (ondalık hane). */
export const MONEY_SCALE = 2;

/**
 * Kuruş yuvarlaması — ROUND_HALF_UP.
 *
 * Yarım kuruş YUKARI yuvarlanır: 1.005 → 1.01, 8.165 → 8.17.
 * Eski `Math.round(n*100)/100` kalıbı bunların ikisini de aşağı yuvarlıyordu.
 */
export const ROUND_MODE = Decimal.ROUND_HALF_UP;

export const ZERO = new Decimal(0);

/** Herhangi bir girdiden Decimal üretir. */
export function money(value: MoneyInput): Money {
  if (value instanceof Decimal) return value;
  if (typeof value === "number" || typeof value === "string") return new Decimal(value);
  // Prisma'nın kendi Decimal örneği gibi yabancı ama uyumlu nesneler:
  // metinsel gösterim üzerinden alınır, hassasiyet kaybı olmaz.
  return new Decimal(String(value));
}

/** Kuruşa yuvarlar (ROUND_HALF_UP). Tüm para sonuçları buradan geçer. */
export function round2(value: MoneyInput): Money {
  return money(value).toDecimalPlaces(MONEY_SCALE, ROUND_MODE);
}

/** Toplama — boş dizide 0 döner. */
export function sum(values: MoneyInput[]): Money {
  let total = ZERO;
  for (const v of values) total = total.plus(money(v));
  return total;
}

/** Bir alanın toplamı (kuruşa yuvarlanmış). */
export function sumBy<T>(rows: T[], pick: (row: T) => MoneyInput): Money {
  return round2(sum(rows.map(pick)));
}

/**
 * API yanıtı / Client Component prop'u için `number`'a çevirir.
 *
 * Sunum katmanında `number` bilinçli bir tercihtir: UI'daki mevcut
 * `.toFixed(2)` çağrıları olduğu gibi çalışmaya devam eder ve gösterimde
 * kayan nokta hatasının bir etkisi olmaz — hata yalnızca aritmetikte ve
 * saklamada anlamlıdır, ikisi de artık Decimal.
 */
export function toNumber(value: MoneyInput | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return money(value).toNumber();
}

/** `toNumber` ama null'ı koruyan sürüm. */
export function toNumberOrNull(value: MoneyInput | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return money(value).toNumber();
}

/**
 * Bir nesnedeki verilen para alanlarını `number`'a çevirir.
 *
 * Prisma satırını olduğu gibi `Response.json`'a ya da bir Client
 * Component'e vermeden önce buradan geçirilir.
 */
export function serializeMoney<T extends object, K extends keyof T>(
  row: T,
  fields: readonly K[]
): Omit<T, K> & Record<K, number> {
  const out = { ...row } as Record<string, unknown>;
  for (const f of fields) {
    const v = out[f as string];
    out[f as string] = v === null || v === undefined ? v : toNumber(v as MoneyInput);
  }
  return out as Omit<T, K> & Record<K, number>;
}

/** `Sale` satırındaki para/oran alanları. */
export const SALE_MONEY_FIELDS = [
  "listedPrice",
  "saleAmount",
  "paidAmount",
  "remainingAmount",
  "barberCommissionRate",
  "barberShare",
  "businessShare",
] as const;

/**
 * Girdideki ondalık hane sayısı kabul edilebilir mi?
 *
 * ÜRÜN KARARI: 2 haneden fazla ondalıklı para girdisi **reddedilir**.
 * Sunucu sessizce yuvarlamaz — aksi hâlde kullanıcının girdiği tutarla
 * kaydedilen tutar sessizce farklılaşırdı. (Aynı ilke Sıra 6'da "kalan
 * borçtan fazlasını kırpma, reddet" kararında da uygulanmıştı.)
 *
 * Karşılaştırma sayının EN KISA gösterimi üzerinden yapılır; `0.1 + 0.2`
 * gibi bir kayan nokta artığı `"0.30000000000000004"` olarak görünür ve
 * reddedilir — ki bu doğrudur: istemci böyle bir tutar göndermemelidir.
 */
export function hasValidMoneyScale(value: number): boolean {
  if (!Number.isFinite(value)) return false;
  const text = String(value);
  // Üstel gösterim (1e-7, 1e+21) para tutarı değildir.
  if (text.includes("e") || text.includes("E")) return false;
  const dot = text.indexOf(".");
  if (dot === -1) return true;
  return text.length - dot - 1 <= MONEY_SCALE;
}

/** Ondalık hane reddi için kullanıcıya gösterilecek mesaj. */
export const MONEY_SCALE_ERROR = "Tutar en fazla 2 ondalık hane içerebilir (kuruş).";

/** Oran alanları da 2 ondalık haneyle sınırlıdır (Decimal(5,2)). */
export const RATE_SCALE_ERROR = "Oran en fazla 2 ondalık hane içerebilir.";

/** `SaleItem` satırındaki para alanları. */
export const SALE_ITEM_MONEY_FIELDS = ["price"] as const;

/** `Sale` üzerindeki para/oran alanlarının birleşimi. */
export type SaleMoneyField = (typeof SALE_MONEY_FIELDS)[number];

/**
 * `serializeSale` çıktısının tipi: para alanları `number`, kalemler varsa
 * onların `price` alanı da `number`.
 */
export type SerializedSale<T> = Omit<T, SaleMoneyField | "items"> &
  Record<SaleMoneyField, number> &
  (T extends { items: (infer I)[] } ? { items: (Omit<I, "price"> & { price: number })[] } : unknown);

/**
 * Bir satış satırını (varsa kalemleriyle birlikte) sunuma hazırlar.
 *
 * `Sale` hem API yanıtlarında hem Client Component prop'larında kullanılıyor;
 * iki yolda da Decimal geçemez. Kalemler ayrıca dolaşılır — iç içe bir
 * Decimal de aynı sorunu çıkarır.
 */
export function serializeSale<T extends object>(sale: T): SerializedSale<T> {
  const out = { ...(sale as Record<string, unknown>) };
  for (const f of SALE_MONEY_FIELDS) {
    const v = out[f];
    if (v !== null && v !== undefined) out[f] = toNumber(v as MoneyInput);
  }
  const items = out.items;
  if (Array.isArray(items)) {
    out.items = items.map((i) => {
      const item = { ...(i as Record<string, unknown>) };
      if (item.price !== null && item.price !== undefined) item.price = toNumber(item.price as MoneyInput);
      return item;
    });
  }
  return out as SerializedSale<T>;
}

/** Birden çok satışı sunuma hazırlar. */
export function serializeSales<T extends object>(sales: T[]): SerializedSale<T>[] {
  return sales.map(serializeSale);
}
