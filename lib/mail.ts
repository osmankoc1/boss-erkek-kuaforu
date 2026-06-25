import { Resend } from "resend";
import type { Appointment, Customer, Barber, Service } from "@/app/generated/prisma/client";

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.RESEND_FROM_EMAIL ?? "randevu@boss-kuafor.com";

type AppointmentFull = Appointment & { customer: Customer; barber: Barber; service: Service | null };

export async function sendNewBookingNotification(appt: AppointmentFull, adminEmail: string) {
  await resend.emails.send({
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
  await resend.emails.send({
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
      </table>
      <p>Görüşmek üzere!</p>
    `),
  });
}

export async function sendCancellationEmail(appt: AppointmentFull) {
  if (!appt.customer.email) return;
  await resend.emails.send({
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
  await resend.emails.send({
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
      </table>
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
  await resend.emails.send({
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
  await resend.emails.send({
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
