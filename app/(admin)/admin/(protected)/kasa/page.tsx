import { db } from "@/lib/db";
import { startOfDay, endOfDay } from "@/lib/sale";
import KasaClient from "./KasaClient";

export const metadata = { title: "Günlük Kasa — BOSS Admin" };

type SearchParams = Promise<{ date?: string }>;

export default async function KasaPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const selectedDate = params.date ?? today;
  const d = new Date(selectedDate);

  const [sales, barbers, services] = await Promise.all([
    db.sale.findMany({
      where: { saleDate: { gte: startOfDay(d), lte: endOfDay(d) } },
      include: { items: true },
      orderBy: { saleDate: "desc" },
    }),
    db.barber.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    db.service.findMany({ where: { isActive: true }, orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }] }),
  ]);

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight">Günlük Kasa</h1>
          <p className="text-[#9ca3af] text-sm mt-1">
            {new Date(d).toLocaleDateString("tr-TR", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
          </p>
        </div>
        <form method="GET" className="flex items-center gap-2">
          <input type="date" name="date" defaultValue={selectedDate}
            className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-md px-3 py-2 text-[13px] text-white focus:outline-none focus:border-[#c9762c]/50" />
          <button type="submit"
            className="px-4 py-2 bg-[#1a1a1a] border border-[#2a2a2a] rounded-md text-[13px] text-[#9ca3af] hover:text-white hover:border-[#3a3a3a] transition-all">
            Git
          </button>
        </form>
      </div>

      <KasaClient
        initialSales={sales.map((s) => ({ ...s, saleDate: s.saleDate.toISOString(), items: s.items ?? [] }))}
        barbers={barbers.map((b) => ({ id: b.id, name: b.name, workerType: b.workerType, commissionRate: b.commissionRate }))}
        services={services.map((s) => ({ id: s.id, name: s.name, price: s.price, durationMinutes: s.durationMinutes, category: s.category, displayOrder: s.displayOrder }))}
        selectedDate={selectedDate}
      />
    </div>
  );
}
