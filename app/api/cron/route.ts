import { db } from "@/lib/db";
import { sendReminderEmail } from "@/lib/mail";
import { verifyCronAuth } from "@/lib/cron-auth";

export async function GET(req: Request) {
  if (!verifyCronAuth(req)) {
    return Response.json({ error: "Yetkisiz." }, { status: 401 });
  }

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const start = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate());
  const end = new Date(start.getTime() + 86400000);

  const appointments = await db.appointment.findMany({
    where: {
      date: { gte: start, lt: end },
      status: "confirmed",
      reminderSent: false,
    },
    include: { customer: true, barber: true, service: true },
  });

  let sent = 0;
  for (const appt of appointments) {
    try {
      await sendReminderEmail(appt);
      await db.appointment.update({ where: { id: appt.id }, data: { reminderSent: true } });
      sent++;
    } catch {}
  }

  return Response.json({ sent });
}
