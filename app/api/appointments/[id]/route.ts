import type { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { logMailFailure, sendConfirmationEmail, sendCancellationEmail } from "@/lib/mail";
import { matchesAppointmentCode } from "@/lib/appointment-code";
import { ALLOWED_TRANSITIONS } from "@/lib/appointment-status";
import { isRecordNotFound } from "@/lib/prisma-errors";

// Durum gecis makinesi lib/appointment-status.ts icinde (FAZ 2 · Sira 4);
// kasa tarafi da ayni kaynagi kullaniyor.

/** Oturumu olmayan (public) çağıranın yapabileceği tek geçiş. */
const PUBLIC_ALLOWED_STATUS = "cancelled";

const patchSchema = z.object({
  status: z.enum(["confirmed", "cancelled", "completed"]),
  /** Public iptalde zorunlu: randevu sahibinin telefonu. */
  phone: z.string().optional(),
  /** Public iptalde zorunlu: onay sayfasındaki randevu kodu (id'nin son 8 hanesi). */
  code: z.string().optional(),
});


/** Public iptal denemeleri için kaba kuvvet koruması. */
async function isRateLimited(ip: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - 10 * 60 * 1000);
  const count = await db.rateLimit.count({
    where: { key: `cancel-ip:${ip}`, action: "cancel", createdAt: { gte: cutoff } },
  });
  return count >= 10;
}

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/appointments/[id]">) {
  const { id } = await ctx.params;

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Geçersiz durum." }, { status: 400 });
  }
  const { status, phone, code } = parsed.data;

  const session = await getSession();
  const isAdmin = !!session?.userId;

  const appt = await db.appointment.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      customerId: true,
      customer: { select: { phone: true } },
    },
  });
  if (!appt) {
    return Response.json({ error: "Randevu bulunamadı." }, { status: 404 });
  }

  // ── Yetkilendirme ─────────────────────────────────────────────────────────
  if (!isAdmin) {
    // Public çağıran yalnızca iptal edebilir; onaylama/tamamlama admin işidir.
    if (status !== PUBLIC_ALLOWED_STATUS) {
      return Response.json({ error: "Yetkisiz." }, { status: 401 });
    }

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
      req.headers.get("x-real-ip") ??
      "unknown";

    if (await isRateLimited(ip)) {
      return Response.json(
        { error: "Çok fazla deneme. Lütfen 10 dakika sonra tekrar deneyin." },
        { status: 429 }
      );
    }
    await db.rateLimit.create({ data: { key: `cancel-ip:${ip}`, action: "cancel" } });

    // Randevu sahipliği: telefon + randevu kodu birlikte doğrulanır.
    // Yalnızca randevu ID'sini bilen biri (kod ID'den türediği için onu da
    // bilir) telefonu bilmeden iptal edemez.
    const phoneOk = !!phone && phone.trim() === appt.customer.phone;
    const codeOk = !!code && matchesAppointmentCode(appt.id, code);

    if (!phoneOk || !codeOk) {
      return Response.json(
        { error: "Randevu doğrulaması başarısız. Telefon numaranızı ve randevu kodunu kontrol edin." },
        { status: 401 }
      );
    }
  }

  // ── Durum geçişi geçerli mi ───────────────────────────────────────────────
  const allowed = ALLOWED_TRANSITIONS[appt.status] ?? [];
  if (!allowed.includes(status)) {
    const alreadyThere = appt.status === status;
    return Response.json(
      {
        error: alreadyThere
          ? `Bu randevu zaten "${status}" durumunda.`
          : `"${appt.status}" durumundaki bir randevu "${status}" yapılamaz.`,
        code: "INVALID_TRANSITION",
        currentStatus: appt.status,
      },
      { status: 409 }
    );
  }

  // ── Geçişi uygula ─────────────────────────────────────────────────────────
  // Koşullu update: yalnızca durum hâlâ okuduğumuz değerdeyse yazar. Aynı anda
  // gelen ikinci bir istek 0 satır günceller ve hiçbir yan etki üretmez —
  // sayaçlar bir kez değişir, e-posta bir kez gider.
  const result = await db.$transaction(async (tx) => {
    const updated = await tx.appointment.updateMany({
      where: { id, status: appt.status },
      data: { status },
    });
    if (updated.count === 0) return { applied: false as const };

    if (status === "cancelled") {
      await tx.customer.update({
        where: { id: appt.customerId },
        data: { cancelledCount: { increment: 1 } },
      });
    } else if (status === "completed") {
      await tx.customer.update({
        where: { id: appt.customerId },
        data: { completedCount: { increment: 1 }, lastVisitAt: new Date() },
      });
    }

    return { applied: true as const };
  });

  if (!result.applied) {
    // Yarışı kaybettik: başka bir istek durumu bu arada değiştirdi.
    return Response.json(
      { error: "Randevu durumu bu sırada değişti. Lütfen sayfayı yenileyin.", code: "INVALID_TRANSITION" },
      { status: 409 }
    );
  }

  // ── E-posta (transaction dışında, yalnızca gerçek geçişte) ────────────────
  if (status === "cancelled" || status === "confirmed") {
    const full = await db.appointment.findUnique({
      where: { id },
      include: { customer: true, barber: true, service: true },
    });
    if (full) {
      try {
        if (status === "cancelled") await sendCancellationEmail(full);
        else await sendConfirmationEmail(full);
      } catch (error) {
        logMailFailure({
          kind: status === "cancelled" ? "cancellation" : "confirmation",
          appointmentId: id,
          recipient: full.customer.email,
          error,
        });
      }
    }
  }

  return Response.json({ ok: true });
}

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/appointments/[id]">) {
  const session = await getSession();
  if (!session?.userId) return Response.json({ error: "Yetkisiz." }, { status: 401 });

  const { id } = await ctx.params;
  try {
    await db.appointment.delete({ where: { id } });
  } catch (error) {
    // Var olmayan randevu: Prisma P2025 firlatir. PATCH ile ayni sekilde
    // 404 donulur; diger hatalar gercek sunucu hatasi olarak kalir.
    if (isRecordNotFound(error)) {
      return Response.json({ error: "Randevu bulunamadı." }, { status: 404 });
    }
    throw error;
  }
  return Response.json({ ok: true });
}
