import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { sendVerificationEmail } from "@/lib/mail";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session?.userId) return Response.json({ error: "Yetkisiz." }, { status: 401 });

  const { id } = await params;

  const appt = await db.appointment.findUnique({
    where: { id },
    include: { customer: true, barber: true, service: true, services: true },
  });

  if (!appt) return Response.json({ error: "Randevu bulunamadı." }, { status: 404 });
  if (appt.status !== "pending_verification") {
    return Response.json({ error: "Randevu e-posta doğrulama beklemiyordur." }, { status: 400 });
  }
  if (!appt.customer.email) {
    return Response.json({ error: "Müşterinin e-posta adresi kayıtlı değil." }, { status: 400 });
  }

  // 2 dakika rate limit
  if (appt.verificationEmailSentAt) {
    const twoMinsAgo = new Date(Date.now() - 2 * 60 * 1000);
    if (appt.verificationEmailSentAt > twoMinsAgo) {
      const remaining = Math.ceil(
        (appt.verificationEmailSentAt.getTime() + 2 * 60 * 1000 - Date.now()) / 1000
      );
      return Response.json(
        { error: `Lütfen ${remaining} saniye bekleyin.` },
        { status: 429 }
      );
    }
  }

  const token = appt.verificationToken ?? crypto.randomUUID();

  await db.appointment.update({
    where: { id },
    data: {
      verificationToken: token,
      verificationEmailSentAt: new Date(),
    },
  });

  const origin = req.nextUrl.origin;
  const verificationUrl = `${origin}/api/appointments/verify?token=${token}`;

  try {
    await sendVerificationEmail(appt, verificationUrl);
  } catch {
    return Response.json({ error: "Mail gönderilemedi. Lütfen e-posta ayarlarını kontrol edin." }, { status: 500 });
  }

  return Response.json({ ok: true });
}
