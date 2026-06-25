import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/dal";
import { calcShares, calcStatus, startOfDay, endOfDay } from "@/lib/sale";

const saleItemSchema = z.object({
  serviceId: z.string().optional().nullable(),
  serviceName: z.string().min(1),
  category: z.string().default("Diğer"),
  price: z.number().min(0),
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
  listedPrice: z.number().min(0).optional(),
  // New multi-service
  items: z.array(saleItemSchema).optional(),
  // Totals
  customerName: z.string().min(1),
  customerPhone: z.string().default(""),
  saleAmount: z.number().min(0),
  paidAmount: z.number().min(0),
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
    if (date) {
      const d = new Date(date);
      where.saleDate = { gte: startOfDay(d), lte: endOfDay(d) };
    } else {
      const today = new Date();
      where.saleDate = { gte: startOfDay(today), lte: endOfDay(today) };
    }
    if (barberId) where.barberId = barberId;
    if (status) where.saleStatus = status;
  }

  const sales = await db.sale.findMany({
    where,
    include: { items: true },
    orderBy: { saleDate: "desc" },
  });

  return Response.json({ sales });
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
    const appointment = await db.appointment.findUnique({
      where: { id: data.appointmentId },
      include: { customer: true },
    });
    if (!appointment) return Response.json({ error: "Randevu bulunamadı." }, { status: 404 });

    const [sale] = await db.$transaction([
      db.sale.create({
        data: { ...saleData, customerId: appointment.customerId, appointmentId: data.appointmentId },
        include: { items: true },
      }),
      db.appointment.update({
        where: { id: data.appointmentId },
        data: { status: "completed" },
      }),
      db.customer.update({
        where: { id: appointment.customerId },
        data: { completedCount: { increment: 1 }, lastVisitAt: saleDate },
      }),
    ]);

    return Response.json({ sale }, { status: 201 });
  }

  const sale = await db.sale.create({ data: saleData, include: { items: true } });

  if (resolvedCustomerId) {
    await db.customer.update({
      where: { id: resolvedCustomerId },
      data: { lastVisitAt: saleDate },
    });
  }

  return Response.json({ sale }, { status: 201 });
}
