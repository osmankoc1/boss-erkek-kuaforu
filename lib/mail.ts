import { Resend } from "resend";
import type { Appointment, Customer, Barber, Service } from "@/app/generated/prisma/client";
import { displayAppointmentCode } from "./appointment-code";

// Uyarılar `new Resend()` çağrısından ÖNCE yazılır: anahtar yoksa Resend
// yapıcısı modül yüklenirken hata fırlatır ve sonraki satırlara hiç ulaşılmaz.
// Bu sırayla, loga en azından sebebi düşer.
if (!process.env.RESEND_API_KEY) {
  console.error("[mail] RESEND_API_KEY tanımlı değil — e-posta modülü yüklenemeyecek.");
}
if (!process.env.RESEND_FROM_EMAIL) {
  console.warn("[mail] RESEND_FROM_EMAIL tanımlı değil; varsayılan gönderici adresi kullanılıyor.");
}

const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Gönderici adresi. Resend, gönderim yapılan domainin panelde doğrulanmış
 * olmasını şart koşar; bu yüzden fallback de doğrulanmış domaini kullanır.
 */
const FROM = process.env.RESEND_FROM_EMAIL ?? "randevu@bosskuafor.com.tr";

/**
 * Resend SDK'sı hata durumunda İSTİSNA FIRLATMAZ; `{ data, error }` döndürür.
 * Dönüş kontrol edilmezse doğrulanmamış domain, geçersiz API anahtarı veya
 * reddedilen alıcı gibi hatalar sessizce kaybolur ve çağıran taraftaki
 * try/catch hiç tetiklenmez.
 *
 * Bu sarmalayıcı hatayı istisnaya çevirir; böylece çağrı yerlerindeki
 * hata yakalama ve `logMailFailure` gerçekten çalışır.
 */
async function dispatch(payload: Parameters<typeof resend.emails.send>[0]): Promise<void> {
  const { error } = await resend.emails.send(payload);
  if (error) {
    const name = error.name ?? "resend_error";
    const message = error.message ?? "bilinmeyen hata";
    throw new Error(`${name}: ${message}`);
  }
}

/** Gönderilen e-posta türleri — log filtrelemede kullanılır. */
export type MailKind =
  | "verification"
  | "confirmation"
  | "cancellation"
  | "reminder"
  | "admin_new_booking"
  | "admin_verified"
  | "health_summary";

/**
 * Log/PII güvenliği: e-posta adresini `ab***@domain.com` biçimine indirger.
 * Yıldız sayısı sabittir; yerel kısmın uzunluğunu sızdırmaz.
 */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return "(yok)";
  const at = email.indexOf("@");
  if (at < 1) return "(geçersiz)";
  return `${email.slice(0, Math.min(2, at))}***${email.slice(at)}`;
}

/**
 * Başarısız e-posta gönderimini sunucu loguna yazar.
 *
 * Tek satır ve sabit alan adlarıyla yazılır; Vercel loglarında
 * `[mail] FAILED` veya `kind=verification` ile aranabilir.
 * Alıcı adresi maskelenir — log satırları PII taşımaz.
 */
export function logMailFailure(params: {
  kind: MailKind;
  appointmentId?: string;
  recipient?: string | null;
  error: unknown;
}): void {
  const { kind, appointmentId, recipient, error } = params;
  const reason = error instanceof Error ? error.message : String(error);
  console.error(
    "[mail] FAILED" +
      ` kind=${kind}` +
      (appointmentId ? ` appointmentId=${appointmentId}` : "") +
      ` recipient=${maskEmail(recipient)}` +
      ` reason=${JSON.stringify(reason)}`
  );
}

type AppointmentFull = Appointment & { customer: Customer; barber: Barber; service: Service | null };

/**
 * Randevu kodu satırı.
 *
 * Müşteri randevusunu sorgulamak veya iptal etmek için telefon numarası +
 * bu kodu birlikte kullanır. Kodu kaybederse erişimi kalmayacağı için
 * müşteriye giden e-postalarda görünür olması zorunludur.
 */
function codeRow(appt: AppointmentFull) {
  return `<tr><td><strong>Randevu Kodu:</strong></td><td style="font-family:monospace; letter-spacing:1px; color:#e8913a;"><strong>${displayAppointmentCode(appt.id)}</strong></td></tr>`;
}

const CODE_HINT = `<p style="color:#9ca3af; font-size:12px;">Randevunuzu sorgulamak veya iptal etmek için telefon numaranız ile yukarıdaki randevu kodunu kullanabilirsiniz.</p>`;

