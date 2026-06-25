import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/customers/[id]">) {
  const session = await getSession();
  if (!session?.userId) return Response.json({ error: "Yetkisiz." }, { status: 401 });

  const { id } = await ctx.params;

  const customer = await db.customer.findUnique({
    where: { id },
    include: {
      appointments: {
        include: { service: true, barber: true },
        orderBy: { date: "desc" },
        take: 50,
      },
    },
  });

  if (!customer) return Response.json({ error: "Müşteri bulunamadı." }, { status: 404 });

  const serviceCount: Record<string, number> = {};
  const barberCount: Record<string, number> = {};

  for (const appt of customer.appointments) {
    const svcName = appt.service?.name ?? "Bilinmiyor";
    serviceCount[svcName] = (serviceCount[svcName] ?? 0) + 1;
    barberCount[appt.barber.name] = (barberCount[appt.barber.name] ?? 0) + 1;
  }

  const topService = Object.entries(serviceCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const topBarber = Object.entries(barberCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return Response.json({ customer, topService, topBarber });
}

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/customers/[id]">) {
  const session = await getSession();
  if (!session?.userId) return Response.json({ error: "Yetkisiz." }, { status: 401 });

  const { id } = await ctx.params;
  const body = await req.json();
  const { tag, notes } = body;

  const customer = await db.customer.update({
    where: { id },
    data: { ...(tag ? { tag } : {}), ...(notes !== undefined ? { notes } : {}) },
  });

  return Response.json({ customer });
}
