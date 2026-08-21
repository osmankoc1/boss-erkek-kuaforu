/**
 * Randevu kurallarının TEK doğruluk kaynağı.
 *
 * Bu dosya bilinçli olarak saftır: veritabanı, Prisma, Next.js veya başka
 * hiçbir bağımlılığı yoktur. Kurallar burada, veri toplama ise
 * `lib/booking-guard.ts` içindedir.
 *
 * Amaç: aynı kuralın iki ayrı yerde farklı yazılmasını engellemek.
 * `lib/availability.ts` (slot listesi üretir) ve `lib/booking-guard.ts`
 * (tek bir slotu doğrular) bu dosyadaki aynı fonksiyonları kullanır.
 *
 * Tek istisna: gün sınırları `lib/tz.ts` üzerinden Europe/Istanbul takvimine
 * göre hesaplanır. O dosya da aynı şekilde saftır (yalnızca `Intl` kullanır).
 */
import {
  startOfIstanbulDay,
  startOfNextIstanbulDay,
  istanbulDateString,
  istanbulDayOfWeek,
} from "./tz";

/**
 * Bir slotu "dolu" sayan randevu durumları.
 *
 * `pending_verification` de listededir: e-posta doğrulaması bekleyen bir
 * randevu 24 saat boyunca geçerli sayıldığı için o slot başkasına
 * verilemez. (Süresi dolanları cron iptal eder.)
 */
export const BLOCKING_STATUSES = ["pending_verification", "pending", "confirmed"] as const;

/** Slot listesi üretilirken kullanılan adım aralığı (dakika). */
export const SLOT_STEP_MINUTES = 30;

export type BookingIssueCode =
  | "INVALID_INPUT"
  | "IN_PAST"
  | "BARBER_NOT_FOUND"
  | "BARBER_INACTIVE"
  | "DAY_OFF"
  | "DATE_EXCEPTION"
  | "OUTSIDE_WORKING_HOURS"
  | "SLOT_TAKEN";

export type BookingCheckResult =
  | { ok: true }
  | { ok: false; code: BookingIssueCode; message: string };

/** Gün içi dakika cinsinden yarı açık aralık: [startMinutes, endMinutes) */
export type MinuteRange = { startMinutes: number; endMinutes: number };

export type ExistingAppointment = {
  id: string;
  startTime: string;
  endTime: string;
};

export type BookingContext = {
  barber: { id: string; isActive: boolean } | null;
  /** O güne ait çalışma saati kaydı; kayıt yoksa null. */
  workingHour: { startTime: string; endTime: string; isOff: boolean } | null;
  /** O gün için izin/tatil (DateException) kaydı var mı. */
  hasDateException: boolean;
  /** Aynı berber + aynı gün için mevcut aktif randevular. */
  existingAppointments: ExistingAppointment[];
  /** Randevu gününün yerel gece yarısı. */
  dayStart: Date;
  /** "HH:MM" biçiminde talep edilen başlangıç saati. */
  startTime: string;
  durationMinutes: number;
  now: Date;
  /** Randevu düzenlenirken, randevunun kendisi çakışma sayılmasın diye. */
  excludeAppointmentId?: string;
  /** Admin geçmişe kayıt girebilsin diye geçmiş kontrolünü atlar. */
  allowPast?: boolean;
};

// ── Zaman yardımcıları ───────────────────────────────────────────────────────

