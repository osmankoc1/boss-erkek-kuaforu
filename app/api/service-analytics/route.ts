import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/dal";

function rangeFromParam(range: string, from?: string, to?: string): { start: Date; end: Date } {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  if (range === "custom" && from && to) {
    return { start: new Date(from + "T00:00:00"), end: new Date(to + "T23:59:59") };
  }
  if (range === "month") {
    return { start: new Date(now.getFullYear(), now.getMonth(), 1), end };
  }
  if (range === "30d") {
    const start = new Date(now); start.setDate(start.getDate() - 29); start.setHours(0, 0, 0, 0);
    return { start, end };
  }
  // default: 7d
  const start = new Date(now); start.setDate(start.getDate() - 6); start.setHours(0, 0, 0, 0);
  return { start, end };
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
  const catMap: Record<string, { category: string; count: number; revenue: number }> = {};
  for (const item of saleItems) {
    const cat = item.category || "Diğer";
    if (!catMap[cat]) catMap[cat] = { category: cat, count: 0, revenue: 0 };
    catMap[cat].count++;
    catMap[cat].revenue += item.price;
  }
  const categoryRevenue = Object.values(catMap).sort((a, b) => b.revenue - a.revenue);

  // ── En çok satılan hizmetler ──────────────────────────────────────────────
  const svcMap: Record<string, { serviceId: string | null; serviceName: string; category: string; count: number; revenue: number; lastUsed: string }> = {};
  for (const item of saleItems) {
    const key = item.serviceId ?? item.serviceName;
    if (!svcMap[key]) svcMap[key] = { serviceId: item.serviceId, serviceName: item.serviceName, category: item.category, count: 0, revenue: 0, lastUsed: "" };
    svcMap[key].count++;
    svcMap[key].revenue += item.price;
    const d = item.sale.saleDate.toISOString();
    if (!svcMap[key].lastUsed || d > svcMap[key].lastUsed) svcMap[key].lastUsed = d;
  }
  const topServices = Object.values(svcMap)
    .map((s) => ({ ...s, avgPrice: s.count > 0 ? s.revenue / s.count : 0 }))
    .sort((a, b) => b.count - a.count);

  // ── Günlük seri ───────────────────────────────────────────────────────────
  const dailyMap: Record<string, { date: string; revenue: number; count: number }> = {};
  for (const s of sales) {
    const d = s.saleDate.toISOString().slice(0, 10);
    if (!dailyMap[d]) dailyMap[d] = { date: d, revenue: 0, count: 0 };
    dailyMap[d].revenue += s.saleAmount;
    dailyMap[d].count++;
  }
  const dailySeries = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

  // ── Çalışan bazlı dağılım ─────────────────────────────────────────────────
  const barberMap: Record<string, { barberName: string; count: number; revenue: number }> = {};
  for (const item of saleItems) {
    const bn = item.sale.barberName;
    if (!barberMap[bn]) barberMap[bn] = { barberName: bn, count: 0, revenue: 0 };
    barberMap[bn].count++;
    barberMap[bn].revenue += item.price;
  }
  const barberStats = Object.values(barberMap).sort((a, b) => b.revenue - a.revenue);

  // ── Özet ─────────────────────────────────────────────────────────────────
  const totalRevenue = saleItems.reduce((s, i) => s + i.price, 0);
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
