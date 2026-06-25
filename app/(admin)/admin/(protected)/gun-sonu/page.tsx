import { db } from "@/lib/db";
import { startOfDay, endOfDay } from "@/lib/sale";
import ExpenseSection from "./ExpenseSection";

export const metadata = { title: "Gün Sonu — BOSS Admin" };

type SearchParams = Promise<{ date?: string }>;

const METHOD_LABELS: Record<string, string> = {
  CASH: "Nakit", CARD: "Kart", TRANSFER: "Havale", OTHER: "Diğer",
};

export default async function GunSonuPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const selectedDate = params.date ?? today;
  const d = new Date(selectedDate);

  const [sales, expenses] = await Promise.all([
    db.sale.findMany({ where: { saleDate: { gte: startOfDay(d), lte: endOfDay(d) } } }),
    db.expense.findMany({ where: { expenseDate: { gte: startOfDay(d), lte: endOfDay(d) } }, orderBy: { expenseDate: "desc" } }),
  ]);

  const active = sales.filter((s) => s.saleStatus !== "VOIDED");
  const totalSales = active.reduce((s, r) => s + r.saleAmount, 0);
  const totalPaid = active.reduce((s, r) => s + r.paidAmount, 0);
  const totalCredit = active.reduce((s, r) => s + r.remainingAmount, 0);
  const totalBarberShare = active.reduce((s, r) => s + r.barberShare, 0);
  const totalBusinessShare = active.reduce((s, r) => s + r.businessShare, 0);
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
  const netCash = totalPaid - totalExpenses;

  const byMethod: Record<string, number> = {};
  for (const s of active) byMethod[s.paymentMethod] = (byMethod[s.paymentMethod] ?? 0) + s.paidAmount;

  // Çalışan bazlı
  const barberMap = new Map<string, {
    barberId: string; barberName: string; workerType: string; commissionRate: number;
    count: number; totalSale: number; barberShare: number; businessShare: number;
    totalPaid: number; totalCredit: number;
  }>();

  for (const s of active) {
    if (!barberMap.has(s.barberId)) {
      barberMap.set(s.barberId, {
        barberId: s.barberId, barberName: s.barberName,
        workerType: s.barberWorkerType, commissionRate: s.barberCommissionRate,
        count: 0, totalSale: 0, barberShare: 0, businessShare: 0, totalPaid: 0, totalCredit: 0,
      });
    }
    const b = barberMap.get(s.barberId)!;
    b.count++;
    b.totalSale += s.saleAmount;
    b.barberShare += s.barberShare;
    b.businessShare += s.businessShare;
    b.totalPaid += s.paidAmount;
    b.totalCredit += s.remainingAmount;
  }

  const byBarber = Array.from(barberMap.values());

  const summaryCards = [
    { label: "Toplam Satış", value: totalSales, color: "text-white", sub: `${active.length} işlem` },
    { label: "Toplam Tahsilat", value: totalPaid, color: "text-green-400", sub: "Nakit + Kart + Havale" },
    { label: "Toplam Gider", value: totalExpenses, color: "text-red-400", sub: `${expenses.length} gider kalemi` },
    { label: "Net Kasa", value: netCash, color: netCash >= 0 ? "text-[#c9762c]" : "text-red-400", sub: "Tahsilat − Gider" },
    { label: "Veresiye", value: totalCredit, color: "text-orange-400", sub: "Açık alacaklar" },
    { label: "Kalfa Hakedişi", value: totalBarberShare, color: "text-purple-400", sub: "Toplam çalışan payı" },
    { label: "İşletme Payı", value: totalBusinessShare, color: "text-[#9ca3af]", sub: "" },
  ];

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight">Gün Sonu Raporu</h1>
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

      {/* Özet kartları */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {summaryCards.map((c) => (
          <div key={c.label} className="bg-[#0f0f0f] border border-[#1e1e1e] rounded-xl p-4">
            <p className="text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider">{c.label}</p>
            <p className={`text-xl font-black mt-1 ${c.color}`}>{c.value.toFixed(2)} <span className="text-xs font-normal text-[#9ca3af]">₺</span></p>
            {c.sub && <p className="text-[10px] text-[#6b7280] mt-0.5">{c.sub}</p>}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        {/* Ödeme tipi dağılımı */}
        <div className="bg-[#0f0f0f] border border-[#1e1e1e] rounded-xl p-5">
          <h3 className="text-sm font-bold text-white mb-4">Ödeme Tipi Dağılımı</h3>
          <div className="space-y-3">
            {Object.entries(METHOD_LABELS).map(([key, label]) => (
              <div key={key} className="flex items-center justify-between">
                <span className="text-[13px] text-[#9ca3af]">{label}</span>
                <span className="text-[13px] font-semibold text-white">{(byMethod[key] ?? 0).toFixed(2)} ₺</span>
              </div>
            ))}
          </div>
        </div>

        {/* İptal */}
        <div className="bg-[#0f0f0f] border border-[#1e1e1e] rounded-xl p-5">
          <h3 className="text-sm font-bold text-white mb-4">Genel Bakış</h3>
          <div className="space-y-3">
            <div className="flex justify-between"><span className="text-[13px] text-[#9ca3af]">Aktif Satış</span><span className="text-[13px] font-semibold text-white">{active.length}</span></div>
            <div className="flex justify-between"><span className="text-[13px] text-[#9ca3af]">İptal Edilen</span><span className="text-[13px] font-semibold text-[#9ca3af]">{sales.length - active.length}</span></div>
            <div className="flex justify-between"><span className="text-[13px] text-[#9ca3af]">Tam Ödeme</span><span className="text-[13px] font-semibold text-green-400">{active.filter(s => s.saleStatus === "PAID").length}</span></div>
            <div className="flex justify-between"><span className="text-[13px] text-[#9ca3af]">Açık Borç</span><span className="text-[13px] font-semibold text-orange-400">{active.filter(s => s.saleStatus !== "PAID").length}</span></div>
          </div>
        </div>

        {/* Gider section */}
        <ExpenseSection
          initialExpenses={expenses.map((e) => ({ ...e, expenseDate: e.expenseDate.toISOString() }))}
          selectedDate={selectedDate}
        />
      </div>

      {/* Çalışan bazlı */}
      {byBarber.length > 0 && (
        <div className="bg-[#0f0f0f] border border-[#1e1e1e] rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-[#1a1a1a]">
            <h3 className="text-sm font-bold text-white">Çalışan Bazlı Performans</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#1a1a1a]">
                  {["Çalışan", "Tip", "Oran", "İşlem", "Satış", "Çalışan Payı", "İşletme Payı", "Tahsilat", "Veresiye"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {byBarber.map((b) => (
                  <tr key={b.barberId} className="border-b border-[#111] hover:bg-[#111] transition-colors">
                    <td className="px-4 py-3 text-[13px] text-white font-medium">{b.barberName}</td>
                    <td className="px-4 py-3 text-[12px] text-[#9ca3af]">{b.workerType}</td>
                    <td className="px-4 py-3 text-[12px] text-[#9ca3af]">{b.workerType === "COMMISSION" ? `%${b.commissionRate}` : "—"}</td>
                    <td className="px-4 py-3 text-[13px] text-white">{b.count}</td>
                    <td className="px-4 py-3 text-[13px] text-white font-semibold">{b.totalSale.toFixed(2)} ₺</td>
                    <td className="px-4 py-3 text-[13px] text-[#c9762c] font-semibold">{b.barberShare.toFixed(2)} ₺</td>
                    <td className="px-4 py-3 text-[13px] text-[#9ca3af] font-semibold">{b.businessShare.toFixed(2)} ₺</td>
                    <td className="px-4 py-3 text-[13px] text-green-400">{b.totalPaid.toFixed(2)} ₺</td>
                    <td className="px-4 py-3 text-[13px] text-orange-400">{b.totalCredit.toFixed(2)} ₺</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
