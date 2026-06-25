import { db } from "@/lib/db";
import { startOfDay, endOfDay } from "@/lib/sale";

export const metadata = { title: "Hakedişler — BOSS Admin" };

type SearchParams = Promise<{ range?: string; from?: string; to?: string }>;

export default async function HakedislerPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const range = params.range ?? "today";
  const fromParam = params.from;
  const toParam = params.to;

  const now = new Date();
  let dateFrom: Date;
  let dateTo: Date = endOfDay(now);

  if (range === "custom" && fromParam && toParam) {
    dateFrom = startOfDay(new Date(fromParam));
    dateTo = endOfDay(new Date(toParam));
  } else if (range === "yesterday") {
    const y = new Date(now); y.setDate(y.getDate() - 1);
    dateFrom = startOfDay(y); dateTo = endOfDay(y);
  } else if (range === "week") {
    dateFrom = new Date(now); dateFrom.setDate(dateFrom.getDate() - 6); dateFrom.setHours(0, 0, 0, 0);
  } else if (range === "month") {
    dateFrom = new Date(now.getFullYear(), now.getMonth(), 1);
  } else {
    dateFrom = startOfDay(now);
  }

  const sales = await db.sale.findMany({
    where: { saleDate: { gte: dateFrom, lte: dateTo }, saleStatus: { not: "VOIDED" } },
  });

  const barberMap = new Map<string, {
    barberId: string; barberName: string; workerType: string; commissionRate: number;
    count: number; totalSale: number; barberShare: number; businessShare: number; creditSale: number;
  }>();

  for (const s of sales) {
    if (!barberMap.has(s.barberId)) {
      barberMap.set(s.barberId, {
        barberId: s.barberId, barberName: s.barberName,
        workerType: s.barberWorkerType, commissionRate: s.barberCommissionRate,
        count: 0, totalSale: 0, barberShare: 0, businessShare: 0, creditSale: 0,
      });
    }
    const b = barberMap.get(s.barberId)!;
    b.count++;
    b.totalSale += s.saleAmount;
    b.barberShare += s.barberShare;
    b.businessShare += s.businessShare;
    if (s.saleStatus !== "PAID") b.creditSale += s.remainingAmount;
  }

  const commissions = Array.from(barberMap.values());
  const totalBarberShare = commissions.reduce((s, c) => s + c.barberShare, 0);
  const totalBusinessShare = commissions.reduce((s, c) => s + c.businessShare, 0);
  const totalSales = commissions.reduce((s, c) => s + c.totalSale, 0);
  const totalCreditSale = commissions.reduce((s, c) => s + c.creditSale, 0);

  const rangeOptions = [
    { value: "today", label: "Bugün" },
    { value: "yesterday", label: "Dün" },
    { value: "week", label: "Bu Hafta" },
    { value: "month", label: "Bu Ay" },
    { value: "custom", label: "Özel" },
  ];

  const today = now.toISOString().slice(0, 10);
  const fromValue = fromParam ?? today;
  const toValue = toParam ?? today;

  return (
    <div className="p-8">
      <div className="flex items-start justify-between mb-8 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight">Hakedişler</h1>
          <p className="text-[#9ca3af] text-sm mt-1">
            {dateFrom.toLocaleDateString("tr-TR")} — {dateTo.toLocaleDateString("tr-TR")}
          </p>
        </div>
        <div className="flex flex-col gap-2 items-end">
          <div className="flex items-center gap-2 flex-wrap">
            {rangeOptions.map((opt) => (
              <a key={opt.value} href={opt.value === "custom" ? `?range=custom&from=${fromValue}&to=${toValue}` : `?range=${opt.value}`}
                className={`px-3 py-1.5 rounded-md text-[12px] font-medium border transition-all ${
                  range === opt.value
                    ? "bg-[#c9762c]/10 border-[#c9762c]/30 text-[#c9762c]"
                    : "bg-[#1a1a1a] border-[#2a2a2a] text-[#9ca3af] hover:text-[#9ca3af] hover:border-[#3a3a3a]"
                }`}>
                {opt.label}
              </a>
            ))}
          </div>
          {range === "custom" && (
            <form method="GET" className="flex items-center gap-2">
              <input type="hidden" name="range" value="custom" />
              <input type="date" name="from" defaultValue={fromValue}
                className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-md px-3 py-1.5 text-[12px] text-white focus:outline-none focus:border-[#c9762c]/50" />
              <span className="text-[#6b7280] text-xs">—</span>
              <input type="date" name="to" defaultValue={toValue}
                className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-md px-3 py-1.5 text-[12px] text-white focus:outline-none focus:border-[#c9762c]/50" />
              <button type="submit"
                className="px-3 py-1.5 bg-[#c9762c] hover:bg-[#e8913a] rounded-md text-[12px] font-bold text-white transition-all">
                Uygula
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Özet kartları */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          { label: "Toplam Satış", value: totalSales, color: "text-white" },
          { label: "Toplam Hakediş", value: totalBarberShare, color: "text-[#c9762c]" },
          { label: "İşletme Payı", value: totalBusinessShare, color: "text-[#9ca3af]" },
          { label: "Veresiyeli Satış", value: totalCreditSale, color: "text-orange-400" },
        ].map((c) => (
          <div key={c.label} className="bg-[#0f0f0f] border border-[#1e1e1e] rounded-xl p-4">
            <p className="text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider">{c.label}</p>
            <p className={`text-xl font-black mt-1 ${c.color}`}>{c.value.toFixed(2)} <span className="text-xs font-normal text-[#9ca3af]">₺</span></p>
          </div>
        ))}
      </div>

      {/* Çalışan tablosu */}
      {commissions.length === 0 ? (
        <div className="bg-[#0f0f0f] border border-[#1e1e1e] rounded-xl p-12 text-center">
          <p className="text-[#6b7280] text-sm">Seçilen dönemde satış kaydı yok.</p>
        </div>
      ) : (
        <div className="bg-[#0f0f0f] border border-[#1e1e1e] rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-[#1a1a1a]">
            <h3 className="text-sm font-bold text-white">Çalışan Bazlı Hakediş</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#1a1a1a]">
                  {["Çalışan", "Tip", "Oran", "İşlem", "Toplam Satış", "Hakediş", "İşletme Payı", "Veresiyeli"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {commissions.map((c) => (
                  <tr key={c.barberId} className="border-b border-[#111] hover:bg-[#111] transition-colors">
                    <td className="px-4 py-3 text-[13px] text-white font-medium">{c.barberName}</td>
                    <td className="px-4 py-3">
                      <span className="text-[11px] px-2 py-0.5 rounded bg-[#1a1a1a] border border-[#2a2a2a] text-[#9ca3af]">
                        {c.workerType}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[12px] text-[#9ca3af]">{c.workerType === "COMMISSION" ? `%${c.commissionRate}` : "—"}</td>
                    <td className="px-4 py-3 text-[13px] text-white">{c.count}</td>
                    <td className="px-4 py-3 text-[13px] text-white font-semibold">{c.totalSale.toFixed(2)} ₺</td>
                    <td className="px-4 py-3 text-[13px] text-[#c9762c] font-bold">{c.barberShare.toFixed(2)} ₺</td>
                    <td className="px-4 py-3 text-[13px] text-[#9ca3af] font-semibold">{c.businessShare.toFixed(2)} ₺</td>
                    <td className="px-4 py-3 text-[13px] text-orange-400">{c.creditSale.toFixed(2)} ₺</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-[#2a2a2a] bg-[#111]">
                  <td colSpan={4} className="px-4 py-3 text-[12px] font-bold text-[#9ca3af]">Toplam</td>
                  <td className="px-4 py-3 text-[13px] font-bold text-white">{totalSales.toFixed(2)} ₺</td>
                  <td className="px-4 py-3 text-[13px] font-bold text-[#c9762c]">{totalBarberShare.toFixed(2)} ₺</td>
                  <td className="px-4 py-3 text-[13px] font-bold text-[#9ca3af]">{totalBusinessShare.toFixed(2)} ₺</td>
                  <td className="px-4 py-3 text-[13px] font-bold text-orange-400">{totalCreditSale.toFixed(2)} ₺</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      <div className="mt-6 bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-4">
        <p className="text-[11px] text-[#6b7280] font-semibold uppercase tracking-wider mb-1">Gelecek Faz Notu</p>
        <p className="text-[12px] text-[#6b7280]">
          Hakediş ödendi/ödenmedi takibi (Payout modeli) bir sonraki geliştirme fazında eklenecektir.
          Mevcut veriler bu geçişe hazır şekilde saklanmaktadır.
        </p>
      </div>
    </div>
  );
}
