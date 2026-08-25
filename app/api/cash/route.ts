import { NextRequest } from "next/server";
import { createdFields, isAuditableStatusChange, writeAudit } from "@/lib/audit";
import { adminActor } from "@/lib/audit-actor";
import { moneyAmount } from "@/lib/money-schema";
import { z } from "zod";
import { db } from "@/lib/db";
import { serializeSale, serializeSales } from "@/lib/money";
import { requireAdmin } from "@/lib/dal";
import { calcShares, calcStatus, startOfDay, endOfDay } from "@/lib/sale";
import { validatePhone, PHONE_ERROR } from "@/lib/phone";
import { acquireAdvisoryLock, SALE_APPOINTMENT_LOCK } from "@/lib/advisory-lock";
import { canCreateSaleFor, cashRejectionMessage } from "@/lib/appointment-status";
import { recalculateCustomerCounters } from "@/lib/customer-counters";
import { istanbulDateString } from "@/lib/tz";

const saleItemSchema = z.object({
  serviceId: z.string().optional().nullable(),
  serviceName: z.string().min(1),
  category: z.string().default("Diğer"),
  price: moneyAmount.min(0),
  durationMinutes: z.number().min(0).default(0),
});

const saleSchema = z.object({
  appointmentId: z.string().optional().nullable(),
  customerId: z.string().optional().nullable(),
  createCustomer: z.boolean().optional().default(false),
  barberId: z.string().min(1),
  // Legacy single-service (backward compat)
  serviceId: z.string().optional().nullable(),
  serviceName: z.string().optional(),
  listedPrice: moneyAmount.min(0).optional(),
  // New multi-service
  items: z.array(saleItemSchema).optional(),
  // Totals
  customerName: z.string().min(1),
  customerPhone: z.string().default(""),
  saleAmount: moneyAmount.min(0),
  paidAmount: moneyAmount.min(0),
  paymentMethod: z.enum(["CASH", "CARD", "TRANSFER", "OTHER"]).default("CASH"),
  note: z.string().optional().nullable(),
  saleDate: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const unauthorized = await requireAdmin();
  if (unauthorized) return unauthorized;

  const { searchParams } = req.nextUrl;
  const date = searchParams.get("date");
  const barberId = searchParams.get("barberId");
  const status = searchParams.get("status");
  const appointmentId = searchParams.get("appointmentId");

  const where: Record<string, unknown> = {};

  if (appointmentId) {
    where.appointmentId = appointmentId;
  } else {
    const gun = date ?? istanbulDateString();
    where.saleDate = { gte: startOfDay(gun), lte: endOfDay(gun) };
    if (barberId) where.barberId = barberId;
    if (status) where.saleStatus = status;
  }

  const sales = await db.sale.findMany({
    where,
    include: { items: true },
    orderBy: { saleDate: "desc" },
  });

  return Response.json({ sales: serializeSales(sales) });
}

export async function POST(req: NextRequest) {
  const unauthorized = await requireAdmin();
  if (unauthorized) return unauthorized;

  const body = await req.json();
  const parsed = saleSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Geçersiz veri.", details: parsed.error.flatten() }, { status: 400 });

  const data = parsed.data;
  const barber = await db.barber.findUnique({ where: { id: data.barberId } });
  if (!barber) return Response.json({ error: "Berber bulunamadı." }, { status: 404 });

  const { barberShare, businessShare } = calcShares(data.saleAmount, barber.workerType, barber.commissionRate);
  const remainingAmount = Math.round((data.saleAmount - data.paidAmount) * 100) / 100;
  const saleStatus = calcStatus(data.paidAmount, data.saleAmount);
  const saleDate = data.saleDate ? new Date(data.saleDate) : new Date();

  // Çözümlenen item listesi
  const resolvedItems = data.items ?? (data.serviceName
    ? [{ serviceId: data.serviceId ?? null, serviceName: data.serviceName, category: "Diğer", price: data.listedPrice ?? 0, durationMinutes: 0 }]
    : []);

  const snapshotServiceName = resolvedItems.map((i) => i.serviceName).join(", ") || data.serviceName || "";
  const snapshotListedPrice = resolvedItems.reduce((s, i) => s + i.price, 0) || data.listedPrice || 0;

  // Telefon validasyonu (yeni müşteri oluştururken)
  if (data.createCustomer && data.customerPhone) {
    const phone = data.customerPhone.trim();
    if (!validatePhone(phone)) {
      return Response.json({ error: PHONE_ERROR }, { status: 400 });
    }
  }

  // Müşteri çözümleme
  let resolvedCustomerId = data.customerId ?? null;
  if (data.createCustomer && data.customerPhone) {
    const existing = await db.customer.findUnique({ where: { phone: data.customerPhone } });
    if (existing) {
      resolvedCustomerId = existing.id;
    } else {
      const created = await db.customer.create({
        data: { fullName: data.customerName, phone: data.customerPhone },
      });
      resolvedCustomerId = created.id;
    }
  }

  const saleData = {
    customerId: resolvedCustomerId,
    barberId: data.barberId,
    serviceId: resolvedItems[0]?.serviceId ?? data.serviceId ?? null,
    customerName: data.customerName,
    customerPhone: data.customerPhone,
    serviceName: snapshotServiceName,
    barberName: barber.name,
    listedPrice: snapshotListedPrice,
    saleAmount: data.saleAmount,
    paidAmount: data.paidAmount,
    remainingAmount,
    paymentMethod: data.paymentMethod,
    saleStatus,
    barberWorkerType: barber.workerType,
    barberCommissionRate: barber.commissionRate,
    barberShare,
    businessShare,
    note: data.note ?? null,
    saleDate,
    items: resolvedItems.length > 0 ? {
      create: resolvedItems.map((item) => ({
        serviceId: item.serviceId ?? null,
        serviceName: item.serviceName,
        category: item.category,
        price: item.price,
        durationMinutes: item.durationMinutes,
      })),
    } : undefined,
  };

  if (data.appointmentId) {
    const appointmentId = data.appointmentId;

    // Bir randevunun yalnızca tek bir aktif kasa kaydı olabilir. Kontrol ile
    // yazma arasındaki yarış penceresini kapatmak için, randevu bazlı advisory
    // lock altında tek transaction içinde yapılır. Çift tıklama, yavaş
    // bağlantı, istek tekrarı veya doğrudan API çağrısı çift ciro üretemez.
    //
    // VOIDED satışlar kasıtlı olarak hariç: iş kuralı yanlış tutarlı bir
    // satışın void edilip yeniden girilmesine izin veriyor (bkz. Kullanım
    // Rehberi — "Yanlış fiyat girildiyse: Void edin, tekrar doğru tutar ile
    // girin").
    const actor = await adminActor();

    const outcome = await db.$transaction(async (tx) => {
      await acquireAdvisoryLock(tx, SALE_APPOINTMENT_LOCK, appointmentId);

      const appointment = await tx.appointment.findUnique({
        where: { id: appointmentId },
        select: { customerId: true, status: true },
      });
      if (!appointment) return { kind: "not_found" as const };

      // Randevu durum makinesi kasa tarafindan da uygulanir (FAZ 2 · Sira 4).
      // Iptal edilmis / onaylanmamis / e-postasi dogrulanmamis randevu icin
      // kasa kaydi acilamaz; aksi halde makine delinir ve musteri sayaclari
      // iki kez artar.
      if (!canCreateSaleFor(appointment.status)) {
        return { kind: "not_eligible" as const, status: appointment.status };
      }

      const existing = await tx.sale.findFirst({
        where: { appointmentId, saleStatus: { not: "VOIDED" } },
        select: { id: true },
      });
      if (existing) return { kind: "duplicate" as const, saleId: existing.id };

      const sale = await tx.sale.create({
        data: { ...saleData, customerId: appointment.customerId, appointmentId },
        include: { items: true },
      });
      await tx.appointment.update({
        where: { id: appointmentId },
        data: { status: "completed" },
      });
      // Sayaclar yeniden hesaplanir (FAZ 2 · Sira 7). Onceden kosulsuz
      // increment yapiliyordu; randevu PATCH ile zaten 'completed'
      // yapilmissa (Dashboard'daki "kasa kaydi eksik" akisi) ayni ziyaret
      // IKI KEZ sayiliyordu.
      await recalculateCustomerCounters(tx, appointment.customerId);

      // Pesin tahsilat odeme defterine yazilir (FAZ 2 · Sira 3).
      // Tahsilat raporlari bu defterden okunur; satis aninda alinan para da
      // bir tahsilat olayidir ve satisin gunune yazilir.
      if (data.paidAmount > 0) {
        const pesin = await tx.customerPayment.create({
          data: {
            customerId: appointment.customerId,
            saleId: sale.id,
            amount: data.paidAmount,
            paymentMethod: data.paymentMethod,
            paymentDate: saleDate,
            note: "Satış anında tahsilat",
          },
        });
        await writeAudit(tx, {
          entity: "CustomerPayment",
          entityId: pesin.id,
          action: "CREATE",
          actor,
          changes: createdFields("CustomerPayment", pesin),
        });
      }

      // Randevu 'completed'a cekildi -- isletme acisindan onemli bir gecis.
      if (isAuditableStatusChange(appointment.status, "completed")) {
        await writeAudit(tx, {
          entity: "Appointment",
          entityId: appointmentId,
          action: "STATUS_CHANGE",
          actor,
          changes: { status: { before: appointment.status, after: "completed" } },
        });
      }

      await writeAudit(tx, {
        entity: "Sale",
        entityId: sale.id,
        action: "CREATE",
        actor,
        changes: createdFields("Sale", sale),
      });

      return { kind: "created" as const, sale };
    }, { maxWait: 5_000, timeout: 15_000 });

    if (outcome.kind === "not_found") {
      return Response.json({ error: "Randevu bulunamadı." }, { status: 404 });
    }
    if (outcome.kind === "not_eligible") {
      return Response.json(
        {
          error: cashRejectionMessage(outcome.status),
          code: "APPOINTMENT_NOT_ELIGIBLE",
          currentStatus: outcome.status,
        },
        { status: 409 }
      );
    }
    if (outcome.kind === "duplicate") {
      return Response.json(
        {
          error: "Bu randevu için zaten bir kasa kaydı var. Yeniden girmek için önce mevcut satışı iptal (Void) edin.",
          code: "SALE_ALREADY_EXISTS",
          saleId: outcome.saleId,
        },
        { status: 409 }
      );
    }

    return Response.json({ sale: serializeSale(outcome.sale) }, { status: 201 });
  }

  // WALK-IN yolu artik TEK TRANSACTION icinde (FAZ 2 · Sira 10b).
  //
  // Onceden satis, odeme defteri satiri ve sayac guncellemesi ayri ayri
  // yaziliyordu: odeme satiri yazilamazsa satis "paidAmount > 0" ile ortada
  // kaliyor ve Σ(defter) = paidAmount degismezi bozuluyordu. Denetim izinin
  // ana islemle ayni transaction'da olmasi zorunlulugu bu bosluğu da kapatti.
  const walkInActor = await adminActor();

  const sale = await db.$transaction(async (tx) => {
    const olusan = await tx.sale.create({ data: saleData, include: { items: true } });

    // Pesin tahsilat odeme defterine yazilir (FAZ 2 · Sira 3).
    if (data.paidAmount > 0) {
      const pesin = await tx.customerPayment.create({
        data: {
          customerId: resolvedCustomerId,
          saleId: olusan.id,
          amount: data.paidAmount,
          paymentMethod: data.paymentMethod,
          paymentDate: saleDate,
          note: "Satış anında tahsilat",
        },
      });
      await writeAudit(tx, {
        entity: "CustomerPayment",
        entityId: pesin.id,
        action: "CREATE",
        actor: walkInActor,
        changes: createdFields("CustomerPayment", pesin),
      });
    }

    if (resolvedCustomerId) {
      await recalculateCustomerCounters(tx, resolvedCustomerId);
    }

    await writeAudit(tx, {
      entity: "Sale",
      entityId: olusan.id,
      action: "CREATE",
      actor: walkInActor,
      changes: createdFields("Sale", olusan),
    });

    return olusan;
  }, { maxWait: 5_000, timeout: 15_000 });

  return Response.json({ sale: serializeSale(sale) }, { status: 201 });
}