export async function sendNewBookingNotification(appt: AppointmentFull, adminEmail: string) {
  await dispatch({
    from: FROM,
    to: adminEmail,
    subject: `Yeni Randevu: ${appt.customer.fullName}`,
    html: emailTemplate("Yeni Randevu Talebi", `
      <p><strong>${appt.customer.fullName}</strong> yeni bir randevu talebi oluşturdu.</p>
      <table>
        <tr><td><strong>Tarih:</strong></td><td>${new Date(appt.date).toLocaleDateString("tr-TR")}</td></tr>
        <tr><td><strong>Saat:</strong></td><td>${appt.startTime} - ${appt.endTime}</td></tr>
        <tr><td><strong>Hizmet:</strong></td><td>${appt.service?.name ?? "—"}</td></tr>
        <tr><td><strong>Çalışan:</strong></td><td>${appt.barber.name}</td></tr>
        <tr><td><strong>Telefon:</strong></td><td>${appt.customer.phone}</td></tr>
      </table>
    `),
  });
}

export async function sendConfirmationEmail(appt: AppointmentFull) {
  if (!appt.customer.email) return;
  await dispatch({
    from: FROM,
    to: appt.customer.email,
    subject: "Randevunuz Onaylandı — BOSS Erkek Kuaförü",
    html: emailTemplate("Randevunuz Onaylandı ✓", `
      <p>Sayın <strong>${appt.customer.fullName}</strong>,</p>
      <p>Randevunuz başarıyla onaylanmıştır.</p>
      <table>
        <tr><td><strong>Tarih:</strong></td><td>${new Date(appt.date).toLocaleDateString("tr-TR")}</td></tr>
        <tr><td><strong>Saat:</strong></td><td>${appt.startTime}</td></tr>
        <tr><td><strong>Hizmet:</strong></td><td>${appt.service?.name ?? "—"}</td></tr>
        <tr><td><strong>Çalışan:</strong></td><td>${appt.barber.name}</td></tr>
        ${codeRow(appt)}
      </table>
      ${CODE_HINT}
      <p>Görüşmek üzere!</p>
    `),
  });
}

export async function sendCancellationEmail(appt: AppointmentFull) {
  if (!appt.customer.email) return;
  await dispatch({
    from: FROM,
    to: appt.customer.email,
    subject: "Randevunuz İptal Edildi — BOSS Erkek Kuaförü",
    html: emailTemplate("Randevunuz İptal Edildi", `
      <p>Sayın <strong>${appt.customer.fullName}</strong>,</p>
      <p>${new Date(appt.date).toLocaleDateString("tr-TR")} tarihli ${appt.startTime} saatindeki randevunuz iptal edilmiştir.</p>
      <p>Yeni randevu almak için sitemizi ziyaret edebilirsiniz.</p>
    `),
  });
}

export async function sendVerificationEmail(appt: AppointmentFull, verificationUrl: string) {
  if (!appt.customer.email) return;
  await dispatch({
    from: FROM,
    to: appt.customer.email,
    subject: "Randevunuzu Doğrulayın — BOSS Erkek Kuaförü",
    html: emailTemplate("Randevunuzu Doğrulayın", `
      <p>Sayın <strong>${appt.customer.fullName}</strong>,</p>
      <p>Randevu talebinizi almış bulunuyoruz. Randevunuzu onay sürecine almak için aşağıdaki butona tıklayarak e-posta adresinizi doğrulayın.</p>
      <table>
        <tr><td><strong>Tarih:</strong></td><td>${new Date(appt.date).toLocaleDateString("tr-TR")}</td></tr>
        <tr><td><strong>Saat:</strong></td><td>${appt.startTime}</td></tr>
        <tr><td><strong>Hizmet:</strong></td><td>${appt.service?.name ?? "—"}</td></tr>
        <tr><td><strong>Çalışan:</strong></td><td>${appt.barber.name}</td></tr>
        ${codeRow(appt)}
      </table>
      ${CODE_HINT}
      <div style="text-align:center; margin: 28px 0;">
        <a href="${verificationUrl}"
          style="display:inline-block; background:#c9762c; color:#ffffff; font-weight:bold; font-size:15px; padding:14px 32px; border-radius:8px; text-decoration:none;">
          Randevumu Doğrula
        </a>
      </div>
      <p style="color:#6b7280; font-size:12px;">Bu link 24 saat geçerlidir. Randevu talebinde bulunmadıysanız bu e-postayı yok sayabilirsiniz.</p>
    `),
  });
}

export async function sendAdminVerifiedNotification(appt: AppointmentFull, adminEmail: string) {
  await dispatch({
    from: FROM,
    to: adminEmail,
    subject: `E-posta Doğrulandı: ${appt.customer.fullName} — Onay Bekliyor`,
    html: emailTemplate("Randevu Onay Bekliyor", `
      <p><strong>${appt.customer.fullName}</strong> e-posta adresini doğruladı. Randevu admin onayı bekliyor.</p>
      <table>
        <tr><td><strong>Tarih:</strong></td><td>${new Date(appt.date).toLocaleDateString("tr-TR")}</td></tr>
        <tr><td><strong>Saat:</strong></td><td>${appt.startTime} - ${appt.endTime}</td></tr>
        <tr><td><strong>Hizmet:</strong></td><td>${appt.service?.name ?? "—"}</td></tr>
        <tr><td><strong>Çalışan:</strong></td><td>${appt.barber.name}</td></tr>
        <tr><td><strong>Telefon:</strong></td><td>${appt.customer.phone}</td></tr>
        <tr><td><strong>E-posta:</strong></td><td>${appt.customer.email ?? "—"}</td></tr>
      </table>
      <p>Admin panelinden randevuyu onaylayabilirsiniz.</p>
    `),
  });
}

