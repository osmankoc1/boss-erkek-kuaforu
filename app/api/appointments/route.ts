import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { serializeSales } from "@/lib/money";
import { sumBy } from "@/lib/money";
import { getSession } from "@/lib/session";
import { logMailFailure, sendNewBookingNotification, sendVerificationEmail } from "@/lib/mail";
import { validatePhone, PHONE_ERROR } from "@/lib/phone";
import { calcRiskScore } from "@/lib/risk";
import { acquireSlotLock, validateBookingSlot } from "@/lib/booking-guard";
import { recalculateCustomerCounters } from "@/lib/customer-counters";
import type { BookingIssueCode } from "@/lib/booking-rules";
import { displayAppointmentCode, normalizeCodeInput } from "@/lib/appointment-code";

/**
 * Admin'in bilinçli olarak (force ile) geçebileceği doğrulama hataları.
 * Dükkânda gerçek hayatta üst üste randevu verme veya mesai dışı müşteri
 * alma ihtiyacı olur; sistem admin'i kilitlememeli, yalnızca uyarmalı.
 * Veri bütünlüğüne dair hatalar (berber yok/pasif, geçersiz girdi) geçilemez.
 */
const ADMIN_OVERRIDABLE_CODES: ReadonlySet<BookingIssueCode> = new Set([
  "SLOT_TAKEN",
  "OUTSIDE_WORKING_HOURS",
  "DAY_OFF",
  "DATE_EXCEPTION",
]);

