import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import type { NextRequest } from "next/server";

function timeToMinutes(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function calcOccupancy(
  barbers: { workingHours: { dayOfWeek: number; startTime: string; endTime: string; isOff: boolean }[] }[],
  rangeStart: Date,
  rangeEnd: Date,
  bookedCount: number
): number {
  let totalSlots = 0;
  const days = Math.ceil((rangeEnd.getTime() - rangeStart.getTime()) / 86400000);
  for (let i = 0; i < days; i++) {
    const day = new Date(rangeStart.getTime() + i * 86400000);
    const dow = day.getDay();
    for (const barber of barbers) {
      const wh = barber.workingHours.find((w) => w.dayOfWeek === dow);
      if (!wh || wh.isOff) continue;
      totalSlots += Math.floor((timeToMinutes(wh.endTime) - timeToMinutes(wh.startTime)) / 30);
    }
  }
  return totalSlots > 0 ? Math.min(100, Math.round((bookedCount / totalSlots) * 100)) : 0;
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.userId) return Response.json({ error: "Yetkisiz." }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const range = searchParams.get("range") ?? "month";
  const customFrom = searchParams.get("from");
  const customTo = searchParams.get("to");

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart.getTime() + 86400000);
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const weekEnd = new Date(weekStart.getTime() + 7 * 86400000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);

  let rangeStart: Date;
  let rangeEnd: Date;
  if (range === "today") { rangeStart = todayStart; rangeEnd = todayEnd; }
  else if (range === "week") { rangeStart = weekStart; rangeEnd = weekEnd; }
  else if (range === "custom" && customFrom && customTo) {
    rangeStart = new Date(customFrom);
    rangeEnd = new Date(new Date(customTo).getTime() + 86400000);
  } else {
    rangeStart = monthStart; rangeEnd = monthEnd;
  }

  const [rangeAppts, todayAppts, allCompletedAppts, barbers, last30Days, pendingAppts] = await Promise.all([
    db.appointment.findMany({
      where: { date: { gte: rangeStart, lt: rangeEnd } },
      include: { service: true, barber: true },
    }),
    db.appointment.findMany({ where: { date: { gte: todayStart, lt: todayEnd } } }),
    db.appointment.findMany({
      where: { status: "completed" },
      select: { appointmentPrice: true },
    }),
    db.barber.findMany({ where: { isActive: true }, include: { workingHours: true } }),
    db.appointment.groupBy({
      by: ["date"],
      where: { date: { gte: thirtyDaysAgo } },
      _count: { id: true },
      orderBy: { date: "asc" },
    }),
    db.appointment.findMany({
      where: { status: "pending" },
      include: { customer: true, service: true, barber: true },
      orderBy: { date: "asc" },
      take: 5,
    }),
  ]);

  // --- Gelir ---
  const rangeCompleted = rangeAppts.filter((a) => a.status === "completed");
  const rangeRevenue = rangeCompleted.reduce((s, a) => s + a.appointmentPrice, 0);
  const totalRevenue = allCompletedAppts.reduce((s, a) => s + a.appointmentPrice, 0);
  const avgTicket = rangeCompleted.length > 0 ? rangeRevenue / rangeCompleted.length : 0;

  const todayRevenue = (await db.appointment.findMany({
    where: { date: { gte: todayStart, lt: todayEnd }, status: "completed" },
    select: { appointmentPrice: true },
  })).reduce((s, a) => s + a.appointmentPrice, 0);

  const weekRevenue = (await db.appointment.findMany({
    where: { date: { gte: weekStart, lt: weekEnd }, status: "completed" },
    select: { appointmentPrice: true },
  })).reduce((s, a) => s + a.appointmentPrice, 0);

  const monthRevenue = (await db.appointment.findMany({
    where: { date: { gte: monthStart, lt: monthEnd }, status: "completed" },
    select: { appointmentPrice: true },
  })).reduce((s, a) => s + a.appointmentPrice, 0);

  // --- Berber performansı ---
  const barberMap = new Map(barbers.map((b) => [b.id, b]));
  const barberStats: Record<string, { id: string; name: string; total: number; completed: number; cancelled: number; revenue: number }> = {};
  for (const a of rangeAppts) {
    if (!barberStats[a.barberId]) {
      const b = barberMap.get(a.barberId);
      barberStats[a.barberId] = { id: a.barberId, name: b?.name ?? "?", total: 0, completed: 0, cancelled: 0, revenue: 0 };
    }
    barberStats[a.barberId].total++;
    if (a.status === "completed") { barberStats[a.barberId].completed++; barberStats[a.barberId].revenue += a.appointmentPrice; }
    if (a.status === "cancelled") barberStats[a.barberId].cancelled++;
  }
  const barberPerformance = Object.values(barberStats)
    .map((b) => ({ ...b, avgTicket: b.completed > 0 ? b.revenue / b.completed : 0 }))
    .sort((a, b) => b.revenue - a.revenue);

  // --- Hizmet performansı ---
  const serviceStats: Record<string, { id: string; name: string; count: number; revenue: number }> = {};
  for (const a of rangeAppts) {
    const svcId = a.serviceId ?? "unknown";
    const svcName = a.service?.name ?? "Bilinmiyor";
    if (!serviceStats[svcId]) {
      serviceStats[svcId] = { id: svcId, name: svcName, count: 0, revenue: 0 };
    }
    serviceStats[svcId].count++;
    if (a.status === "completed") serviceStats[svcId].revenue += a.appointmentPrice;
  }
  const servicePerformance = Object.values(serviceStats)
    .map((s) => ({ ...s, avgPrice: s.count > 0 ? s.revenue / s.count : 0 }))
    .sort((a, b) => b.count - a.count);

  // --- En yoğun saatler ---
  const hourCounts: Record<string, number> = {};
  for (const a of rangeAppts) {
    const hour = a.startTime.split(":")[0];
    hourCounts[hour] = (hourCounts[hour] ?? 0) + 1;
  }
  const busiestHours = Object.entries(hourCounts)
    .map(([hour, count]) => ({ hour: `${hour}:00`, count }))
    .sort((a, b) => a.hour.localeCompare(b.hour));

  // --- En yoğun günler ---
  const dayCounts: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  for (const a of rangeAppts) dayCounts[new Date(a.date).getDay()]++;
  const dayNames = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
  const busiestDays = Object.entries(dayCounts).map(([d, count]) => ({ day: dayNames[Number(d)], count }));

  // --- Doluluk oranları ---
  const todayBooked = todayAppts.filter((a) => a.status !== "cancelled").length;
  const weekBooked = rangeAppts.filter((a) => a.status !== "cancelled").length;

  const todayOccupancy = calcOccupancy(barbers, todayStart, todayEnd, todayBooked);
  const weekOccupancy = calcOccupancy(barbers, weekStart, weekEnd,
    (await db.appointment.count({ where: { date: { gte: weekStart, lt: weekEnd }, status: { not: "cancelled" } } })));
  const monthOccupancy = calcOccupancy(barbers, monthStart, monthEnd,
    (await db.appointment.count({ where: { date: { gte: monthStart, lt: monthEnd }, status: { not: "cancelled" } } })));

  // --- Customers ---
  const [totalCustomers, newCustomers, returningCustomers] = await Promise.all([
    db.customer.count(),
    db.customer.count({ where: { createdAt: { gte: monthStart } } }),
    db.customer.count({ where: { completedCount: { gt: 1 } } }),
  ]);

  return Response.json({
    range: { label: range, start: rangeStart, end: rangeEnd },
    revenue: {
      range: rangeRevenue,
      today: todayRevenue,
      week: weekRevenue,
      month: monthRevenue,
      total: totalRevenue,
      avg: avgTicket,
    },
    today: {
      total: todayAppts.length,
      pending: todayAppts.filter((a) => a.status === "pending").length,
      confirmed: todayAppts.filter((a) => a.status === "confirmed").length,
      completed: todayAppts.filter((a) => a.status === "completed").length,
      cancelled: todayAppts.filter((a) => a.status === "cancelled").length,
    },
    occupancy: { today: todayOccupancy, week: weekOccupancy, month: monthOccupancy },
    barberPerformance,
    servicePerformance,
    busiestHours,
    busiestDays,
    customers: {
      total: totalCustomers,
      newThisMonth: newCustomers,
      returning: returningCustomers,
      rate: totalCustomers > 0 ? Math.round((returningCustomers / totalCustomers) * 100) : 0,
    },
    last30Days: last30Days.map((d) => ({
      date: new Date(d.date).toLocaleDateString("tr-TR", { month: "short", day: "numeric" }),
      count: d._count.id,
    })),
    pendingAppts,
  });
}