export async function sendReminderEmail(appt: AppointmentFull) {
  if (!appt.customer.email) return;
  await dispatch({
    from: FROM,
    to: appt.customer.email,
    subject: "Yarınki Randevu Hatırlatması — BOSS Erkek Kuaförü",
    html: emailTemplate("Randevu Hatırlatması", `
      <p>Sayın <strong>${appt.customer.fullName}</strong>,</p>
      <p>Yarın <strong>${appt.startTime}</strong> saatinde randevunuz bulunmaktadır.</p>
      <table>
        <tr><td><strong>Hizmet:</strong></td><td>${appt.service?.name ?? "—"}</td></tr>
        <tr><td><strong>Çalışan:</strong></td><td>${appt.barber.name}</td></tr>
      </table>
    `),
  });
}

/** Günlük sağlık özetinin taşıdığı sayılar (FAZ 3 · Sıra 3.6). */
export type HealthSummary = {
  /** Özetin kapsadığı Europe/Istanbul takvim günü. */
  date: string;
  reminderSent: number;
  reminderFailed: number;
  /** Son 24 saatte doğrulanmadığı için iptal edilen randevu. */
  expiredCancelled: number;
  /** Yarın için planlı randevu (iptal edilmemiş). */
  tomorrowAppointments: number;
};

/**
 * Günlük sağlık özeti — işletme sahibine sistemin durumunu bildirir.
 *
 * ─── NEDEN VAR ───────────────────────────────────────────────────────────
 * Hatırlatma gönderimi başarısız olduğunda bu yalnızca `console.error` ile
 * runtime loguna yazılıyordu; oraya kimse bakmıyor. `RESEND_API_KEY` süresi
 * dolsa randevular alınmaya devam eder, tek bir hatırlatma gitmez ve durum
 * günlerce fark edilmez.
 *
 * Bu e-posta tek başına yeterli DEĞİLDİR: Resend tamamen çökerse özetin
 * kendisi de gitmez. Asıl emniyet ağı cron'un başarısızlıkta 5xx dönmesidir
 * (bkz. app/api/cron/route.ts) — o, e-postadan bağımsız çalışır.
 */
export async function sendDailyHealthSummary(to: string, s: HealthSummary) {
  const sorun = s.reminderFailed > 0;
  const durum = sorun
    ? `<p style="color:#f87171"><strong>${s.reminderFailed} hatırlatma gönderilemedi.</strong>
       E-posta servisinde bir sorun olabilir.</p>`
    : `<p style="color:#4ade80">Bugün beklenmedik bir durum yok.</p>`;

  await dispatch({
    from: FROM,
    to,
    subject: `${sorun ? "⚠ " : ""}Günlük Sistem Özeti (${s.date}) — BOSS Erkek Kuaförü`,
    html: emailTemplate("Günlük Sistem Özeti", `
      <p>${s.date} tarihli otomatik özet.</p>
      ${durum}
      <table>
        <tr><td><strong>Gönderilen hatırlatma:</strong></td><td>${s.reminderSent}</td></tr>
        <tr><td><strong>Başarısız hatırlatma:</strong></td><td>${s.reminderFailed}</td></tr>
        <tr><td><strong>İptal edilen (doğrulanmamış):</strong></td><td>${s.expiredCancelled}</td></tr>
        <tr><td><strong>Yarınki randevu:</strong></td><td>${s.tomorrowAppointments}</td></tr>
      </table>
      <p style="font-size:12px;color:#6b7280">Bu e-posta günde bir kez otomatik gönderilir.</p>
    `),
  });
}

function emailTemplate(title: string, body: string) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; background: #0a0a0a; color: #ffffff; margin: 0; padding: 0; }
        .wrapper { max-width: 560px; margin: 40px auto; background: #141414; border: 1px solid #2a2a2a; border-radius: 8px; overflow: hidden; }
        .header { background: #c9762c; padding: 24px 32px; }
        .header h1 { margin: 0; font-size: 20px; color: #ffffff; }
        .content { padding: 32px; }
        table { width: 100%; border-collapse: collapse; margin: 16px 0; }
        td { padding: 8px 0; color: #d1d5db; border-bottom: 1px solid #2a2a2a; }
        td:first-child { color: #9ca3af; width: 120px; }
        p { color: #d1d5db; line-height: 1.6; }
        .footer { padding: 16px 32px; text-align: center; color: #6b7280; font-size: 12px; border-top: 1px solid #2a2a2a; }
      </style>
    </head>
    <body>
      <div class="wrapper">
        <div class="header"><h1>${title}</h1></div>
        <div class="content">${body}</div>
        <div class="footer">BOSS Erkek Kuaförü &mdash; Profesyonel Erkek Bakım Stüdyosu</div>
      </div>
    </body>
    </html>
  `;
}
