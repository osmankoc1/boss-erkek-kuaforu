import { db } from "./db";
import {
  BLOCKING_STATUSES,
  buildSlots,
  startOfLocalDay,
  startOfNextLocalDay,
  timeToMinutes,
  toMinuteRanges,
} from "./booking-rules";

/**
 * Bir berberin belirli bir gün için müsait slot listesini üretir.
 *
 * Kurallar `lib/booking-rules.ts` içinde tanımlıdır; bu fonksiyon yalnızca
 * veriyi toplayıp o kurallara verir. Tek bir slotu doğrulamak için
 * `validateBookingSlot` (lib/booking-guard.ts) kullanılır — ikisi de aynı
 * kural setini paylaşır.
 */
export async function getAvailableSlots(
  barberId: string,
  dateStr: string,
  durationMinutes: number
): Promise<string[]> {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return [];

  const dayStart = startOfLocalDay(date);
  const dayEnd = startOfNextLocalDay(date);
  const dayOfWeek = dayStart.getDay();

  const workingHour = await db.workingHour.findFirst({
    where: { barberId, dayOfWeek, isOff: false },
    select: { startTime: true, endTime: true },
  });
  if (!workingHour) return [];

  const exception = await db.dateException.findFirst({
    where: { barberId, date: { gte: dayStart, lt: dayEnd } },
    select: { id: true },
  });
  if (exception) return [];

  const existing = await db.appointment.findMany({
    where: {
      barberId,
      date: { gte: dayStart, lt: dayEnd },
      status: { in: [...BLOCKING_STATUSES] },
    },
    select: { id: true, startTime: true, endTime: true },
  });

  const windowStartMinutes = timeToMinutes(workingHour.startTime);
  const windowEndMinutes = timeToMinutes(workingHour.endTime);
  if (windowStartMinutes === null || windowEndMinutes === null) return [];

  return buildSlots({
    windowStartMinutes,
    windowEndMinutes,
    durationMinutes,
    busy: toMinuteRanges(existing),
  });
}
