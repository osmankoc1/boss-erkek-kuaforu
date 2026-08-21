/**
 * Europe/Istanbul takvim sınırları — TEK doğruluk kaynağı.
 *
 * İşletme İstanbul'da; "gün", "hafta", "ay" kavramları İstanbul takvimine göre
 * tanımlıdır. Sunucu ise (Vercel) UTC çalışır. Bu yüzden gün sınırları
 * `new Date(y, m, d)` / `setHours(0,0,0,0)` / `toISOString().slice(0,10)` gibi
 * **sunucunun yerel saatine bağlı** ifadelerle kurulamaz — böyle kurulursa
 * 00:00–03:00 İstanbul arasındaki her kayıt bir önceki güne (ay/yıl başında
 * önceki aya/yıla) düşer.
 *
 * Buradaki fonksiyonlar saat dilimini AÇIKÇA belirtir; `process.env.TZ`
 * ne olursa olsun aynı sonucu verir. Bu, `scripts/verify-timezone.ts`
 * testinin TZ=UTC ve TZ=Europe/Istanbul altında birebir aynı çıktıyı
 * vermesiyle doğrulanır.
 *
 * Not: Türkiye 2016'dan beri kalıcı olarak UTC+03; yaz saati uygulaması yok.
 * Yine de ofset sabit yazılmadı, `Intl` üzerinden o ana ait ofset okunuyor —
 * kural ileride değişirse kod kendiliğinden doğru kalır.
 */

export const ISTANBUL_TZ = "Europe/Istanbul";

const PARTS_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: ISTANBUL_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export type IstanbulParts = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
};

/** Bir anın İstanbul duvar saatindeki karşılığı. */
export function istanbulParts(date: Date): IstanbulParts {
  const p: Record<string, string> = {};
  for (const part of PARTS_FORMATTER.formatToParts(date)) {
    if (part.type !== "literal") p[part.type] = part.value;
  }
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    // Bazı ortamlar gece yarısını "24" olarak verebilir; 0'a normalize edilir.
    hour: Number(p.hour) % 24,
    minute: Number(p.minute),
    second: Number(p.second),
  };
}

/** O ana ait İstanbul UTC ofseti (ms). */
function istanbulOffsetMs(date: Date): number {
  const p = istanbulParts(date);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asIfUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * İstanbul duvar saatinden gerçek zaman anı (UTC instant) üretir.
 *
 * İki geçişli: önce ofset tahmin edilir, sonra tahminin kendi anındaki ofsetle
 * doğrulanır. Yaz saati geçişi olan bir kuralda bile doğru sonuç verir.
 */
export function istanbulInstant(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  ms = 0
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  const offset1 = istanbulOffsetMs(new Date(guess));
  const candidate = guess - offset1;
  const offset2 = istanbulOffsetMs(new Date(candidate));
  return new Date(offset1 === offset2 ? candidate : guess - offset2);
}

/** "YYYY-MM-DD" biçiminde bir takvim günü mü? */
function isDateOnlyString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

/**
 * Girdiyi İstanbul takvim gününe çözer.
 *
 * - "YYYY-MM-DD" metni doğrudan takvim günü sayılır (ekranların URL'den aldığı
 *   biçim). `new Date("2026-08-21")` gibi UTC gece yarısına çevrilmez.
 * - `Date` verilirse, o anın İstanbul'daki takvim günü alınır.
 */
function resolveIstanbulDay(input: Date | string): { year: number; month: number; day: number } {
  if (typeof input === "string" && isDateOnlyString(input)) {
    const [y, m, d] = input.trim().split("-").map(Number);
    return { year: y, month: m, day: d };
  }
  const date = typeof input === "string" ? new Date(input) : input;
  const p = istanbulParts(date);
  return { year: p.year, month: p.month, day: p.day };
}

/** Bir anın İstanbul takvim günü — "YYYY-MM-DD". Ekranların "bugün" değeri. */
export function istanbulDateString(date: Date = new Date()): string {
  const p = istanbulParts(date);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** İstanbul gününün başlangıcı (00:00:00.000). */
export function startOfIstanbulDay(input: Date | string): Date {
  const { year, month, day } = resolveIstanbulDay(input);
  return istanbulInstant(year, month, day, 0, 0, 0, 0);
}

/** İstanbul gününün sonu (23:59:59.999) — kapsayıcı `lte` sorguları için. */
export function endOfIstanbulDay(input: Date | string): Date {
  const { year, month, day } = resolveIstanbulDay(input);
  return istanbulInstant(year, month, day, 23, 59, 59, 999);
}

/** Ertesi İstanbul gününün başlangıcı — yarı açık (`lt`) sorguları için. */
export function startOfNextIstanbulDay(input: Date | string): Date {
  const { year, month, day } = resolveIstanbulDay(input);
  return istanbulInstant(year, month, day + 1, 0, 0, 0, 0);
}

/** Verilen günden N gün sonrasının/öncesinin başlangıcı. */
export function addIstanbulDays(input: Date | string, days: number): Date {
  const { year, month, day } = resolveIstanbulDay(input);
  return istanbulInstant(year, month, day + days, 0, 0, 0, 0);
}

/** İstanbul haftanın günü: 0 = Pazar … 6 = Cumartesi. */
export function istanbulDayOfWeek(date: Date): number {
  const p = istanbulParts(date);
  // Date.UTC ile kurulan anın getUTCDay'i, o takvim gününün haftanın günüdür.
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
}

/** Haftanın başlangıcı (Pazar 00:00) — mevcut `getDay()` tabanlı davranışla aynı. */
export function startOfIstanbulWeek(input: Date | string): Date {
  const start = startOfIstanbulDay(input);
  return addIstanbulDays(start, -istanbulDayOfWeek(start));
}

/** Ayın ilk günü 00:00. */
export function startOfIstanbulMonth(input: Date | string): Date {
  const { year, month } = resolveIstanbulDay(input);
  return istanbulInstant(year, month, 1, 0, 0, 0, 0);
}

/** Sonraki ayın ilk günü 00:00 — yarı açık ay penceresi için. */
export function startOfNextIstanbulMonth(input: Date | string): Date {
  const { year, month } = resolveIstanbulDay(input);
  return istanbulInstant(year, month + 1, 1, 0, 0, 0, 0);
}
