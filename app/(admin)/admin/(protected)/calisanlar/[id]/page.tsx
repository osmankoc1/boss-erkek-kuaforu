import { db } from "@/lib/db";
import { startOfDay, endOfDay } from "@/lib/sale";
import { notFound } from "next/navigation";
import BarberEditButton from "./BarberEditButton";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const barber = await db.barber.findUnique({ where: { id }, select: { name: true } });
  return { title: barber ? `${barber.name} — BOSS Admin` : "Çalışan Detay" };
}

const WORKER_TYPE_LABELS: Record<string, string> = {
  OWNER: "Patron / Ortak",
  COMMISSION: "Komisyonlu",
  FIXED_SALARY: "Sabit Maaşlı",
};

const WORKER_TYPE_COLORS: Record<string, string> = {
  OWNER: "text-[#c9762c] border-[#c9762c]/30 bg-[#c9762c]/8",
  COMMISSION: "text-purple-400 border-purple-400/30 bg-purple-400/8",
  FIXED_SALARY: "text-sky-400 border-sky-400/30 bg-sky-400/8",
};

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  PAID:    { label: "Ödendi",   cls: "text-green-400 border-green-500/20" },
  PARTIAL: { label: "Kısmi",    cls: "text-yellow-400 border-yellow-500/20" },
  CREDIT:  { label: "Veresiye", cls: "text-orange-400 border-orange-500/20" },
  VOIDED:  { label: "İptal",    cls: "text-[#9ca3af] border-[#2a2a2a]" },
};

type SearchParams = Promise<{ range?: string; from?: string; to?: string }>;

