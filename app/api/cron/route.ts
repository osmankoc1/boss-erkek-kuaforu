import { db } from "@/lib/db";
import { logMailFailure, sendDailyHealthSummary, sendReminderEmail, type HealthSummary } from "@/lib/mail";
import { verifyCronAuth } from "@/lib/cron-auth";
import { addIstanbulDays, istanbulDateString } from "@/lib/tz";

/**
 * Günlük özetin hangi güne kadar gönderildiğini tutan ayar anahtarı.
 *
 * `Setting` serbest bir anahtar-değer deposu; bu anahtar SİSTEM tarafından
 * yönetilir. `WRITABLE_SETTING_KEYS` içinde olmadığı için admin panelinden
 * ne görünür ne değiştirilebilir; `PUBLIC_SETTING_KEYS` içinde olmadığı için
 * oturumsuz çağrıya sızmaz (FAZ 3 · Sıra 3.3 bu iki listeyi netleştirdi).
 */
const OZET_ANAHTARI = "cron_daily_summary_last_sent";

/**
 * Günlük özetin bugün gönderilme hakkını ATOMİK olarak alır.
 *
 * Cron artık başarısızlıkta 5xx dönüyor; Vercel bunu yeniden deneyebilir.
 * Hatırlatmaların tekrar denenmesi İSTENİR (`reminderSent` yalnızca başarılı
 * gönderimde işaretlenir), ama günlük özetin ikinci kez gitmesi istenmez.
 *
 * `updateMany` tek bir atomik UPDATE'tir: eş zamanlı iki çağrıdan yalnızca
 * biri `count === 1` alır. Satır hiç yoksa `create` denenir; yarışı kaybeden
 * taraf benzersiz anahtar hatası alır ve hak talep etmez.
 *
 * @returns bugünün özetini gönderme hakkı alındıysa `true`
 */
async function ozetHakkiAl(bugun: string): Promise<boolean> {
  const guncellendi = await db.setting.updateMany({
    where: { key: OZET_ANAHTARI, value: { not: bugun } },
    data: { value: bugun },
  });
  if (guncellendi.count > 0) return true;

  const mevcut = await db.setting.findUnique({ where: { key: OZET_ANAHTARI } });
  if (mevcut) return false; // bugün zaten gönderildi

  try {
    await db.setting.create({ data: { key: OZET_ANAHTARI, value: bugun } });
    return true;
  } catch {
    return false; // yarışı başka bir çağrı kazandı
  }
}

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

  // ── Gunluk saglik ozeti (FAZ 3 · Sira 3.6) ────────────────────────────
  const summary = await gunlukOzet(sent, failed);

  // ── Basarisizlik sinyali ──────────────────────────────────────────────
  //
  // Onceden tum mailler patlasa bile 200 donuluyordu; Vercel'in cron izlemesi
  // bu yuzden "basarili" goruyordu. Elde CALISAN bir izleme vardi ve ona
  // yanlis sinyal veriliyordu. Artik gercek basarisizlikta 5xx donuyor.
  //
  // Yeniden deneme guvenli: `reminderSent` yalnizca basarili gonderimde
  // isaretlenir, ozet ise gun basina bir kez kilitlenir.
  const basarisiz = failed > 0 || summary.attempted === true && summary.delivered === false;

  return Response.json({ sent, failed, summary }, { status: basarisiz ? 500 : 200 });
}

/** Özet gönderiminin sonucu — yanıtta görünür, sessizce yutulmaz. */
type OzetSonucu = {
  /** Bugün gönderim hakkı alındı mı (gün başına bir kez). */
  attempted: boolean;
  /** Denendiyse teslim edilebildi mi. */
  delivered?: boolean;
  /** Denenmediyse sebebi. */
  skipped?: string;
  /** Teslim edilemediyse hata metni — YUTULMAZ. */
  error?: string;
  recipient?: string;
} & Partial<HealthSummary>;

/**
 * Günlük sağlık özetini hazırlar ve (günde bir kez) gönderir.
 *
 * Hata YUTULMAZ: gönderilemezse `delivered: false` ve `error` ile döner,
 * çağıran bunu 5xx'e çevirir. "Özet gelmiyor" durumunun kendisi de görünür
 * olmalıdır — aksi halde izlemenin izlenmemesi sorunu doğar.
 */
async function gunlukOzet(sent: number, failed: number): Promise<OzetSonucu> {
  const bugun = istanbulDateString();

  if (!(await ozetHakkiAl(bugun))) {
    return { attempted: false, skipped: `bugun (${bugun}) zaten gonderildi` };
  }

  // Yarinki randevu sayisi: hatirlatma sorgusuyla ayni pencere, ama
  // `reminderSent` filtresi YOK -- isletme sahibi toplam sayiyi gormeli.
  const yarinBaslangic = addIstanbulDays(new Date(), 1);
  const yarinBitis = addIstanbulDays(yarinBaslangic, 1);

  // Iptal edilen dogrulanmamis randevular AYRI bir cron'da (09:00) isleniyor;
  // bu cron 08:00'de calistigi icin o gunun temizligi henuz olmamis olur.
  // Bu yuzden sayim son 24 SAATIN denetim izinden okunur -- siraya bagli
  // olmayan, gercekten olan biteni gosteren kaynak budur.
  const yirmiDortSaatOnce = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [tomorrowAppointments, expiredCancelled, ayar] = await Promise.all([
    db.appointment.count({
      where: { date: { gte: yarinBaslangic, lt: yarinBitis }, status: { not: "cancelled" } },
    }),
    db.auditLog.count({
      where: {
        entity: "Appointment",
        action: "STATUS_CHANGE",
        source: "SYSTEM",
        createdAt: { gte: yirmiDortSaatOnce },
      },
    }),
    db.setting.findUnique({ where: { key: "business_email" } }),
  ]);

  const ozet: HealthSummary = {
    date: bugun,
    reminderSent: sent,
    reminderFailed: failed,
    expiredCancelled,
    tomorrowAppointments,
  };

  const alici = ayar?.value?.trim();
  if (!alici) {
    console.error("[cron] gunluk ozet gonderilemedi: `business_email` ayari bos");
    return { attempted: true, delivered: false, error: "business_email ayari bos", ...ozet };
  }

  try {
    await sendDailyHealthSummary(alici, ozet);
    return { attempted: true, delivered: true, recipient: alici, ...ozet };
  } catch (error) {
    logMailFailure({ kind: "health_summary", recipient: alici, error });
    return {
      attempted: true,
      delivered: false,
      recipient: alici,
      error: error instanceof Error ? error.message : String(error),
      ...ozet,
    };
  }
}
