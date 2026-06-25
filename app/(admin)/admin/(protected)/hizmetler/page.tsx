import { db } from "@/lib/db";
import ServiceManager from "./ServiceManager";

export const metadata = { title: "Hizmetler — BOSS Admin" };

export default async function AdminHizmetlerPage() {
  const [services, rawStats] = await Promise.all([
    db.service.findMany({ orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }] }),
    db.saleItem.groupBy({
      by: ["serviceId"],
      where: { serviceId: { not: null } },
      _count: { id: true },
      _sum: { price: true },
      _max: { createdAt: true },
    }),
  ]);

  const statsMap: Record<string, { count: number; revenue: number; lastUsed: string | null }> = {};
  for (const s of rawStats) {
    if (s.serviceId) {
      statsMap[s.serviceId] = {
        count: s._count.id,
        revenue: s._sum.price ?? 0,
        lastUsed: s._max.createdAt ? s._max.createdAt.toISOString() : null,
      };
    }
  }

  return (
    <div className="p-6 md:p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black">Hizmetler</h1>
          <p className="text-[#6b7280] text-sm">Hizmet listesini yönetin.</p>
        </div>
        <a href="/admin/hizmet-analitik"
          className="flex items-center gap-2 px-4 py-2 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg text-[13px] text-[#9ca3af] hover:text-white hover:border-[#3a3a3a] transition-all">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          Analitik
        </a>
      </div>
      <ServiceManager services={services} statsMap={statsMap} />
    </div>
  );
}