export default async function BarberDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const range = sp.range ?? "month";

  const now = new Date();
  let dateFrom: Date;
  let dateTo: Date = endOfDay(now);

  if (range === "custom" && sp.from && sp.to) {
    dateFrom = startOfDay(new Date(sp.from));
    dateTo = endOfDay(new Date(sp.to));
  } else if (range === "today") {
    dateFrom = startOfDay(now);
  } else if (range === "yesterday") {
    const y = new Date(now); y.setDate(y.getDate() - 1);
    dateFrom = startOfDay(y); dateTo = endOfDay(y);
  } else if (range === "week") {
    dateFrom = new Date(now); dateFrom.setDate(dateFrom.getDate() - 6); dateFrom.setHours(0, 0, 0, 0);
  } else {
    // month
    dateFrom = new Date(now.getFullYear(), now.getMonth(), 1);
  }

  const barber = await db.barber.findUnique({ where: { id } });
  if (!barber) notFound();

  const [periodSales, periodVoidedCount, allTimeSales] = await Promise.all([
    db.sale.findMany({
      where: { barberId: id, saleDate: { gte: dateFrom, lte: dateTo }, saleStatus: { not: "VOIDED" } },
      orderBy: { saleDate: "desc" },
    }),
    db.sale.count({
      where: { barberId: id, saleDate: { gte: dateFrom, lte: dateTo }, saleStatus: "VOIDED" },
    }),
    db.sale.findMany({
      where: { barberId: id, saleStatus: { not: "VOIDED" } },
      select: {
        customerId: true, customerName: true, customerPhone: true,
        saleAmount: true, remainingAmount: true, saleDate: true,
      },
      orderBy: { saleDate: "desc" },
    }),
  ]);

  // ── Performans metrikleri ──
  const count = periodSales.length;
  const totalSale = periodSales.reduce((s, r) => s + r.saleAmount, 0);
  const totalPaid = periodSales.reduce((s, r) => s + r.paidAmount, 0);
  const totalCredit = periodSales.reduce((s, r) => s + r.remainingAmount, 0);
  const totalBarberShare = periodSales.reduce((s, r) => s + r.barberShare, 0);
  const totalBusinessShare = periodSales.reduce((s, r) => s + r.businessShare, 0);
  const avgTicket = count > 0 ? totalSale / count : 0;

  // ── Hizmet performansı ──
  const serviceMap = new Map<string, { count: number; totalSale: number; barberShare: number; businessShare: number }>();
  for (const s of periodSales) {
    if (!serviceMap.has(s.serviceName)) {
      serviceMap.set(s.serviceName, { count: 0, totalSale: 0, barberShare: 0, businessShare: 0 });
    }
    const e = serviceMap.get(s.serviceName)!;
    e.count++;
    e.totalSale += s.saleAmount;
    e.barberShare += s.barberShare;
    e.businessShare += s.businessShare;
  }
  const servicePerf = Array.from(serviceMap.entries())
    .map(([name, d]) => ({ name, ...d, avgPrice: d.count > 0 ? d.totalSale / d.count : 0 }))
    .sort((a, b) => b.count - a.count);

  // ── Müşteri performansı (tüm zaman) ──
  type CustomerEntry = {
    customerName: string; customerPhone: string;
    visitCount: number; totalSpend: number; lastVisit: Date; hasDebt: boolean;
  };
  const customerMap = new Map<string, CustomerEntry>();
  for (const s of allTimeSales) {
    const key = s.customerId ?? s.customerPhone ?? s.customerName;
    if (!customerMap.has(key)) {
      customerMap.set(key, {
        customerName: s.customerName, customerPhone: s.customerPhone,
        visitCount: 0, totalSpend: 0, lastVisit: s.saleDate, hasDebt: false,
      });
    }
    const e = customerMap.get(key)!;
    e.visitCount++;
    e.totalSpend += s.saleAmount;
    if (s.saleDate > e.lastVisit) e.lastVisit = s.saleDate;
    if (s.remainingAmount > 0) e.hasDebt = true;
  }
  const customerPerf = Array.from(customerMap.values())
    .sort((a, b) => b.visitCount - a.visitCount)
    .slice(0, 30);

  // ── Hakediş breakdown ──
  const paidShare = periodSales
    .filter((s) => s.saleStatus === "PAID")
    .reduce((s, r) => s + r.barberShare, 0);
  const creditShare = periodSales
    .filter((s) => s.saleStatus !== "PAID")
    .reduce((s, r) => s + r.barberShare, 0);

  const fmt = (d: Date) => new Date(d).toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const fmtTime = (d: Date) => new Date(d).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });

  const rangeOptions = [
    { value: "today", label: "Bugün" },
    { value: "yesterday", label: "Dün" },
    { value: "week", label: "Bu Hafta" },
    { value: "month", label: "Bu Ay" },
  ];

  const workerColor = WORKER_TYPE_COLORS[barber.workerType] ?? WORKER_TYPE_COLORS.OWNER;

  return (
    <div className="p-6 md:p-8 max-w-[1500px]">
      {/* Breadcrumb */}
      <div className="mb-6">
        <a href="/admin/calisanlar" className="text-[#9ca3af] text-sm hover:text-[#c9762c] transition-colors">
          ← Çalışanlar
        </a>
      </div>

      {/* ── Üst: Profil + Filtreler ── */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        {/* Profil kartı */}
        <div className="flex items-center gap-4">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center text-2xl shrink-0"
            style={{ background: `${barber.calendarColor}20`, border: `2px solid ${barber.calendarColor}40` }}
          >
            {barber.photoUrl
              ? <img src={barber.photoUrl} className="w-14 h-14 rounded-full object-cover" alt={barber.name} />
              : "👨‍💈"
            }
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-black text-white">{barber.name}</h1>
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded border ${workerColor}`}>
                {WORKER_TYPE_LABELS[barber.workerType] ?? barber.workerType}
                {barber.workerType === "COMMISSION" && ` · %${barber.commissionRate}`}
              </span>
              <span className={`text-[11px] px-2 py-0.5 rounded border ${barber.isActive ? "text-green-400 border-green-500/20" : "text-[#9ca3af] border-[#2a2a2a]"}`}>
                {barber.isActive ? "Aktif" : "Pasif"}
              </span>
            </div>
            <div className="flex items-center gap-4 mt-1 text-[13px] text-[#9ca3af]">
              {barber.specialty && <span>{barber.specialty}</span>}
              {barber.experienceYrs > 0 && <span>{barber.experienceYrs} yıl deneyim</span>}
              {barber.bio && <span className="hidden md:inline truncate max-w-xs">{barber.bio}</span>}
            </div>
            <div className="mt-2">
              <BarberEditButton barber={{
                id: barber.id,
                name: barber.name,
                bio: barber.bio,
                specialty: barber.specialty,
                experienceYrs: barber.experienceYrs,
                calendarColor: barber.calendarColor,
              }} />
            </div>
          </div>
        </div>

        {/* Dönem filtreleri */}
        <div className="flex items-center gap-2 flex-wrap">
          {rangeOptions.map((opt) => (
            <a
              key={opt.value}
              href={`?range=${opt.value}`}
              className={`px-3 py-1.5 rounded-md text-[12px] font-medium border transition-all ${
                range === opt.value
                  ? "bg-[#c9762c]/10 border-[#c9762c]/30 text-[#c9762c]"
                  : "bg-[#111] border-[#1e1e1e] text-[#9ca3af] hover:text-[#9ca3af] hover:border-[#2a2a2a]"
              }`}
            >
              {opt.label}
            </a>
          ))}
          {/* Özel tarih aralığı */}
          <form method="GET" className="flex items-center gap-1">
            <input type="hidden" name="range" value="custom" />
            <input
              name="from" type="date" defaultValue={sp.from ?? ""}
              className="bg-[#111] border border-[#1e1e1e] text-[#9ca3af] text-[11px] rounded-md px-2 py-1.5 outline-none focus:border-[#c9762c] w-30"
            />
            <span className="text-[#9ca3af] text-xs">–</span>
            <input
              name="to" type="date" defaultValue={sp.to ?? ""}
              className="bg-[#111] border border-[#1e1e1e] text-[#9ca3af] text-[11px] rounded-md px-2 py-1.5 outline-none focus:border-[#c9762c] w-30"
            />
            <button
              type="submit"
              className="px-2.5 py-1.5 bg-[#1e1e1e] border border-[#2a2a2a] hover:border-[#c9762c]/30 text-[#9ca3af] text-[11px] rounded-md transition-colors"
            >
              Git
            </button>
          </form>
        </div>
      </div>

      {/* ── B) Performans Özeti ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: "İşlem Sayısı", value: count, unit: "", color: "text-white" },
          { label: "Toplam Satış", value: totalSale.toFixed(2), unit: "₺", color: "text-white" },
          { label: "Tahsilat", value: totalPaid.toFixed(2), unit: "₺", color: "text-green-400" },
          { label: "Veresiye Kalan", value: totalCredit.toFixed(2), unit: "₺", color: totalCredit > 0 ? "text-orange-400" : "text-[#9ca3af]" },
          { label: "Çalışan Hakedişi", value: totalBarberShare.toFixed(2), unit: "₺", color: "text-purple-400" },
          { label: "İşletme Payı", value: totalBusinessShare.toFixed(2), unit: "₺", color: "text-[#9ca3af]" },
          { label: "Ort. Tutar", value: avgTicket.toFixed(2), unit: "₺", color: "text-[#c9762c]" },
          { label: "İptal Edilen", value: periodVoidedCount, unit: "", color: periodVoidedCount > 0 ? "text-red-400" : "text-[#9ca3af]" },
        ].map((c) => (
          <div key={c.label} className="bg-[#0f0f0f] border border-[#1e1e1e] rounded-xl p-4">
            <p className="text-[10px] font-semibold text-[#6b7280] uppercase tracking-wider mb-1">{c.label}</p>
            <p className={`text-xl font-black ${c.color}`}>
              {c.value}{c.unit && <span className="text-xs font-normal text-[#9ca3af] ml-1">{c.unit}</span>}
            </p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* ── C) Hizmet Performansı ── */}
        <div className="bg-[#0f0f0f] border border-[#1e1e1e] rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[#1a1a1a]">
            <h3 className="text-sm font-bold text-white">Hizmet Performansı</h3>
            <p className="text-[11px] text-[#6b7280] mt-0.5">Seçilen dönem</p>
          </div>
          {servicePerf.length === 0 ? (
            <p className="px-5 py-8 text-center text-[13px] text-[#6b7280]">Bu dönemde kayıt yok.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[#1a1a1a]">
                    {["Hizmet", "Sayı", "Toplam", "Ort.", "Hakediş", "İşletme"].map((h) => (
                      <th key={h} className="px-4 py-2.5 text-left text-[10px] font-semibold text-[#6b7280] uppercase tracking-wider whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {servicePerf.map((s) => (
                    <tr key={s.name} className="border-b border-[#111] hover:bg-[#111] transition-colors">
                      <td className="px-4 py-2.5 text-[13px] text-white font-medium">{s.name}</td>
                      <td className="px-4 py-2.5 text-[12px] text-[#9ca3af]">{s.count}</td>
                      <td className="px-4 py-2.5 text-[12px] text-white font-semibold whitespace-nowrap">{s.totalSale.toFixed(2)} ₺</td>
                      <td className="px-4 py-2.5 text-[12px] text-[#9ca3af] whitespace-nowrap">{s.avgPrice.toFixed(2)} ₺</td>
                      <td className="px-4 py-2.5 text-[12px] text-purple-400 font-semibold whitespace-nowrap">{s.barberShare.toFixed(2)} ₺</td>
                      <td className="px-4 py-2.5 text-[12px] text-[#9ca3af] whitespace-nowrap">{s.businessShare.toFixed(2)} ₺</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── F) Hakediş Özeti (COMMISSION için) veya genel özet ── */}
        <div className="bg-[#0f0f0f] border border-[#1e1e1e] rounded-xl p-5">
          <h3 className="text-sm font-bold text-white mb-1">Hakediş Özeti</h3>
          <p className="text-[11px] text-[#6b7280] mb-5">Seçilen dönem · {fmt(dateFrom)} – {fmt(dateTo)}</p>

          {barber.workerType === "COMMISSION" ? (
            <div className="space-y-3">
              <HakRow label="Toplam Hakediş" value={totalBarberShare} color="text-purple-400" big />
              <div className="border-t border-[#1a1a1a] my-2" />
              <HakRow label="Tahsil edilmiş satışlardan" value={paidShare} color="text-green-400" />
              <HakRow label="Veresiyeli satışlardan" value={creditShare} color="text-orange-400"
                sub="henüz tahsil edilmedi" />
              <div className="border-t border-[#1a1a1a] my-2" />
              <HakRow label="İşletme Payı" value={totalBusinessShare} color="text-[#9ca3af]" />
              <div className="mt-4 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-4 py-3">
                <p className="text-[11px] text-[#6b7280]">
                  Hakediş ödeme takibi (Payout) gelecek fazda eklenecektir.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <HakRow label="Toplam Satış" value={totalSale} color="text-white" big />
              <HakRow label="İşletme Payı" value={totalBusinessShare} color="text-[#c9762c]" />
              <div className="border-t border-[#1a1a1a] my-2" />
              <p className="text-[12px] text-[#6b7280]">
                {WORKER_TYPE_LABELS[barber.workerType]} çalışanlar için komisyon hakedişi uygulanmaz.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── D) Müşteri Performansı ── */}
      {customerPerf.length > 0 && (
        <div className="bg-[#0f0f0f] border border-[#1e1e1e] rounded-xl overflow-hidden mb-6">
          <div className="px-5 py-4 border-b border-[#1a1a1a]">
            <h3 className="text-sm font-bold text-white">Müşteri Performansı</h3>
            <p className="text-[11px] text-[#6b7280] mt-0.5">Tüm zamanlar — bu çalışana gelen müşteriler</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#1a1a1a]">
                  {["Müşteri", "Telefon", "Ziyaret", "Toplam Harcama", "Son Geliş", "Borç"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-[10px] font-semibold text-[#6b7280] uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {customerPerf.map((c, i) => (
                  <tr key={i} className="border-b border-[#111] hover:bg-[#111] transition-colors">
                    <td className="px-4 py-3 text-[13px] text-white font-medium">{c.customerName}</td>
                    <td className="px-4 py-3 text-[12px] text-[#9ca3af]">{c.customerPhone || "—"}</td>
                    <td className="px-4 py-3 text-[12px] text-[#9ca3af]">{c.visitCount}×</td>
                    <td className="px-4 py-3 text-[13px] text-[#c9762c] font-semibold whitespace-nowrap">
                      {c.totalSpend.toFixed(2)} ₺
                    </td>
                    <td className="px-4 py-3 text-[12px] text-[#9ca3af] whitespace-nowrap">{fmt(c.lastVisit)}</td>
                    <td className="px-4 py-3">
                      {c.hasDebt
                        ? <span className="text-[11px] text-orange-400 border border-orange-400/20 px-1.5 py-0.5 rounded">Borçlu</span>
                        : <span className="text-[11px] text-[#6b7280]">—</span>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── E) Randevu / Satış Geçmişi ── */}
      <div className="bg-[#0f0f0f] border border-[#1e1e1e] rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#1a1a1a] flex items-center justify-between">
          <h3 className="text-sm font-bold text-white">Satış Geçmişi</h3>
          <span className="text-[11px] text-[#6b7280]">{periodSales.length} kayıt (seçilen dönem)</span>
        </div>
        {periodSales.length === 0 ? (
          <p className="px-5 py-8 text-center text-[13px] text-[#6b7280]">Bu dönemde satış kaydı yok.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#1a1a1a]">
                  {["Tarih", "Saat", "Müşteri", "Hizmet", "Satış", "Ödenen", "Kalan", "Durum", "Hakediş", "İşletme"].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-left text-[10px] font-semibold text-[#6b7280] uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {periodSales.map((s) => {
                  const badge = STATUS_BADGE[s.saleStatus] ?? STATUS_BADGE.PAID;
                  return (
                    <tr key={s.id} className="border-b border-[#111] hover:bg-[#111] transition-colors">
                      <td className="px-4 py-3 text-[12px] text-[#9ca3af] whitespace-nowrap">{fmt(s.saleDate)}</td>
                      <td className="px-4 py-3 text-[12px] text-[#9ca3af]">{fmtTime(s.saleDate)}</td>
                      <td className="px-4 py-3">
                        <p className="text-[13px] text-white font-medium">{s.customerName}</p>
                        {s.customerPhone && <p className="text-[11px] text-[#6b7280]">{s.customerPhone}</p>}
                      </td>
                      <td className="px-4 py-3 text-[12px] text-[#9ca3af] whitespace-nowrap">{s.serviceName}</td>
                      <td className="px-4 py-3 text-[13px] text-white font-semibold whitespace-nowrap">{s.saleAmount.toFixed(2)} ₺</td>
                      <td className="px-4 py-3 text-[12px] text-green-400 whitespace-nowrap">{s.paidAmount.toFixed(2)} ₺</td>
                      <td className="px-4 py-3 text-[12px] text-orange-400 whitespace-nowrap">{s.remainingAmount.toFixed(2)} ₺</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`text-[11px] px-2 py-0.5 rounded border ${badge.cls}`}>{badge.label}</span>
                      </td>
                      <td className="px-4 py-3 text-[12px] text-purple-400 font-semibold whitespace-nowrap">{s.barberShare.toFixed(2)} ₺</td>
                      <td className="px-4 py-3 text-[12px] text-[#9ca3af] whitespace-nowrap">{s.businessShare.toFixed(2)} ₺</td>
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

function HakRow({ label, value, color, sub, big }: {
  label: string; value: number; color: string; sub?: string; big?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className={`${big ? "text-[13px]" : "text-[12px]"} text-[#9ca3af]`}>{label}</p>
        {sub && <p className="text-[10px] text-[#6b7280]">{sub}</p>}
      </div>
      <p className={`font-black ${big ? "text-xl" : "text-[14px]"} ${color}`}>
        {value.toFixed(2)} <span className="text-[11px] font-normal text-[#9ca3af]">₺</span>
      </p>
    </div>
  );
}
