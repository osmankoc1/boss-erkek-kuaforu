import { db } from "@/lib/db";
import { STATUS_LABELS, TAG_LABELS } from "@/lib/utils";
import CustomerTagEditor from "./CustomerTagEditor";
import MergeCustomerButton from "./MergeCustomerButton";
import { notFound } from "next/navigation";

const METHOD_LABELS: Record<string, string> = {
  CASH: "Nakit", CARD: "Kart", TRANSFER: "Havale", OTHER: "Diğer",
};

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  PAID:    { label: "Ödendi",   cls: "text-green-400 border-green-500/20" },
  PARTIAL: { label: "Kısmi",    cls: "text-yellow-400 border-yellow-500/20" },
  CREDIT:  { label: "Veresiye", cls: "text-orange-400 border-orange-500/20" },
  VOIDED:  { label: "İptal",    cls: "text-[#9ca3af] border-[#2a2a2a]" },
};

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const customer = await db.customer.findUnique({ where: { id } });
  if (!customer) notFound();

  const [allSales, appointments] = await Promise.all([
    db.sale.findMany({
      where: { customerId: id },
      orderBy: { saleDate: "asc" },
    }),
    db.appointment.findMany({
      where: { customerId: id },
      include: { service: true, barber: true },
      orderBy: { date: "desc" },
      take: 50,
    }),
  ]);

  const saleIds = allSales.map((s) => s.id);
  const allPayments = saleIds.length > 0
    ? await db.customerPayment.findMany({
        where: { saleId: { in: saleIds } },
        orderBy: { paymentDate: "asc" },
      })
    : [];

  const activeSales = allSales.filter((s) => s.saleStatus !== "VOIDED");

  // ── CRM İstatistikleri ──
  const totalSaleAmount = activeSales.reduce((s, r) => s + r.saleAmount, 0);
  const totalPaidAmount = activeSales.reduce((s, r) => s + r.paidAmount, 0);
  const totalDebt = activeSales.reduce((s, r) => s + r.remainingAmount, 0);
  const avgSpend = activeSales.length > 0 ? totalSaleAmount / activeSales.length : 0;
  const firstVisitAt = allSales.length > 0 ? allSales[0].saleDate : customer.createdAt;

  const serviceCount: Record<string, number> = {};
  const barberCount: Record<string, number> = {};
  for (const s of activeSales) {
    serviceCount[s.serviceName] = (serviceCount[s.serviceName] ?? 0) + 1;
    barberCount[s.barberName] = (barberCount[s.barberName] ?? 0) + 1;
  }
  const topService = Object.entries(serviceCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";
  const topBarber = Object.entries(barberCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";

  // ── Müşteri Ekstresi (kronik borç/alacak/bakiye) ──
  type EkstreRow = {
    date: Date;
    type: "Satış" | "Tahsilat";
    description: string;
    borç: number;
    alacak: number;
    bakiye: number;
  };

  const paymentsBySaleId = new Map<string, number>();
  for (const p of allPayments) {
    if (p.saleId) paymentsBySaleId.set(p.saleId, (paymentsBySaleId.get(p.saleId) ?? 0) + p.amount);
  }

  const rawEntries: Omit<EkstreRow, "bakiye">[] = [];

  for (const sale of activeSales) {
    rawEntries.push({
      date: sale.saleDate,
      type: "Satış",
      description: sale.serviceName,
      borç: sale.saleAmount,
      alacak: 0,
    });
    // Satışa gömülü anlık ödeme
    const subsequent = paymentsBySaleId.get(sale.id) ?? 0;
    const initial = Math.round((sale.paidAmount - subsequent) * 100) / 100;
    if (initial > 0) {
      rawEntries.push({
        date: sale.saleDate,
        type: "Tahsilat",
        description: `${METHOD_LABELS[sale.paymentMethod] ?? sale.paymentMethod} · ${sale.serviceName}`,
        borç: 0,
        alacak: initial,
      });
    }
  }

  for (const p of allPayments) {
    rawEntries.push({
      date: p.paymentDate,
      type: "Tahsilat",
      description: `${METHOD_LABELS[p.paymentMethod] ?? p.paymentMethod} Borç Tahsilatı`,
      borç: 0,
      alacak: p.amount,
    });
  }

  rawEntries.sort((a, b) => {
    const diff = new Date(a.date).getTime() - new Date(b.date).getTime();
    if (diff !== 0) return diff;
    if (a.type === "Satış" && b.type !== "Satış") return -1;
    if (a.type !== "Satış" && b.type === "Satış") return 1;
    return 0;
  });

  let runningBalance = 0;
  const ekstreRows: EkstreRow[] = rawEntries.map((e) => {
    runningBalance = Math.round((runningBalance + e.borç - e.alacak) * 100) / 100;
    return { ...e, bakiye: runningBalance };
  });

  const fmt = (d: Date) => new Date(d).toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric" });

  return (
    <div className="p-6 md:p-8">
      <div className="mb-6">
        <a href="/admin/musteriler" className="text-[#6b7280] text-sm hover:text-[#c9762c]">← Müşteriler</a>
      </div>

      {/* ── Profil + İstatistik ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* Profil kartı */}
        <div className="lg:col-span-1 bg-[#141414] border border-[#2a2a2a] rounded-xl p-6 space-y-4">
          <div className="w-14 h-14 bg-[#c9762c]/10 rounded-full flex items-center justify-center">
            <span className="text-2xl">👤</span>
          </div>
          <div>
            <h1 className="text-xl font-black">{customer.fullName}</h1>
            <p className="text-[#6b7280] text-sm">{customer.phone}</p>
            {customer.email && <p className="text-[#6b7280] text-sm">{customer.email}</p>}
          </div>
          <div className="pt-3 border-t border-[#2a2a2a] space-y-3">
            <CustomerTagEditor id={customer.id} currentTag={customer.tag} notes={customer.notes ?? ""} />
            <MergeCustomerButton currentId={customer.id} currentName={customer.fullName} />
          </div>
        </div>

        {/* CRM İstatistikleri */}
        <div className="lg:col-span-2 grid grid-cols-2 sm:grid-cols-3 gap-3">
          <StatBox label="Toplam Satış" value={`${totalSaleAmount.toFixed(2)} ₺`} accent />
          <StatBox label="Toplam Tahsilat" value={`${totalPaidAmount.toFixed(2)} ₺`} color="text-green-400" />
          <StatBox label="Açık Borç" value={`${totalDebt.toFixed(2)} ₺`} color={totalDebt > 0 ? "text-orange-400" : "text-[#9ca3af]"} />
          <StatBox label="Ort. Sepet" value={`${avgSpend.toFixed(2)} ₺`} />
          <StatBox label="Ziyaret Sayısı" value={activeSales.length} />
          <StatBox label="İlk Geliş" value={fmt(firstVisitAt)} small />
          <StatBox label="Son Geliş" value={customer.lastVisitAt ? fmt(customer.lastVisitAt) : "—"} small />
          <StatBox label="Favori Hizmet" value={topService} small />
          <StatBox label="Favori Çalışan" value={topBarber} small />
        </div>
      </div>

      {/* ── Müşteri Ekstresi ── */}
      <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl overflow-hidden mb-6">
        <div className="px-6 py-4 border-b border-[#2a2a2a] flex items-center justify-between">
          <h2 className="font-bold text-sm text-[#9ca3af] uppercase tracking-wider">Müşteri Ekstresi</h2>
          {totalDebt > 0 && (
            <span className="text-xs font-bold text-orange-400 bg-orange-400/10 border border-orange-400/20 px-2 py-0.5 rounded">
              Bakiye: {totalDebt.toFixed(2)} ₺
            </span>
          )}
        </div>
        {ekstreRows.length === 0 ? (
          <div className="px-6 py-8 text-center text-[13px] text-[#6b7280]">Henüz hareket kaydı yok.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#2a2a2a]">
                  {["Tarih", "İşlem Türü", "Açıklama", "Borç", "Alacak", "Bakiye"].map((h) => (
                    <th key={h} className={`px-4 py-3 text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider ${h === "Borç" || h === "Alacak" || h === "Bakiye" ? "text-right" : "text-left"}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1e1e1e]">
                {ekstreRows.map((row, i) => (
                  <tr key={i} className="hover:bg-[#1a1a1a] transition-colors">
                    <td className="px-4 py-3 text-[12px] text-[#6b7280] whitespace-nowrap">{fmt(row.date)}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded border ${
                        row.type === "Satış"
                          ? "text-[#c9762c] border-[#c9762c]/20 bg-[#c9762c]/5"
                          : "text-green-400 border-green-500/20 bg-green-500/5"
                      }`}>
                        {row.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[13px] text-[#9ca3af]">{row.description}</td>
                    <td className="px-4 py-3 text-right text-[13px] font-semibold text-red-400">
                      {row.borç > 0 ? `${row.borç.toFixed(2)} ₺` : "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-[13px] font-semibold text-green-400">
                      {row.alacak > 0 ? `${row.alacak.toFixed(2)} ₺` : "—"}
                    </td>
                    <td className={`px-4 py-3 text-right text-[13px] font-black ${row.bakiye > 0 ? "text-orange-400" : row.bakiye < 0 ? "text-green-400" : "text-[#9ca3af]"}`}>
                      {row.bakiye.toFixed(2)} ₺
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Ziyaret Geçmişi (satış bazlı) ── */}
      <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl overflow-hidden">
        <div className="p-4 border-b border-[#2a2a2a]">
          <h2 className="font-bold text-sm text-[#9ca3af] uppercase tracking-wider">Ziyaret Geçmişi</h2>
        </div>
        {allSales.length === 0 ? (
          <div className="px-6 py-8 text-center text-[13px] text-[#6b7280]">Henüz kasa kaydı yok.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#2a2a2a]">
                  {["Tarih", "Hizmet", "Çalışan", "Satış Tutarı", "Ödeme Durumu"].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-[#6b7280] text-xs font-semibold uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2a2a2a]">
                {[...allSales].reverse().map((s) => {
                  const badge = STATUS_BADGE[s.saleStatus] ?? { label: s.saleStatus, cls: "text-[#9ca3af] border-[#2a2a2a]" };
                  return (
                    <tr key={s.id} className="hover:bg-[#1e1e1e]">
                      <td className="px-4 py-3 text-[#9ca3af] text-[12px] whitespace-nowrap">{fmt(s.saleDate)}</td>
                      <td className="px-4 py-3 text-white text-[13px]">{s.serviceName}</td>
                      <td className="px-4 py-3 text-[#9ca3af] text-[13px]">{s.barberName}</td>
                      <td className="px-4 py-3 text-[#c9762c] font-bold text-[13px]">{s.saleAmount.toFixed(2)} ₺</td>
                      <td className="px-4 py-3">
                        <span className={`text-[11px] px-2 py-0.5 rounded border ${badge.cls}`}>{badge.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function StatBox({ label, value, small, accent, color }: {
  label: string;
  value: number | string;
  small?: boolean;
  accent?: boolean;
  color?: string;
}) {
  return (
    <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-4">
      <p className="text-[10px] text-[#6b7280] uppercase tracking-wider mb-1">{label}</p>
      <p className={`font-black leading-tight ${small ? "text-sm" : "text-xl"} ${color ?? (accent ? "text-[#c9762c]" : "text-white")}`}>
        {value}
      </p>
    </div>
  );
}