/** "HH:MM" → gün içi dakika. Geçersiz girdide null. */
export function timeToMinutes(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time?.trim() ?? "");
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** Gün içi dakika → "HH:MM". 24:00 ve sonrasını da temsil edebilir. */
export function minutesToTime(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * İki aralık çakışıyor mu?
 *
 * Aralıklar yarı açıktır: 14:00–14:30 ile 14:30–15:00 ÇAKIŞMAZ.
 * Arka arkaya randevuların sınır teması bu yüzden serbesttir.
 */
export function rangesOverlap(a: MinuteRange, b: MinuteRange): boolean {
  return a.startMinutes < b.endMinutes && a.endMinutes > b.startMinutes;
}

/** Slot, çalışma penceresinin tamamen içinde mi? */
export function isWithinWorkingWindow(slot: MinuteRange, window: MinuteRange): boolean {
  return slot.startMinutes >= window.startMinutes && slot.endMinutes <= window.endMinutes;
}

/**
 * İşletme gününün başlangıcı (Europe/Istanbul gece yarısı).
 *
 * Önceden `setHours(0,0,0,0)` ile SUNUCUNUN yerel saatine göre kuruluyordu.
 * Vercel UTC çalıştığı için bu, gün başlangıcını İstanbul 03:00'e kaydırıyor
 * ve `slotInstant` ile birlikte tüm saat karşılaştırmalarını 3 saat ileri
 * alıyordu (geçmiş saat filtresi ve IN_PAST kontrolü buna bağlı).
 *
 * İsim geriye dönük uyumluluk için korundu; artık "yerel" = İstanbul.
 * Girdiyi mutasyona uğratmaz.
 */
export function startOfLocalDay(date: Date): Date {
  return startOfIstanbulDay(date);
}

/** Ertesi işletme gününün başlangıcı. Gün aralığı sorguları için üst sınır (`lt`). */
export function startOfNextLocalDay(date: Date): Date {
  return startOfNextIstanbulDay(date);
}

/**
 * Bir günün haftanın kaçıncı günü olduğu (0 = Pazar), İstanbul takvimine göre.
 *
 * `dayStart.getDay()` kullanılamaz: gün başlangıcı artık İstanbul gece yarısı
 * (UTC'de bir önceki günün 21:00'i) olduğu için sunucunun `getDay()` değeri
 * bir gün geri kayar.
 */
export function localDayOfWeek(date: Date): number {
  return istanbulDayOfWeek(date);
}

/**
 * Gün başlangıcı + dakika → gerçek an.
 *
 * Not: Türkiye 2016'dan beri kalıcı UTC+3 kullandığı için yaz saati
 * kaymasına karşı ek bir düzeltme gerekmez.
 */
export function slotInstant(dayStart: Date, startMinutes: number): Date {
  return new Date(dayStart.getTime() + startMinutes * 60_000);
}

/**
 * Eşzamanlılık kilidi için anahtar üretir: `<barberId>:<YYYY-MM-DD>`.
 *
 * Kilit berber + gün bazındadır. Aynı berberin aynı günü için gelen istekler
 * sıraya girer; farklı berber veya farklı gün istekleri birbirini beklemez.
 * Gün genelinde kilitlenmesinin sebebi, çakışma kontrolünün o günün tüm
 * randevularına bakıyor olmasıdır — daha dar bir kilit yarışı önlemez.
 *
 * Gün, Europe/Istanbul takvimine göre belirlenir (`startOfLocalDay` ile tutarlı).
 */
export function slotLockKey(barberId: string, date: Date): string {
  return `${barberId}:${istanbulDateString(date)}`;
}

/**
 * Bir gün için gösterilebilecek en erken slot başlangıcını (gün içi dakika)
 * döndürür.
 *
 *   null → gün tamamen geçmişte, hiç slot gösterilmemeli
 *   0    → gelecekteki bir gün, filtre uygulanmaz
 *   N    → bugün; N'den önce başlayan slotlar elenir
 *
 * Karşılaştırma Europe/Istanbul takvimine göre yapılır ve sunucunun saat
 * diliminden bağımsızdır (bkz. lib/tz.ts).
 *
 * Sınır davranışı `evaluateBookingSlot`'un IN_PAST kontrolüyle aynıdır:
 * tam şu anda başlayan slot hâlâ geçerlidir.
 */
export function resolveEarliestStartMinutes(params: { dayStart: Date; now: Date }): number | null {
  const { dayStart, now } = params;
  if (Number.isNaN(dayStart.getTime()) || Number.isNaN(now.getTime())) return null;

  const todayStart = startOfLocalDay(now);
  if (dayStart.getTime() < todayStart.getTime()) return null;
  if (dayStart.getTime() > todayStart.getTime()) return 0;

  return Math.floor((now.getTime() - todayStart.getTime()) / 60_000);
}

// ── Slot listesi üretimi ─────────────────────────────────────────────────────

/**
 * Çalışma penceresi ve dolu aralıklardan müsait slot listesi üretir.
 * `lib/availability.ts` bunun etrafındaki ince bir veritabanı sarmalayıcısıdır.
 */
export function buildSlots(params: {
  windowStartMinutes: number;
  windowEndMinutes: number;
  durationMinutes: number;
  busy: MinuteRange[];
  stepMinutes?: number;
  /** Verilirse, bu dakikadan önce başlayan slotlar elenir (geçmiş saat filtresi). */
  minStartMinutes?: number;
}): string[] {
  const {
    windowStartMinutes,
    windowEndMinutes,
    durationMinutes,
    busy,
    stepMinutes = SLOT_STEP_MINUTES,
    minStartMinutes,
  } = params;

  if (durationMinutes <= 0 || stepMinutes <= 0) return [];

  const slots: string[] = [];
  for (
    let current = windowStartMinutes;
    current + durationMinutes <= windowEndMinutes;
    current += stepMinutes
  ) {
    if (minStartMinutes !== undefined && current < minStartMinutes) continue;

    const candidate: MinuteRange = {
      startMinutes: current,
      endMinutes: current + durationMinutes,
    };
    if (!busy.some((range) => rangesOverlap(candidate, range))) {
      slots.push(minutesToTime(current));
    }
  }
  return slots;
}

/** Randevu kayıtlarını dakika aralıklarına çevirir; bozuk saatleri atar. */
export function toMinuteRanges(
  appointments: ExistingAppointment[],
  excludeAppointmentId?: string
): MinuteRange[] {
  const ranges: MinuteRange[] = [];
  for (const appointment of appointments) {
    if (excludeAppointmentId && appointment.id === excludeAppointmentId) continue;
    const startMinutes = timeToMinutes(appointment.startTime);
    const endMinutes = timeToMinutes(appointment.endTime);
    if (startMinutes === null || endMinutes === null) continue;
    if (endMinutes <= startMinutes) continue;
    ranges.push({ startMinutes, endMinutes });
  }
  return ranges;
}

// ── Karar ────────────────────────────────────────────────────────────────────

/**
 * Tek bir randevu slotunun geçerli olup olmadığına karar verir.
 *
 * Tamamen saftır: yalnızca kendisine verilen bağlamla çalışır, hiçbir
 * yan etkisi ve I/O'su yoktur. Veriyi toplayan katman için bkz.
 * `validateBookingSlot` (lib/booking-guard.ts).
 */
export function evaluateBookingSlot(context: BookingContext): BookingCheckResult {
  const {
    barber,
    workingHour,
    hasDateException,
    existingAppointments,
    dayStart,
    startTime,
    durationMinutes,
    now,
    excludeAppointmentId,
    allowPast = false,
  } = context;

  // 1) Girdi geçerliliği
  const startMinutes = timeToMinutes(startTime);
  if (startMinutes === null) {
    return { ok: false, code: "INVALID_INPUT", message: "Geçersiz saat biçimi." };
  }
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    return { ok: false, code: "INVALID_INPUT", message: "Hizmet süresi geçersiz." };
  }
  if (Number.isNaN(dayStart.getTime())) {
    return { ok: false, code: "INVALID_INPUT", message: "Geçersiz tarih." };
  }

  const slot: MinuteRange = {
    startMinutes,
    endMinutes: startMinutes + durationMinutes,
  };

  // 2) Geçmiş tarih/saat
  if (!allowPast && slotInstant(dayStart, startMinutes).getTime() < now.getTime()) {
    return {
      ok: false,
      code: "IN_PAST",
      message: "Geçmiş bir tarih veya saat için randevu oluşturulamaz.",
    };
  }

  // 3) Berber
  if (!barber) {
    return { ok: false, code: "BARBER_NOT_FOUND", message: "Çalışan bulunamadı." };
  }
  if (!barber.isActive) {
    return { ok: false, code: "BARBER_INACTIVE", message: "Bu çalışan şu anda randevu almıyor." };
  }

  // 4) O gün çalışıyor mu
  if (!workingHour || workingHour.isOff) {
    return { ok: false, code: "DAY_OFF", message: "Seçilen çalışan bu gün çalışmıyor." };
  }

  // 5) İzin / tatil
  if (hasDateException) {
    return { ok: false, code: "DATE_EXCEPTION", message: "Seçilen tarihte çalışan izinli." };
  }

  // 6) Çalışma saatleri penceresi
  const windowStart = timeToMinutes(workingHour.startTime);
  const windowEnd = timeToMinutes(workingHour.endTime);
  if (windowStart === null || windowEnd === null || windowEnd <= windowStart) {
    return {
      ok: false,
      code: "DAY_OFF",
      message: "Seçilen çalışanın bu gün için çalışma saati tanımlı değil.",
    };
  }
  if (!isWithinWorkingWindow(slot, { startMinutes: windowStart, endMinutes: windowEnd })) {
    return {
      ok: false,
      code: "OUTSIDE_WORKING_HOURS",
      message: `Bu saat çalışma saatleri dışında. Çalışma saatleri: ${workingHour.startTime}–${workingHour.endTime}.`,
    };
  }

  // 7) Çakışma
  const busy = toMinuteRanges(existingAppointments, excludeAppointmentId);
  if (busy.some((range) => rangesOverlap(slot, range))) {
    return { ok: false, code: "SLOT_TAKEN", message: "Bu saat dolu. Lütfen başka bir saat seçin." };
  }

  return { ok: true };
}
