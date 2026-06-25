import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { sendConfirmationEmail, sendCancellationEmail } from "@/lib/mail";

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/appointments/[id]">) {
  const { id } = await ctx.params;
  const body = await req.json();
  const { status } = body;

  if (!["confirmed", "cancelled", "completed"].includes(status)) {
    return Response.json({ error: "Geçersiz durum." }, { status: 400 });
  }

  // pending_verification → sadece cancelled geçişine izin ver (session gerekmez)
  const existing = await db.appointment.findUnique({ where: { id }, select: { status: true } });
  if (existing?.status === "pending_verification" && status !== "cancelled") {
    return Response.json({ error: "E-posta doğrulanmamış randevu onaylanamaz." }, { status: 400 });
  }

  const session = await getSession();
  const isAdmin = !!session?.userId;

  if (!isAdmin && status !== "cancelled") {
    return Response.json({ error: "Yetkisiz." }, { status: 401 });
  }

  const appt = await db.appointment.update({
    where: { id },
    data: { status },
    include: { customer: true, barber: true, service: true },
  });

  if (status === "cancelled") {
    await db.customer.update({
      where: { id: appt.customerId },
      data: { cancelledCount: { increment: 1 } },
    });
    try { await sendCancellationEmail(appt); } catch {}
  }

  if (status === "confirmed") {
    try { await sendConfirmationEmail(appt); } catch {}
  }

  if (status === "completed") {
    await db.customer.update({
      where: { id: appt.customerId },
      data: { completedCount: { increment: 1 }, lastVisitAt: new Date() },
    });
  }

  return Response.json({ ok: true });
}

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/appointments/[id]">) {
  const session = await getSession();
  if (!session?.userId) return Response.json({ error: "Yetkisiz." }, { status: 401 });

  const { id } = await ctx.params;
  await db.appointment.delete({ where: { id } });
  return Response.json({ ok: true });
}
