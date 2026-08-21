import { db } from "@/lib/db";
import { logMailFailure, sendReminderEmail } from "@/lib/mail";
import { verifyCronAuth } from "@/lib/cron-auth";
import { addIstanbulDays } from "@/lib/tz";

export async function GET(req: Request) {
  if (!verifyCronAuth(req)) {
    return Response.json({ error: "Yetkisiz." }, { status: 401 });
  }

  // "Yarin" penceresi Europe/Istanbul takvimine gore kurulur (bkz. lib/tz.ts).
  //
  // Onceden sunucunun YEREL takvim gunu kullaniliyordu. Vercel UTC calistigi
  // ve cron 08:00 UTC'de (11:00 Istanbul) atesledigi icin UTC gunu ile
  // Istanbul gunu o saatte ortustugundan sonuc DOGRUYDU; ama bu dogruluk
  // sunucunun saat dilimine ve cron saatine ortuk olarak bagliydi. Cron saati
  // 21:00-24:00 UTC araligina cekilse veya sunucu saat dilimi degisse pencere
  // sessizce yanlis gune kayardi.
  //
  // Pencere Istanbul 00:00'dan ertesi gun 00:00'a kadardir. `Appointment.date`
  // takvim gununun UTC gece yarisinda saklandigi icin (saat ayri `startTime`
  // alaninda) bu pencere o gunun kaydini tam olarak icerir; ayrica alan
  // ileride gercek bir an tasirsa 00:00-02:59 Istanbul araligi da kapsanir.
  const start = addIstanbulDays(new Date(), 1);
  const end = addIstanbulDays(start, 1);

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
