import { db } from "./db";

export async function getAvailableSlots(barberId: string, dateStr: string, durationMinutes: number) {
  const date = new Date(dateStr);
  const dayOfWeek = date.getDay();

  const workingHour = await db.workingHour.findFirst({
    where: { barberId, dayOfWeek, isOff: false },
  });
  if (!workingHour) return [];

  const exception = await db.dateException.findFirst({
    where: {
      barberId,
      date: { gte: new Date(date.setHours(0, 0, 0, 0)), lt: new Date(date.setHours(23, 59, 59, 999)) },
    },
  });
  if (exception) return [];

  const existing = await db.appointment.findMany({
    where: {
      barberId,
      date: { gte: new Date(new Date(dateStr).setHours(0, 0, 0, 0)), lt: new Date(new Date(dateStr).setHours(23, 59, 59, 999)) },
      status: { in: ["pending", "confirmed"] },
    },
    select: { startTime: true, endTime: true },
  });

  const slots: string[] = [];
  const [startH, startM] = workingHour.startTime.split(":").map(Number);
  const [endH, endM] = workingHour.endTime.split(":").map(Number);
  let current = startH * 60 + startM;
  const end = endH * 60 + endM;

  while (current + durationMinutes <= end) {
    const slotStart = `${String(Math.floor(current / 60)).padStart(2, "0")}:${String(current % 60).padStart(2, "0")}`;
    const slotEnd = `${String(Math.floor((current + durationMinutes) / 60)).padStart(2, "0")}:${String((current + durationMinutes) % 60).padStart(2, "0")}`;

    const isOccupied = existing.some((appt) => {
      const apptStart = timeToMinutes(appt.startTime);
      const apptEnd = timeToMinutes(appt.endTime);
      return current < apptEnd && current + durationMinutes > apptStart;
    });

    if (!isOccupied) slots.push(slotStart);
    current += 30;
  }

  return slots;
}

function timeToMinutes(time: string) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}
