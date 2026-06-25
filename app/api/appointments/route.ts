import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { sendNewBookingNotification, sendVerificationEmail } from "@/lib/mail";
import { normalizePhone, validatePhone } from "@/lib/phone";
import { calcRiskScore } from "@/lib/risk";

const schema = z.object({
  serviceId: z.string().optional(),
  serviceIds: z.array(z.string()).optional(),
  barberId: z.string().min(1),
  date: z.string().min(1),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  customerName: z.string().min(2),
  customerPhone: z.string().min(7),
  customerEmail: z.string().email().optional().or(z.literal("")),
  notes: z.string().optional(),
  status: z.enum(["pending", "confirmed"]).optional().default("pending"),
  // Honeypot — bots fill this, humans leave it empty
  website: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const phone = req.nextUrl.searchParams.get("phone");
  const appointmentId = req.nextUrl.searchParams.get("appointmentId");

  if (appointmentId) {
    const sales = await db.sale.findMany({ where: { appointmentId } });
    return Response.json({ sales });
  }

  if (!phone) return Response.json({ error: "Telefon gerekli." }, { status: 400 });

  const customer = await db.customer.findUnique({ where: { phone } });
  if (!customer) return Response.json({ appointments: [] });

  const appointments = await db.appointment.findMany({
    where: { customerId: customer.id },
    include: { service: true, barber: true, services: true },
    orderBy: { date: "desc" },
    take: 20,
  });

  return Response.json({ appointments });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  // isAdmin only when session exists AND caller explicitly sent a status field.
  // Public BookingForm never sends status; admin modal always sends status:"confirmed".
  // This prevents a logged-in admin's browser cookie from triggering the admin path
  // when the public form is submitted.
  const session = await getSession();
  const isAdmin = !!session?.userId && body.status !== undefined;

  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Geçersiz veri." }, { status: 400 });

  const { barberId, date, startTime, customerEmail, notes, status } = parsed.data;
  let { customerName, customerPhone } = parsed.data;

  // ── Honeypot ─────────────────────────────────────────────────────────────
  if (!isAdmin && parsed.data.website) {
    // Bot detected — silently return fake success
    return Response.json({ id: "fake" }, { status: 201 });
  }

  // ── Telefon normalize + doğrulama ────────────────────────────────────────
  customerPhone = normalizePhone(customerPhone);
  if (!validatePhone(customerPhone)) {
    return Response.json({ error: "Geçersiz telefon numarası. Lütfen Türkiye numarası girin (05xx xxx xx xx)." }, { status: 400 });
  }

  // ── Hizmet listesini belirle ─────────────────────────────────────────────
  const ids: string[] = parsed.data.serviceIds?.length
    ? parsed.data.serviceIds
    : parsed.data.serviceId
    ? [parsed.data.serviceId]
    : [];

  if (ids.length === 0) return Response.json({ error: "En az bir hizmet seçilmeli." }, { status: 400 });

  const svcs = await db.service.findMany({ where: { id: { in: ids } } });
  if (svcs.length === 0) return Response.json({ error: "Hizmet bulunamadı." }, { status: 404 });

  const totalDuration = svcs.reduce((s, sv) => s + sv.durationMinutes, 0);
  const totalPrice = svcs.reduce((s, sv) => s + sv.price, 0);
  const endMinutes = timeToMinutes(startTime) + totalDuration;
  const endTime = `${String(Math.floor(endMinutes / 60)).padStart(2, "0")}:${String(endMinutes % 60).padStart(2, "0")}`;

  const appointmentDate = new Date(date);

  // ── Public-only korumaları ───────────────────────────────────────────────
  let verificationToken: string | null = null;
  let riskScore = 0;
  let riskReasons: string[] = [];
  let ipAddress: string | null = null;
  let userAgent: string | null = null;
  let finalStatus: string;

  if (isAdmin) {
    finalStatus = status;
  } else {
    // E-posta zorunlu (doğrulama için)
    if (!customerEmail) {
      return Response.json({ error: "Randevu doğrulama için e-posta adresi zorunludur." }, { status: 400 });
    }

    ipAddress = req.headers.get("x-forwarded-for")?.split(",")[0].trim()
      ?? req.headers.get("x-real-ip")
      ?? "unknown";
    userAgent = req.headers.get("user-agent") ?? "";

    const cutoff10m = new Date(Date.now() - 10 * 60 * 1000);
    const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // ── Rate limit: IP başına 10 dk → max 3 ─────────────────────────────
    const ip10mCount = await db.rateLimit.count({
      where: { key: `ip:${ipAddress}`, action: "appointment", createdAt: { gte: cutoff10m } },
    });
    if (ip10mCount >= 3) {
      return Response.json({ error: "Çok fazla deneme. Lütfen 10 dakika bekleyip tekrar deneyin." }, { status: 429 });
    }

    // ── Rate limit: IP başına günde max 10 ──────────────────────────────
    const ip24hCount = await db.rateLimit.count({
      where: { key: `ip:${ipAddress}`, action: "appointment", createdAt: { gte: cutoff24h } },
    });
    if (ip24hCount >= 10) {
      return Response.json({ error: "Günlük randevu limitine ulaşıldı." }, { status: 429 });
    }

    // ── Aynı telefon + aynı gün çakışma ─────────────────────────────────
    const dayStart = new Date(appointmentDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(appointmentDate);
    dayEnd.setHours(23, 59, 59, 999);

    const existing = await db.customer.findUnique({ where: { phone: customerPhone } });
    if (existing) {
      const sameDay = await db.appointment.count({
        where: {
          customerId: existing.id,
          date: { gte: dayStart, lte: dayEnd },
          status: { notIn: ["cancelled"] },
        },
      });
      if (sameDay > 0) {
        return Response.json({ error: "Bu tarihe zaten bir randevunuz bulunuyor." }, { status: 409 });
      }
    }

    // ── Risk skoru ───────────────────────────────────────────────────────
    const risk = await calcRiskScore({ ip: ipAddress, userAgent, phone: customerPhone, email: customerEmail, customerName });
    riskScore = risk.score;
    riskReasons = risk.reasons;

    // ── Rate limit kaydı ─────────────────────────────────────────────────
    await db.rateLimit.create({ data: { key: `ip:${ipAddress}`, action: "appointment" } });

    finalStatus = "pending_verification";
    verificationToken = crypto.randomUUID();
  }

  // ── Müşteri bul veya oluştur ─────────────────────────────────────────────
  let customer = await db.customer.findUnique({ where: { phone: customerPhone } });
  if (!customer) {
    customer = await db.customer.create({
      data: { fullName: customerName, phone: customerPhone, email: customerEmail || null },
    });
  } else if (customerEmail && !customer.email) {
    // E-posta yoksa güncelle
    await db.customer.update({ where: { id: customer.id }, data: { email: customerEmail } });
  }

  // ── Randevu oluştur ──────────────────────────────────────────────────────
  const appt = await db.appointment.create({
    data: {
      barberId,
      serviceId: ids[0],
      customerId: customer.id,
      date: appointmentDate,
      startTime,
      endTime,
      notes: notes || null,
      status: finalStatus,
      appointmentPrice: totalPrice,
      verificationToken,
      ipAddress,
      userAgent,
      riskScore,
      riskReasons: riskReasons.length > 0 ? JSON.stringify(riskReasons) : null,
      services: {
        create: svcs.map((svc) => ({
          serviceId: svc.id,
          serviceName: svc.name,
          category: svc.category,
          price: svc.price,
          durationMinutes: svc.durationMinutes,
        })),
      },
    },
    include: { customer: true, barber: true, service: true, services: true },
  });

  await db.customer.update({
    where: { id: customer.id },
    data: { totalAppointments: { increment: 1 } },
  });

  // ── E-posta ──────────────────────────────────────────────────────────────
  if (isAdmin) {
    const adminSetting = await db.setting.findUnique({ where: { key: "business_email" } });
    if (adminSetting?.value) {
      try { await sendNewBookingNotification(appt, adminSetting.value); } catch {}
    }
  } else if (verificationToken && customerEmail) {
    const origin = req.nextUrl.origin;
    const verificationUrl = `${origin}/api/appointments/verify?token=${verificationToken}`;
    try { await sendVerificationEmail(appt, verificationUrl); } catch {}
  }

  return Response.json({ id: appt.id }, { status: 201 });
}

function timeToMinutes(time: string) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}
