import { db } from "@/lib/db";
import HizmetAnalitikClient from "./HizmetAnalitikClient";

export const metadata = { title: "Hizmet Analitiği — BOSS Admin" };

type SearchParams = Promise<{ range?: string; from?: string; to?: string }>;

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
  const start = new Date(now); start.setDate(start.getDate() - 6); start.setHours(0, 0, 0, 0);
  return { start, end };
}

export default async function HizmetAnalitikPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const range = params.range ?? "7d";
  const { start, end } = rangeFromParam(range, params.from, params.to);

  const [saleItems, sales] = await Promise.all([
    db.saleItem.findMany({
      where: { sale: { saleDate: { gte: start, lte: end }, saleStatus: { not: "VOIDED" } } },
      include: { sale: { select: { saleDate: true, barberName: true } } },
    }),
    db.sale.findMany({
      where: { saleDate: { gte: start, lte: end }, saleStatus: { not: "VOIDED" } },
      select: { id: true, saleDate: true, saleAmount: true },
    }),
  ]);

  // Category revenue
  const catMap: Record<string, { category: string; count: number; revenue: number }> = {};
  for (const item of saleItems) {
    const cat = item.category || "Diğer";
    if (!catMap[cat]) catMap[cat] = { category: cat, count: 0, revenue: 0 };
    catMap[cat].count++;
    catMap[cat].revenue += item.price;
  }
  const categoryRevenue = Object.values(catMap).sort((a, b) => b.revenue - a.revenue);

  // Top services
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

  // Daily series
  const dailyMap: Record<string, { date: string; revenue: number; count: number }> = {};
  for (const s of sales) {
    const d = s.saleDate.toISOString().slice(0, 10);
    if (!dailyMap[d]) dailyMap[d] = { date: d, revenue: 0, count: 0 };
    dailyMap[d].revenue += s.saleAmount;
    dailyMap[d].count++;
  }
  const dailySeries = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

  // Barber stats
  const barberMap: Record<string, { barberName: string; count: number; revenue: number }> = {};
  for (const item of saleItems) {
    const bn = item.sale.barberName;
    if (!barberMap[bn]) barberMap[bn] = { barberName: bn, count: 0, revenue: 0 };
    barberMap[bn].count++;
    barberMap[bn].revenue += item.price;
  }
  const barberStats = Object.values(barberMap).sort((a, b) => b.revenue - a.revenue);

  // Summary
  const totalRevenue = saleItems.reduce((s, i) => s + i.price, 0);
  const totalCount = saleItems.length;
  const uniqueSales = new Set(saleItems.map((i) => i.saleId)).size;

  return (
    <div className="p-6 md:p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black">Hizmet Analitiği</h1>
          <p className="text-[#6b7280] text-sm">Hizmet satış ve gelir istatistikleri.</p>
        </div>
        <a href="/admin/hizmetler"
          className="flex items-center gap-2 px-4 py-2 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg text-[13px] text-[#9ca3af] hover:text-white hover:border-[#3a3a3a] transition-all">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Yönetim
        </a>
      </div>

      <HizmetAnalitikClient
        range={range}
        from={params.from}
        to={params.to}
        summary={{ totalRevenue, totalCount, uniqueSales, avgTicket: uniqueSales > 0 ? totalRevenue / uniqueSales : 0 }}
        categoryRevenue={categoryRevenue}
        topServices={topServices}
        dailySeries={dailySeries}
        barberStats={barberStats}
      />
    </div>
  );
}
