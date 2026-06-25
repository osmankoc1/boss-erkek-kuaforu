"use client";
import { useState, useCallback, useTransition } from "react";
import { useRouter } from "next/navigation";
import PaymentModal from "./PaymentModal";

type Debt = {
  id: string; customerName: string; customerPhone: string; serviceName: string;
  barberName: string; saleAmount: number; paidAmount: number; remainingAmount: number;
  saleStatus: string; saleDate: string; daysAgo: number;
  customerId: string | null;
};

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  PARTIAL: { label: "Kısmi", cls: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20" },
  CREDIT: { label: "Veresiye", cls: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
};

export default function VeresiyeClient({ initialDebts }: { initialDebts: Debt[] }) {
  const router = useRouter();
  const [debts, setDebts] = useState(initialDebts);
  const [payModal, setPayModal] = useState<Debt | null>(null);
  const [search, setSearch] = useState("");
  const [, startTransition] = useTransition();

  const refresh = useCallback(() => {
    startTransition(() => router.refresh());
    fetch("/api/debts")
      .then((r) => r.json())
      .then((d) => setDebts(d.debts ?? []));
  }, [router]);

  const filtered = debts.filter(
    (d) =>
      !search ||
      d.customerName.toLowerCase().includes(search.toLowerCase()) ||
      d.customerPhone.includes(search)
  );

  const totalDebt = filtered.reduce((s, d) => s + d.remainingAmount, 0);

  return (
    <>
      <div className="flex items-center gap-4 mb-6">
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-md px-3 py-2 text-[13px] text-white placeholder-[#5a5a5a] focus:outline-none focus:border-[#c9762c]/50 w-64"
          placeholder="Müşteri adı veya telefon..." />
        <div className="ml-auto bg-[#0f0f0f] border border-[#1e1e1e] rounded-xl px-5 py-3 flex items-center gap-6">
          <div>
            <p className="text-[11px] text-[#6b7280] uppercase tracking-wider">Açık Borç</p>
            <p className="text-lg font-black text-orange-400">{totalDebt.toFixed(2)} ₺</p>
          </div>
          <div>
            <p className="text-[11px] text-[#6b7280] uppercase tracking-wider">Kayıt</p>
            <p className="text-lg font-black text-white">{filtered.length}</p>
          </div>
        </div>
      </div>

      <div className="bg-[#0f0f0f] border border-[#1e1e1e] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#1a1a1a]">
                {["Müşteri", "Hizmet", "Çalışan", "Tarih", "Toplam", "Ödenen", "Kalan Borç", "Gün", "Durum", ""].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-[#6b7280] text-sm">Açık veresiye kaydı yok.</td></tr>
              )}
              {filtered.map((d) => {
                const st = STATUS_LABELS[d.saleStatus] ?? STATUS_LABELS.CREDIT;
                return (
                  <tr key={d.id} className="border-b border-[#111] hover:bg-[#111] transition-colors">
                    <td className="px-4 py-3">
                      {d.customerId ? (
                        <a href={`/admin/musteriler/${d.customerId}`} className="group">
                          <p className="text-[13px] text-white font-medium group-hover:text-[#c9762c] transition-colors">{d.customerName}</p>
                          {d.customerPhone && <p className="text-[11px] text-[#6b7280]">{d.customerPhone}</p>}
                        </a>
                      ) : (
                        <>
                          <p className="text-[13px] text-white font-medium">{d.customerName}</p>
                          {d.customerPhone && <p className="text-[11px] text-[#6b7280]">{d.customerPhone}</p>}
                        </>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[12px] text-[#9ca3af]">{d.serviceName}</td>
                    <td className="px-4 py-3 text-[12px] text-[#9ca3af]">{d.barberName}</td>
                    <td className="px-4 py-3 text-[12px] text-[#9ca3af] whitespace-nowrap">
                      {new Date(d.saleDate).toLocaleDateString("tr-TR")}
                    </td>
                    <td className="px-4 py-3 text-[13px] text-white font-semibold whitespace-nowrap">{d.saleAmount.toFixed(2)} ₺</td>
                    <td className="px-4 py-3 text-[13px] text-green-400 font-semibold whitespace-nowrap">{d.paidAmount.toFixed(2)} ₺</td>
                    <td className="px-4 py-3 text-[13px] text-orange-400 font-bold whitespace-nowrap">{d.remainingAmount.toFixed(2)} ₺</td>
                    <td className="px-4 py-3">
                      <span className={`text-[12px] font-semibold ${d.daysAgo > 7 ? "text-red-400" : d.daysAgo > 2 ? "text-yellow-400" : "text-[#9ca3af]"}`}>
                        {d.daysAgo === 0 ? "Bugün" : `${d.daysAgo}g`}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-semibold border ${st.cls}`}>{st.label}</span>
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => setPayModal(d)}
                        className="text-[11px] text-[#c9762c] hover:text-[#e8913a] border border-[#c9762c]/30 hover:border-[#c9762c]/60 rounded px-3 py-1.5 transition-all font-semibold">
                        Ödeme Al
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {payModal && (
        <PaymentModal
          saleId={payModal.id}
          customerId={payModal.customerId ?? ""}
          customerName={payModal.customerName}
          remainingAmount={payModal.remainingAmount}
          onClose={() => setPayModal(null)}
          onSaved={() => { setPayModal(null); refresh(); }}
        />
      )}
    </>
  );
}