const schema = z.object({
  serviceId: z.string().optional(),
  serviceIds: z.array(z.string()).optional(),
  barberId: z.string().min(1),
  date: z.string().min(1),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  customerName: z.string().min(2),
  customerPhone: z.string().min(10),
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
    // Satış/ciro verisi dahilidir — yalnızca admin oturumuyla erişilebilir.
    const session = await getSession();
    if (!session?.userId) {
      return Response.json({ error: "Yetkisiz." }, { status: 401 });
    }
    const sales = await db.sale.findMany({ where: { appointmentId } });
    return Response.json({ sales: serializeSales(sales) });
  }

  // ── Public randevu sorgulama ─────────────────────────────────────────────
  // Telefon TEK BAŞINA yeterli değildir; randevu kodu da gerekir. Aksi halde
  // numara deneyerek başkasının randevu geçmişi okunabilirdi.
  const code = req.nextUrl.searchParams.get("code");

  if (!phone || !code) {
    return Response.json(
      { error: "Telefon numarası ve randevu kodu gereklidir." },
      { status: 400 }
    );
  }

  const trimmedPhone = phone.trim();
  if (!validatePhone(trimmedPhone)) {
    return Response.json({ error: PHONE_ERROR }, { status: 400 });
  }

  // Kaba kuvvetle kod tarama girişimlerini yavaşlatır.
  const lookupIp =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";
  const lookupCutoff = new Date(Date.now() - 10 * 60 * 1000);
  const lookupCount = await db.rateLimit.count({
    where: { key: `lookup-ip:${lookupIp}`, action: "lookup", createdAt: { gte: lookupCutoff } },
  });
  if (lookupCount >= 10) {
    return Response.json(
      { error: "Çok fazla sorgulama yapıldı. Lütfen 10 dakika sonra tekrar deneyin." },
      { status: 429 }
    );
  }
  await db.rateLimit.create({ data: { key: `lookup-ip:${lookupIp}`, action: "lookup" } });

  // Telefon yanlış, kod yanlış ve randevu yok durumları AYNI yanıtı döndürür;
  // aksi halde hangi numaraların kayıtlı olduğu çıkarılabilirdi.
  const notFound = Response.json(
    { error: "Randevu bulunamadı. Telefon numaranızı ve randevu kodunu kontrol edin." },
    { status: 404 }
  );

  const customer = await db.customer.findUnique({
    where: { phone: trimmedPhone },
    select: { id: true, fullName: true },
  });
  if (!customer) return notFound;

  // Kod, id'nin son 8 karakteridir; eşleşme veritabanında yapılır.
  const appointment = await db.appointment.findFirst({
    where: {
      customerId: customer.id,
      id: { endsWith: normalizeCodeInput(code) },
    },
    select: {
      id: true,
      date: true,
      startTime: true,
      endTime: true,
      status: true,
      appointmentPrice: true,
      barber: { select: { name: true, specialty: true } },
      service: { select: { name: true } },
      services: { select: { serviceName: true, price: true, durationMinutes: true } },
    },
  });
  if (!appointment) return notFound;

  // Yalnızca müşterinin görmesi gereken alanlar döner. `ipAddress`,
  // `userAgent`, `riskScore`, `verificationToken` gibi dahili alanlar
  // bilinçli olarak dışarıda bırakılmıştır.
  return Response.json({
    appointment: {
      id: appointment.id,
      code: displayAppointmentCode(appointment.id),
      date: appointment.date,
      startTime: appointment.startTime,
      endTime: appointment.endTime,
      status: appointment.status,
      appointmentPrice: appointment.appointmentPrice,
      customerName: customer.fullName,
      barberName: appointment.barber.name,
      barberSpecialty: appointment.barber.specialty,
      serviceName: appointment.service?.name ?? null,
      services: appointment.services,
    },
  });
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

  // ── Telefon doğrulama ─────────────────────────────────────────────────────
  customerPhone = customerPhone.trim();
  if (!validatePhone(customerPhone)) {
    return Response.json({ error: PHONE_ERROR }, { status: 400 });
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
  const totalPrice = sumBy(svcs, (sv) => sv.price);
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

  // ── Doğrulama + oluşturma (tek transaction, advisory lock altında) ───────
  // Tarayıcıya güvenilmez. Çalışma saati, kapalı gün, izin, geçmiş tarih/saat
  // ve slot doluluğu burada yeniden kontrol edilir; doğrudan API'ye atılan
  // istekler de bu kontrolden geçmek zorundadır.
  //
  // Eşzamanlılık: berber + gün için `pg_advisory_xact_lock` alınır. Aynı
  // berberin aynı günü için gelen istekler sıraya girer, böylece "kontrol et
  // → yaz" arasındaki yarış penceresi kapanır. Kilit transaction bitince
  // (commit ya da rollback) PostgreSQL tarafından otomatik bırakılır.
  //
  // Doğrulama, müşteri kaydı oluşturulmadan ÖNCE çalışır — geçersiz bir istek
  // arkasında yetim müşteri kaydı bırakmaz.
  //
  // E-posta gönderimi bilinçli olarak transaction DIŞINDA tutulur; kilit
  // süresini ağ gecikmesi kadar uzatmamak için.
  const outcome = await db.$transaction(async (tx) => {
    await acquireSlotLock(tx, barberId, appointmentDate);

    const slotCheck = await validateBookingSlot({
      barberId,
      date: appointmentDate,
      startTime,
      durationMinutes: totalDuration,
      // Admin geçmişe kayıt girebilir (dün gelen müşteriyi sonradan işlemek gibi).
      allowPast: isAdmin,
      client: tx,
    });

    if (!slotCheck.ok) {
      const adminOverride =
        isAdmin && body.force === true && ADMIN_OVERRIDABLE_CODES.has(slotCheck.code);

      if (!adminOverride) {
        return { ok: false as const, check: slotCheck };
      }
    }

    // ── Müşteri bul veya oluştur ───────────────────────────────────────────
    let customer = await tx.customer.findUnique({ where: { phone: customerPhone } });
    if (!customer) {
      customer = await tx.customer.create({
        data: { fullName: customerName, phone: customerPhone, email: customerEmail || null },
      });
    } else if (customerEmail && !customer.email) {
      // E-posta yoksa güncelle
      await tx.customer.update({ where: { id: customer.id }, data: { email: customerEmail } });
    }

    // ── Randevu oluştur ────────────────────────────────────────────────────
    const created = await tx.appointment.create({
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

    // Sayaclar gercek kayitlardan yeniden hesaplanir (FAZ 2 · Sira 7):
    // increment yerine recompute, boylece ayni olayin iki kez islenmesi
    // sayaci iki kez degistirmez.
    await recalculateCustomerCounters(tx, customer.id);

    return { ok: true as const, appt: created };
  },
  {
    // Aynı berber+gün için gelen istekler kilitte sıraya girer. Varsayılan
    // 5 sn, yoğun bir anda kuyruğun sonundaki istek için yetmeyebilir.
    maxWait: 5_000,
    timeout: 15_000,
  });

  if (!outcome.ok) {
    const { check } = outcome;
    return Response.json(
      {
        error: check.message,
        code: check.code,
        // Admin arayüzü "yine de oluştur" onayını buna göre gösterir.
        overridable: isAdmin && ADMIN_OVERRIDABLE_CODES.has(check.code),
      },
      { status: 409 }
    );
  }

  const appt = outcome.appt;

  // ── E-posta ──────────────────────────────────────────────────────────────
  if (isAdmin) {
    const adminSetting = await db.setting.findUnique({ where: { key: "business_email" } });
    if (adminSetting?.value) {
      try {
        await sendNewBookingNotification(appt, adminSetting.value);
      } catch (error) {
        logMailFailure({ kind: "admin_new_booking", appointmentId: appt.id, recipient: adminSetting.value, error });
      }
    }
  } else if (verificationToken && customerEmail) {
    const origin = req.nextUrl.origin;
    const verificationUrl = `${origin}/api/appointments/verify?token=${verificationToken}`;
    // Doğrulama maili randevu akışının zorunlu halkası: gitmezse müşteri
    // randevusunu doğrulayamaz ve cron 24 saat sonra iptal eder. Randevu yine
    // de oluşturulur (akış bozulmaz) ama başarısızlık loga düşer.
    try {
      await sendVerificationEmail(appt, verificationUrl);
      await db.appointment.update({
        where: { id: appt.id },
        data: { verificationEmailSentAt: new Date() },
      });
    } catch (error) {
      logMailFailure({ kind: "verification", appointmentId: appt.id, recipient: customerEmail, error });
    }
  }

  return Response.json({ id: appt.id }, { status: 201 });
}

function timeToMinutes(time: string) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}
