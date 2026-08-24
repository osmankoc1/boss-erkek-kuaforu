"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import PayoutModal from "./PayoutModal";

export type HakedisRow = {
  barberId: string;
  barberName: string;
  workerType: string;
  commissionRate: number;
  eligible: boolean;
  count: number;
  totalSale: number;
  accrued: number;
  paid: number;
  periodRemaining: number;
  totalRemaining: number;
  businessShare: number;
  creditSale: number;
};

export type PayoutRow = {
  id: string;
  barberName: string;
  amount: number;
  paymentMethod: string;
  periodStart: string;
  periodEnd: string;
  note: string | null;
  payoutDate: string;
};

const METHOD_LABELS: Record<string, string> = {
  CASH: "Nakit", CARD: "Kart", TRANSFER: "Havale/EFT", OTHER: "Diğer",
};

const gun = (iso: string) => new Date(iso).toLocaleDateString("tr-TR");

export default function HakedisTable({
  rows, payouts, defaultPeriodStart, defaultPeriodEnd,
}: {
  rows: HakedisRow[];
  payouts: PayoutRow[];
  defaultPeriodStart: string;
  defaultPeriodEnd: string;
}) {
  const router = useRouter();
  const [modal, setModal] = useState<HakedisRow | null>(null);
  const [, startTransition] = useTransition();

  const totals = rows.reduce(
    (a, c) => ({
      totalSale: a.totalSale + c.totalSale,
      accrued: a.accrued + c.accrued,
      paid: a.paid + c.paid,
      totalRemaining: a.totalRemaining + c.totalRemaining,
      businessShare: a.businessShare + c.businessShare,
      creditSale: a.creditSale + c.creditSale,
    }),
    { totalSale: 0, accrued: 0, paid: 0, totalRemaining: 0, businessShare: 0, creditSale: 0 }
  );

  return (
    <>
      {rows.length === 0 ? (
        <div className="bg-[#0f0f0f] border border-[#1e1e1e] rounded-xl p-12 text-center">
          <p className="text-[#6b7280] text-sm">Seçilen dönemde satış veya hakediş ödemesi kaydı yok.</p>
        </div>
      ) : (
        <div className="bg-[#0f0f0f] border border-[#1e1e1e] rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-[#1a1a1a]">
            <h3 className="text-sm font-bold text-white">Çalışan Bazlı Hakediş</h3>
            <p className="text-[11px] text-[#6b7280] mt-0.5">
              Tahakkuk ve ödeme seçilen dönemin rakamlarıdır. <span className="text-[#9ca3af]">Kalan (Toplam)</span> ise
              tüm zamanların birikimidir: çalışana hâlâ borçlu olunan tutar.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#1a1a1a]">
                  {["Çalışan", "Tip", "Oran", "İşlem", "Toplam Satış", "Tahakkuk Eden Hakediş", "Ödenen Hakediş", "Kalan Hakediş (Toplam)", "İşletme Payı", "Veresiyeli", ""].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.barberId} className="border-b border-[#111] hover:bg-[#111] transition-colors">
                    <td className="px-4 py-3 text-[13px] text-white font-medium whitespace-nowrap">{c.barberName}</td>
                    <td className="px-4 py-3">
                      <span className="text-[11px] px-2 py-0.5 rounded bg-[#1a1a1a] border border-[#2a2a2a] text-[#9ca3af]">
                        {c.workerType}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[12px] text-[#9ca3af]">{c.workerType === "COMMISSION" ? `%${c.commissionRate}` : "—"}</td>
                    <td className="px-4 py-3 text-[13px] text-white">{c.count}</td>
                    <td className="px-4 py-3 text-[13px] text-white font-semibold whitespace-nowrap">{c.totalSale.toFixed(2)} ₺</td>
                    <td className="px-4 py-3 text-[13px] text-[#c9762c] font-bold whitespace-nowrap">{c.accrued.toFixed(2)} ₺</td>
                    <td className="px-4 py-3 text-[13px] text-emerald-400 font-semibold whitespace-nowrap">{c.paid.toFixed(2)} ₺</td>
                    <td className={`px-4 py-3 text-[13px] font-bold whitespace-nowrap ${c.totalRemaining < 0 ? "text-red-400" : "text-yellow-400"}`}>
                      {c.totalRemaining.toFixed(2)} ₺
                      {c.totalRemaining < 0 && <span className="ml-1 text-[10px] font-normal">(fazla ödendi)</span>}
                    </td>
                    <td className="px-4 py-3 text-[13px] text-[#9ca3af] font-semibold whitespace-nowrap">{c.businessShare.toFixed(2)} ₺</td>
                    <td className="px-4 py-3 text-[13px] text-orange-400 whitespace-nowrap">{c.creditSale.toFixed(2)} ₺</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {c.eligible ? (
                        <button
                          onClick={() => setModal(c)}
                          disabled={c.totalRemaining <= 0}
                          title={c.totalRemaining <= 0 ? "Kalan hakediş yok" : undefined}
                          className="px-3 py-1.5 bg-[#c9762c] hover:bg-[#e8913a] rounded-md text-[11px] font-bold text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed">
                          Hakediş Öde
                        </button>
                      ) : (
                        <span className="text-[11px] text-[#4b5563]" title="Hakediş ödeme defteri yalnızca yüzdeli (COMMISSION) çalışanlar içindir.">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-[#2a2a2a] bg-[#111]">
                  <td colSpan={4} className="px-4 py-3 text-[12px] font-bold text-[#9ca3af]">Toplam</td>
                  <td className="px-4 py-3 text-[13px] font-bold text-white whitespace-nowrap">{totals.totalSale.toFixed(2)} ₺</td>
                  <td className="px-4 py-3 text-[13px] font-bold text-[#c9762c] whitespace-nowrap">{totals.accrued.toFixed(2)} ₺</td>
                  <td className="px-4 py-3 text-[13px] font-bold text-emerald-400 whitespace-nowrap">{totals.paid.toFixed(2)} ₺</td>
                  <td className="px-4 py-3 text-[13px] font-bold text-yellow-400 whitespace-nowrap">{totals.totalRemaining.toFixed(2)} ₺</td>
                  <td className="px-4 py-3 text-[13px] font-bold text-[#9ca3af] whitespace-nowrap">{totals.businessShare.toFixed(2)} ₺</td>
                  <td className="px-4 py-3 text-[13px] font-bold text-orange-400 whitespace-nowrap">{totals.creditSale.toFixed(2)} ₺</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Ödeme geçmişi */}
      <div className="mt-6 bg-[#0f0f0f] border border-[#1e1e1e] rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[#1a1a1a]">
          <h3 className="text-sm font-bold text-white">Hakediş Ödeme Geçmişi</h3>
          <p className="text-[11px] text-[#6b7280] mt-0.5">Seçilen dönemde yapılan ödemeler (ödeme tarihine göre).</p>
        </div>
        {payouts.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-[#6b7280] text-sm">Bu dönemde hakediş ödemesi yapılmamış.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#1a1a1a]">
                  {["Ödeme Tarihi", "Çalışan", "Ait Olduğu Dönem", "Tutar", "Yöntem", "Not"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {payouts.map((p) => (
                  <tr key={p.id} className="border-b border-[#111] hover:bg-[#111] transition-colors">
                    <td className="px-4 py-3 text-[13px] text-white whitespace-nowrap">{gun(p.payoutDate)}</td>
                    <td className="px-4 py-3 text-[13px] text-white font-medium whitespace-nowrap">{p.barberName}</td>
                    <td className="px-4 py-3 text-[12px] text-[#9ca3af] whitespace-nowrap">{gun(p.periodStart)} — {gun(p.periodEnd)}</td>
                    <td className="px-4 py-3 text-[13px] text-emerald-400 font-bold whitespace-nowrap">{p.amount.toFixed(2)} ₺</td>
                    <td className="px-4 py-3 text-[12px] text-[#9ca3af] whitespace-nowrap">{METHOD_LABELS[p.paymentMethod] ?? p.paymentMethod}</td>
                    <td className="px-4 py-3 text-[12px] text-[#6b7280]">{p.note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal && (
        <PayoutModal
          barberId={modal.barberId}
          barberName={modal.barberName}
          remaining={modal.totalRemaining}
          defaultPeriodStart={defaultPeriodStart}
          defaultPeriodEnd={defaultPeriodEnd}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            startTransition(() => router.refresh());
          }}
        />
      )}
    </>
  );
}
