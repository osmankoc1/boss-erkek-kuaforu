import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { sendAdminVerifiedNotification } from "@/lib/mail";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");

  if (!token) {
    return Response.redirect(new URL("/randevu?error=gecersiz_link", req.url));
  }

  const appt = await db.appointment.findUnique({
    where: { verificationToken: token },
    include: { customer: true, barber: true, service: true },
  });

  if (!appt) {
    return Response.redirect(new URL("/randevu?error=gecersiz_link", req.url));
  }

  // Zaten doğrulandıysa direkt onay sayfasına yönlendir
  if (appt.verifiedAt) {
    return Response.redirect(new URL(`/randevu/onay?id=${appt.id}`, req.url));
  }

  // 24 saat süresi dolmuş mu?
  const EXPIRY_MS = 24 * 60 * 60 * 1000;
  if (Date.now() - appt.createdAt.getTime() > EXPIRY_MS) {
    await db.appointment.update({
      where: { id: appt.id },
      data: { status: "cancelled" },
    });
    return Response.redirect(new URL("/randevu?error=link_suresi_doldu", req.url));
  }

  // Doğrulama yap
  await db.appointment.update({
    where: { id: appt.id },
    data: { verifiedAt: new Date(), status: "pending" },
  });

  // Admin'e bildirim
  const adminSetting = await db.setting.findUnique({ where: { key: "business_email" } });
  if (adminSetting?.value) {
    try { await sendAdminVerifiedNotification(appt, adminSetting.value); } catch {}
  }

  return Response.redirect(new URL(`/randevu/onay?id=${appt.id}`, req.url));
}
