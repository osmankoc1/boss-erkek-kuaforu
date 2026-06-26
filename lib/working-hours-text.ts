import "server-only";
import { db } from "./db";

const SHORT = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
const ORDERED = [1, 2, 3, 4, 5, 6, 0]; // Pzt → Paz

export async function getWorkingHoursText(): Promise<string> {
  const rows = await db.workingHour.findMany({
    where: { barber: { isActive: true } },
  });

  if (rows.length === 0) return "";

  // Per day: merge all barbers — if ANY barber works, day is open; widen window
  const dayMap: Record<number, { start: string; end: string; isOff: boolean }> = {};

  for (const h of rows) {
    const d = h.dayOfWeek;
    const prev = dayMap[d];
    if (!prev) {
      dayMap[d] = { start: h.startTime, end: h.endTime, isOff: h.isOff };
    } else if (!h.isOff && prev.isOff) {
      dayMap[d] = { start: h.startTime, end: h.endTime, isOff: false };
    } else if (!h.isOff && !prev.isOff) {
      if (h.startTime < prev.start) dayMap[d].start = h.startTime;
      if (h.endTime > prev.end) dayMap[d].end = h.endTime;
    }
    // h.isOff + prev open → keep prev open
  }

  // Group consecutive days in ORDERED sequence that share identical slot
  type Seg = { days: number[]; start: string; end: string; isOff: boolean };
  const segs: Seg[] = [];

  for (const day of ORDERED) {
    const info = dayMap[day];
    if (!info) continue;

    const last = segs[segs.length - 1];
    const same =
      last &&
      last.isOff === info.isOff &&
      (info.isOff || (last.start === info.start && last.end === info.end));

    if (same) {
      last.days.push(day);
    } else {
      segs.push({ days: [day], start: info.start, end: info.end, isOff: info.isOff });
    }
  }

  return segs
    .map(({ days, start, end, isOff }) => {
      const label =
        days.length === 1
          ? SHORT[days[0]]
          : `${SHORT[days[0]]}–${SHORT[days[days.length - 1]]}`;
      return isOff ? `${label}: Kapalı` : `${label}: ${start}–${end}`;
    })
    .join(", ");
}
