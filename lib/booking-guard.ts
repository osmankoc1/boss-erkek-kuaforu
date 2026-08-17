import "server-only";
import { db } from "./db";
import {
  BLOCKING_STATUSES,
  evaluateBookingSlot,
  startOfLocalDay,
  startOfNextLocalDay,
  type BookingCheckResult,
  type BookingContext,
} from "./booking-rules";

export type { BookingCheckResult, BookingIssueCode } from "./booking-rules";

export type ValidateBookingInput = {
  barberId: string;
  /** "YYYY-MM-DD" veya Date. */
  date: string | Date;
  /** "HH:MM" */
  startTime: string;
  /** Seçilen tüm hizmetlerin toplam süresi. */
  durationMinutes: number;
  /**
   * Randevu düzenlenirken verilir; randevunun kendisi çakışma sayılmaz.
   * (Faz 3 "randevu taşıma" işi bu parametreyi kullanacak.)
   */
  excludeAppointmentId?: string;
  /** Admin geçmişe kayıt girebilsin diye geçmiş kontrolünü atlar. */
  allowPast?: boolean;
  /** Test edilebilirlik için; verilmezse şimdiki zaman. */
  now?: Date;
};

/**
 * Bir randevu slotunun sunucu tarafında geçerli olup olmadığını doğrular.
 *
 * Veriyi toplar, kararı `evaluateBookingSlot` (saf katman) verir.
 * Tarayıcıdan gelen hiçbir bilgiye güvenilmez; süre dahil her şey
 * çağıran tarafından veritabanı kaynaklı olarak sağlanmalıdır.
 *
 * NOT (bilinen sınırlama): Bu fonksiyon tek başına eşzamanlılığa karşı
 * güvence vermez. İki istek aynı anda gelirse ikisi de "boş" görebilir.
 * Yazma işlemi, transaction içinde advisory lock ile korunmalıdır
 * (Faz 1 · Sıra 8).
 */
export async function validateBookingSlot(
  input: ValidateBookingInput
): Promise<BookingCheckResult> {
  const {
    barberId,
    date,
    startTime,
    durationMinutes,
    excludeAppointmentId,
    allowPast = false,
    now = new Date(),
  } = input;

  const parsedDate = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(parsedDate.getTime())) {
    return { ok: false, code: "INVALID_INPUT", message: "Geçersiz tarih." };
  }

  // Gün sınırları yerel saat dilimine göre hesaplanır. Sunucunun
  // TZ=Europe/Istanbul olarak çalıştığı varsayılır (bkz. Faz 2 · saat dilimi).
  const dayStart = startOfLocalDay(parsedDate);
  const dayEnd = startOfNextLocalDay(parsedDate);
  const dayOfWeek = dayStart.getDay();

  const [barber, workingHours, dateException, existingAppointments] = await Promise.all([
    db.barber.findUnique({
      where: { id: barberId },
      select: { id: true, isActive: true },
    }),
    db.workingHour.findMany({
      where: { barberId, dayOfWeek },
      select: { startTime: true, endTime: true, isOff: true },
    }),
    db.dateException.findFirst({
      where: { barberId, date: { gte: dayStart, lt: dayEnd } },
      select: { id: true },
    }),
    db.appointment.findMany({
      where: {
        barberId,
        date: { gte: dayStart, lt: dayEnd },
        status: { in: [...BLOCKING_STATUSES] },
      },
      select: { id: true, startTime: true, endTime: true },
    }),
  ]);

  // Aynı gün için birden fazla kayıt varsa çalışılan kaydı tercih et.
  // (Şemada barberId+dayOfWeek üzerinde unique kısıt yok.)
  const workingHour = workingHours.find((hour) => !hour.isOff) ?? workingHours[0] ?? null;

  const context: BookingContext = {
    barber,
    workingHour,
    hasDateException: dateException !== null,
    existingAppointments,
    dayStart,
    startTime,
    durationMinutes,
    now,
    excludeAppointmentId,
    allowPast,
  };

  return evaluateBookingSlot(context);
}
