import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { round2, sumBy, toNumber, ZERO, type Money } from "@/lib/money";
import { startOfIstanbulDay, endOfIstanbulDay, startOfIstanbulMonth, addIstanbulDays, istanbulDateString } from "@/lib/tz";
import { requireAdmin } from "@/lib/dal";

function rangeFromParam(range: string, from?: string, to?: string): { start: Date; end: Date } {
  // Donem sinirlari Europe/Istanbul takvimine gore (bkz. lib/tz.ts).
  const now = new Date();
  const end = endOfIstanbulDay(now);

  if (range === "custom" && from && to) {
    return { start: startOfIstanbulDay(from), end: endOfIstanbulDay(to) };
  }
  if (range === "month") {
    return { start: startOfIstanbulMonth(now), end };
  }
  if (range === "30d") {
    return { start: addIstanbulDays(now, -29), end };
  }
  // default: 7d
  return { start: addIstanbulDays(now, -6), end };
}

export async function GET(req: NextRequest) {
  const unauthorized = await requireAdmin();
  if (unauthorized) return unauthorized;

  const sp = req.nextUrl.searchParams;
  const range = sp.get("range") ?? "7d";
  const { start, end } = rangeFromParam(range, sp.get("from") ?? undefined, sp.get("to") ?? undefined);

  const [saleItems, apptServices, sales] = await Promise.all([
    db.saleItem.findMany({
      where: { sale: { saleDate: { gte: start, lte: end }, saleStatus: { not: "VOIDED" } } },
      include: { sale: { select: { saleDate: true, barberId: true, barberName: true } } },
    }),
    db.appointmentService.findMany({
      where: { appointment: { date: { gte: start, lte: end } } },
    }),
    db.sale.findMany({
      where: { saleDate: { gte: start, lte: end }, saleStatus: { not: "VOIDED" } },
      select: { saleDate: true, saleAmount: true, barberName: true, barberId: true },
    }),
  ]);

  // ── Kategori bazlı gelir ──────────────────────────────────────────────────
  // Gelir birikimleri Decimal ile tutulur; her liste disa acilirken
  // number'a cevrilir (FAZ 2 · Sira 9a).
  const catMap: Record<string, { category: string; count: number; revenue: Money }> = {};
  for (const item of saleItems) {
    const cat = item.category || "Diğer";
    if (!catMap[cat]) catMap[cat] = { category: cat, count: 0, revenue: ZERO };
    catMap[cat].count++;
    catMap[cat].revenue = catMap[cat].revenue.plus(item.price);
  }
  const categoryRevenue = Object.values(catMap)
    .map((c) => ({ ...c, revenue: toNumber(round2(c.revenue)) }))
    .sort((a, b) => b.revenue - a.revenue);

  // ── En çok satılan hizmetler ──────────────────────────────────────────────
  const svcMap: Record<string, { serviceId: string | null; serviceName: string; category: string; count: number; revenue: Money; lastUsed: string }> = {};
  for (const item of saleItems) {
    const key = item.serviceId ?? item.serviceName;
    if (!svcMap[key]) svcMap[key] = { serviceId: item.serviceId, serviceName: item.serviceName, category: item.category, count: 0, revenue: ZERO, lastUsed: "" };
    svcMap[key].count++;
    svcMap[key].revenue = svcMap[key].revenue.plus(item.price);
    const d = item.sale.saleDate.toISOString();
    if (!svcMap[key].lastUsed || d > svcMap[key].lastUsed) svcMap[key].lastUsed = d;
  }
  const topServices = Object.values(svcMap)
    .map((s) => ({
      ...s,
      revenue: toNumber(round2(s.revenue)),
      avgPrice: s.count > 0 ? toNumber(round2(s.revenue.dividedBy(s.count))) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  // ── Günlük seri ───────────────────────────────────────────────────────────
  const dailyMap: Record<string, { date: string; revenue: Money; count: number }> = {};
  for (const s of sales) {
    const d = istanbulDateString(s.saleDate);
    if (!dailyMap[d]) dailyMap[d] = { date: d, revenue: ZERO, count: 0 };
    dailyMap[d].revenue = dailyMap[d].revenue.plus(s.saleAmount);
    dailyMap[d].count++;
  }
  const dailySeries = Object.values(dailyMap)
    .map((d) => ({ ...d, revenue: toNumber(round2(d.revenue)) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // ── Çalışan bazlı dağılım ─────────────────────────────────────────────────
  const barberMap: Record<string, { barberName: string; count: number; revenue: Money }> = {};
  for (const item of saleItems) {
    const bn = item.sale.barberName;
    if (!barberMap[bn]) barberMap[bn] = { barberName: bn, count: 0, revenue: ZERO };
    barberMap[bn].count++;
    barberMap[bn].revenue = barberMap[bn].revenue.plus(item.price);
  }
  const barberStats = Object.values(barberMap)
    .map((b) => ({ ...b, revenue: toNumber(round2(b.revenue)) }))
    .sort((a, b) => b.revenue - a.revenue);

  // ── Özet ─────────────────────────────────────────────────────────────────
  const totalRevenue = toNumber(sumBy(saleItems, (i) => i.price));
  const totalCount = saleItems.length;
  const uniqueSales = new Set(saleItems.map((i) => i.saleId)).size;

  return Response.json({
    range,
    start: start.toISOString(),
    end: end.toISOString(),
    summary: { totalRevenue, totalCount, uniqueSales, avgTicket: uniqueSales > 0 ? totalRevenue / uniqueSales : 0 },
    categoryRevenue,
    topServices,
    dailySeries,
    barberStats,
  });
}
