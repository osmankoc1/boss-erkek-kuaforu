import { buildCommissionReport } from "@/lib/commission-report";
import { istanbulDateString } from "@/lib/tz";
import HakedisTable from "./HakedisTable";

export const metadata = { title: "Hakedişler — BOSS Admin" };

type SearchParams = Promise<{ range?: string; from?: string; to?: string }>;

/**
 * Hakediş ekranı (FAZ 2 · Sıra 8).
 *
 * Rakamlar `lib/commission-report.ts` üzerinden gelir — `/api/commissions`
 * ile birebir aynı kaynak. Ekran ile rapor ayrışamaz.
 *
 * Üç kavram ekranda AYRI AYRI gösterilir ve birbirine karıştırılmaz:
 *   Tahakkuk Eden Hakediş → iş yapıldı, hakediş doğdu (tahsilattan bağımsız)
 *   Ödenen Hakediş        → berbere fiilen verilen para
 *   Kalan Hakediş         → tahakkuk − ödenen
 */
export default async function HakedislerPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const now = new Date();

  const report = await buildCommissionReport({
    range: params.range,
    from: params.from,
    to: params.to,
    now,
  });
  const { range, dateFrom, dateTo, commissions, payouts, totals } = report;

  const rangeOptions = [
    { value: "today", label: "Bugün" },
    { value: "yesterday", label: "Dün" },
    { value: "week", label: "Bu Hafta" },
    { value: "month", label: "Bu Ay" },
    { value: "custom", label: "Özel" },
  ];

  const today = istanbulDateString(now);
  const fromValue = params.from ?? today;
  const toValue = params.to ?? today;

  // Ödeme kutusunda dönem varsayılanı: bakılan rapor aralığı.
  const periodStartDefault = istanbulDateString(dateFrom);
  const periodEndDefault = istanbulDateString(dateTo);

  const cards = [
    { label: "Toplam Satış", value: totals.totalSale, color: "text-white", hint: "Dönemde yapılan satış tutarı" },
    { label: "Tahakkuk Eden Hakediş", value: totals.accrued, color: "text-[#c9762c]", hint: "İş yapıldı; tahsilattan bağımsız" },
    { label: "İşletme Payı", value: totals.businessShare, color: "text-[#9ca3af]", hint: "Satışın işletmede kalan kısmı" },
    { label: "Ödenen Hakediş", value: totals.paid, color: "text-emerald-400", hint: "Dönemde çalışanlara verilen para" },
    { label: "Kalan Hakediş", value: totals.totalRemaining, color: totals.totalRemaining < 0 ? "text-red-400" : "text-yellow-400", hint: "Tüm zamanlar: tahakkuk − ödenen" },
    { label: "Veresiyeli Satış", value: totals.creditSale, color: "text-orange-400", hint: "Müşteriden henüz tahsil edilmedi" },
  ];

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
                    : "bg-[#1a1a1a] border-[#2a2a2a] text-[#9ca3af] hover:border-[#3a3a3a]"
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

      {/* Özet kartları — üç kavram ayrı ayrı */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {cards.map((c) => (
          <div key={c.label} className="bg-[#0f0f0f] border border-[#1e1e1e] rounded-xl p-4">
            <p className="text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider">{c.label}</p>
            <p className={`text-xl font-black mt-1 ${c.color}`}>{c.value.toFixed(2)} <span className="text-xs font-normal text-[#9ca3af]">₺</span></p>
            <p className="text-[10px] text-[#4b5563] mt-1">{c.hint}</p>
          </div>
        ))}
      </div>

      <HakedisTable
        rows={commissions}
        payouts={payouts}
        defaultPeriodStart={periodStartDefault}
        defaultPeriodEnd={periodEndDefault}
      />

      <div className="mt-6 bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-4">
        <p className="text-[11px] text-[#6b7280] font-semibold uppercase tracking-wider mb-1">Hakediş Kuralı</p>
        <p className="text-[12px] text-[#6b7280]">
          Hakediş <strong className="text-[#9ca3af]">iş yapıldığında</strong> doğar; müşteriden para tahsil edilmiş
          olması gerekmez. Veresiye satışta da, walk-in satışta da aynı kural geçerlidir. İptal (VOID) edilen satış
          tahakkuktan kendiliğinden düşer. Hakediş ödeme defteri yalnızca yüzdeli (COMMISSION) çalışanlar içindir.
        </p>
      </div>
    </div>
  );
}
