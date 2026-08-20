import { db } from "@/lib/db";
import { logMailFailure, sendReminderEmail } from "@/lib/mail";
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
  let failed = 0;
  for (const appt of appointments) {
    try {
      await sendReminderEmail(appt);
      // reminderSent yalnızca gönderim başarılıysa işaretlenir; başarısız
      // olanlar bir sonraki cron çalışmasında yeniden denenir.
      await db.appointment.update({ where: { id: appt.id }, data: { reminderSent: true } });
      sent++;
    } catch (error) {
      failed++;
      logMailFailure({ kind: "reminder", appointmentId: appt.id, recipient: appt.customer.email, error });
    }
  }

  if (failed > 0) {
    console.error("[cron] hatirlatma maili: " + sent + " gonderildi, " + failed + " basarisiz");
  }

  return Response.json({ sent, failed });
}
