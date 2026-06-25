"use client";
import { useState, useCallback, useTransition } from "react";
import { useRouter } from "next/navigation";
import SaleModal from "./SaleModal";

type SaleItem = { id: string; serviceName: string; price: number; category: string };
type Sale = {
  id: string; customerId: string | null; customerName: string; customerPhone: string; serviceName: string;
  barberName: string; saleAmount: number; paidAmount: number; remainingAmount: number;
  paymentMethod: string; saleStatus: string; barberShare: number; businessShare: number;
  note: string | null; saleDate: string; items: SaleItem[];
};
type Barber = { id: string; name: string; workerType: string; commissionRate: number };
type Service = { id: string; name: string; price: number; durationMinutes: number; category: string; displayOrder: number };

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  PAID: { label: "Ödendi", cls: "bg-green-500/10 text-green-400 border-green-500/20" },
  PARTIAL: { label: "Kısmi", cls: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20" },
  CREDIT: { label: "Veresiye", cls: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
  VOIDED: { label: "İptal", cls: "bg-[#2a2a2a] text-[#9ca3af] border-[#3a3a3a]" },
};

const METHOD_LABELS: Record<string, string> = {
  CASH: "Nakit", CARD: "Kart", TRANSFER: "Havale", OTHER: "Diğer",
};

type Props = {
  initialSales: Sale[];
  barbers: Barber[];
  services: Service[];
  selectedDate: string;
};

export default function KasaClient({ initialSales, barbers, services, selectedDate }: Props) {
  const router = useRouter();
  const [sales, setSales] = useState(initialSales);
  const [showModal, setShowModal] = useState(false);
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [filterBarberId, setFilterBarberId] = useState("");
  const [, startTransition] = useTransition();

  const refresh = useCallback(() => {
    startTransition(() => router.refresh());
    fetch(`/api/cash?date=${selectedDate}`)
      .then((r) => r.json())
      .then((d) => setSales((d.sales ?? []).map((s: Sale) => ({ ...s, items: s.items ?? [] }))));
  }, [router, selectedDate]);

  async function handleVoid(id: string) {
    if (!confirm("Bu satışı iptal etmek istediğinize emin misiniz?")) return;
    setVoidingId(id);
    await fetch(`/api/cash/${id}/void`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    setVoidingId(null);
    refresh();
  }

  const filteredSales = filterBarberId
    ? sales.filter((s) => {
        const b = barbers.find((b) => b.id === filterBarberId);
        return b ? s.barberName === b.name : true;
      })
    : sales;

  const activeSales = filteredSales.filter(s => s.saleStatus !== "VOIDED");
  const totalSales = activeSales.reduce((s, r) => s + r.saleAmount, 0);
  const totalPaid = activeSales.reduce((s, r) => s + r.paidAmount, 0);
  const totalCredit = activeSales.reduce((s, r) => s + r.remainingAmount, 0);

  return (
    <>
      {/* Özet */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: filterBarberId ? `Satış (${barbers.find(b => b.id === filterBarberId)?.name})` : "Toplam Satış", value: totalSales, color: "text-white" },
          { label: "Tahsilat", value: totalPaid, color: "text-green-400" },
          { label: "Veresiye", value: totalCredit, color: "text-orange-400" },
        ].map((c) => (
          <div key={c.label} className="bg-[#0f0f0f] border border-[#1e1e1e] rounded-xl p-4">
            <p className="text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider mb-1">{c.label}</p>
            <p className={`text-2xl font-black ${c.color}`}>{c.value.toFixed(2)} <span className="text-sm font-normal text-[#9ca3af]">₺</span></p>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <select
            value={filterBarberId}
            onChange={(e) => setFilterBarberId(e.target.value)}
            className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-md px-3 py-1.5 text-[12px] text-white focus:outline-none focus:border-[#c9762c]/50"
          >
            <option value="">Tüm Çalışanlar</option>
            {barbers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <p className="text-[13px] text-[#9ca3af]">{filteredSales.length} kayıt</p>
        </div>
        <button onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-[#c9762c] hover:bg-[#e8913a] rounded-md text-[13px] font-bold text-white transition-all">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Yeni Satış
        </button>
      </div>

      {/* Tablo */}
      <div className="bg-[#0f0f0f] border border-[#1e1e1e] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#1a1a1a]">
                {["Saat", "Müşteri", "Hizmet", "Çalışan", "Satış", "Ödenen", "Kalan", "Tip", "Durum", "Kalfa Payı", "İşletme", ""].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredSales.length === 0 && (
                <tr><td colSpan={12} className="px-4 py-8 text-center text-[#6b7280] text-sm">
                  {filterBarberId ? "Bu çalışan için kayıt yok." : "Bugün için kasa kaydı yok."}
                </td></tr>
              )}
              {filteredSales.map((s) => {
                const st = STATUS_LABELS[s.saleStatus] ?? STATUS_LABELS.PAID;
                const voided = s.saleStatus === "VOIDED";
                return (
                  <tr key={s.id} className={`border-b border-[#111] hover:bg-[#111] transition-colors ${voided ? "opacity-40" : ""}`}>
                    <td className="px-4 py-3 text-[12px] text-[#9ca3af] whitespace-nowrap">
                      {new Date(s.saleDate).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="px-4 py-3">
                      {s.customerId ? (
                        <a href={`/admin/musteriler/${s.customerId}`} className="group">
                          <p className="text-[13px] text-white font-medium group-hover:text-[#c9762c] transition-colors">{s.customerName}</p>
                          {s.customerPhone && <p className="text-[11px] text-[#6b7280]">{s.customerPhone}</p>}
                        </a>
                      ) : (
                        <>
                          <p className="text-[13px] text-white font-medium">{s.customerName}</p>
                          {s.customerPhone && <p className="text-[11px] text-[#6b7280]">{s.customerPhone}</p>}
                        </>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[12px] text-[#9ca3af]">
                      {s.items?.length > 0 ? s.items.map((i) => i.serviceName).join(", ") : s.serviceName}
                    </td>
                    <td className="px-4 py-3 text-[12px] text-[#9ca3af] whitespace-nowrap">{s.barberName}</td>
                    <td className="px-4 py-3 text-[13px] text-white font-semibold whitespace-nowrap">{s.saleAmount.toFixed(2)} ₺</td>
                    <td className="px-4 py-3 text-[13px] text-green-400 font-semibold whitespace-nowrap">{s.paidAmount.toFixed(2)} ₺</td>
                    <td className="px-4 py-3 text-[13px] text-orange-400 font-semibold whitespace-nowrap">{s.remainingAmount.toFixed(2)} ₺</td>
                    <td className="px-4 py-3 text-[12px] text-[#9ca3af] whitespace-nowrap">{METHOD_LABELS[s.paymentMethod] ?? s.paymentMethod}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-semibold border ${st.cls}`}>{st.label}</span>
                    </td>
                    <td className="px-4 py-3 text-[12px] text-[#c9762c] font-semibold whitespace-nowrap">{s.barberShare.toFixed(2)} ₺</td>
                    <td className="px-4 py-3 text-[12px] text-[#9ca3af] font-semibold whitespace-nowrap">{s.businessShare.toFixed(2)} ₺</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {!voided && (
                        <button onClick={() => handleVoid(s.id)} disabled={voidingId === s.id}
                          className="text-[11px] text-[#9ca3af] hover:text-red-400 border border-[#2a2a2a] hover:border-red-500/30 rounded px-2 py-1 transition-all disabled:opacity-40">
                          {voidingId === s.id ? "..." : "İptal"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <SaleModal
          barbers={barbers}
          services={services}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); refresh(); }}
        />
      )}
    </>
  );
}
