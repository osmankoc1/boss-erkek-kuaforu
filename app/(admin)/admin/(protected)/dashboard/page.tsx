import { db } from "@/lib/db";
import { formatDate, formatPrice } from "@/lib/utils";
import { AppointmentAreaChart, HoursBarChart, DaysBarChart } from "./DashboardCharts";

export const metadata = { title: "Dashboard — BOSS Admin" };

function timeToMinutes(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function calcOccupancy(
  barbers: { workingHours: { dayOfWeek: number; startTime: string; endTime: string; isOff: boolean }[] }[],
  rangeStart: Date,
  rangeEnd: Date,
  bookedCount: number
): number {
  let totalSlots = 0;
  const days = Math.ceil((rangeEnd.getTime() - rangeStart.getTime()) / 86400000);
  for (let i = 0; i < days; i++) {
    const day = new Date(rangeStart.getTime() + i * 86400000);
    const dow = day.getDay();
    for (const barber of barbers) {
      const wh = barber.workingHours.find((w) => w.dayOfWeek === dow);
      if (!wh || wh.isOff) continue;
      totalSlots += Math.floor((timeToMinutes(wh.endTime) - timeToMinutes(wh.startTime)) / 30);
    }
  }
  return totalSlots > 0 ? Math.min(100, Math.round((bookedCount / totalSlots) * 100)) : 0;
}

async function getStats(range: string, customFrom?: string, customTo?: string) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart.getTime() + 86400000);
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const weekEnd = new Date(weekStart.getTime() + 7 * 86400000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);

  let rangeStart: Date, rangeEnd: Date;
  if (range === "today") { rangeStart = todayStart; rangeEnd = todayEnd; }
  else if (range === "week") { rangeStart = weekStart; rangeEnd = weekEnd; }
  else if (range === "custom" && customFrom && customTo) {
    rangeStart = new Date(customFrom);
    rangeEnd = new Date(new Date(customTo).getTime() + 86400000);
  } else { rangeStart = monthStart; rangeEnd = monthEnd; }

  const [rangeAppts, todayAppts, allCompleted, barbers, last30Days, pendingAppts] = await Promise.all([
    db.appointment.findMany({
      where: { date: { gte: rangeStart, lt: rangeEnd } },
      include: { service: true, barber: true },
    }),
    db.appointment.findMany({ where: { date: { gte: todayStart, lt: todayEnd } } }),
    db.appointment.findMany({ where: { status: "completed" }, select: { appointmentPrice: true } }),
    db.barber.findMany({ where: { isActive: true }, include: { workingHours: true } }),
    db.appointment.groupBy({
      by: ["date"],
      where: { date: { gte: thirtyDaysAgo } },
      _count: { id: true },
      orderBy: { date: "asc" },
    }),
    db.appointment.findMany({
      where: { status: "pending" },
      include: { customer: true, service: true, barber: true },
      orderBy: { date: "asc" },
      take: 5,
    }),
  ]);

  // Revenue
  const rangeCompleted = rangeAppts.filter((a) => a.status === "completed");
  const rangeRevenue = rangeCompleted.reduce((s, a) => s + a.appointmentPrice, 0);
  const totalRevenue = allCompleted.reduce((s, a) => s + a.appointmentPrice, 0);
  const avgTicket = rangeCompleted.length > 0 ? rangeRevenue / rangeCompleted.length : 0;

  const [todayRev, weekRev, monthRev] = await Promise.all([
    db.appointment.findMany({ where: { date: { gte: todayStart, lt: todayEnd }, status: "completed" }, select: { appointmentPrice: true } }),
    db.appointment.findMany({ where: { date: { gte: weekStart, lt: weekEnd }, status: "completed" }, select: { appointmentPrice: true } }),
    db.appointment.findMany({ where: { date: { gte: monthStart, lt: monthEnd }, status: "completed" }, select: { appointmentPrice: true } }),
  ]);
  const todayRevenue = todayRev.reduce((s, a) => s + a.appointmentPrice, 0);
  const weekRevenue = weekRev.reduce((s, a) => s + a.appointmentPrice, 0);
  const monthRevenue = monthRev.reduce((s, a) => s + a.appointmentPrice, 0);

  // Barber performance
  const barberMap = new Map(barbers.map((b) => [b.id, b]));
  const barberStatsMap: Record<string, { id: string; name: string; total: number; completed: number; cancelled: number; revenue: number }> = {};
  for (const a of rangeAppts) {
    if (!barberStatsMap[a.barberId]) {
      barberStatsMap[a.barberId] = { id: a.barberId, name: barberMap.get(a.barberId)?.name ?? "?", total: 0, completed: 0, cancelled: 0, revenue: 0 };
    }
    barberStatsMap[a.barberId].total++;
    if (a.status === "completed") { barberStatsMap[a.barberId].completed++; barberStatsMap[a.barberId].revenue += a.appointmentPrice; }
    if (a.status === "cancelled") barberStatsMap[a.barberId].cancelled++;
  }
  const barberPerformance = Object.values(barberStatsMap)
    .map((b) => ({ ...b, avgTicket: b.completed > 0 ? b.revenue / b.completed : 0 }))
    .sort((a, b) => b.revenue - a.revenue);

  // Service performance
  const serviceStatsMap: Record<string, { id: string; name: string; count: number; revenue: number }> = {};
  for (const a of rangeAppts) {
    const svcId = a.serviceId ?? "unknown";
    const svcName = a.service?.name ?? "Bilinmiyor";
    if (!serviceStatsMap[svcId]) serviceStatsMap[svcId] = { id: svcId, name: svcName, count: 0, revenue: 0 };
    serviceStatsMap[svcId].count++;
    if (a.status === "completed") serviceStatsMap[svcId].revenue += a.appointmentPrice;
  }
  const servicePerformance = Object.values(serviceStatsMap)
    .map((s) => ({ ...s, avgPrice: s.count > 0 ? s.revenue / s.count : 0 }))
    .sort((a, b) => b.count - a.count);

  // Busiest hours
  const hourCounts: Record<string, number> = {};
  for (const a of rangeAppts) {
    const hour = a.startTime.split(":")[0];
    hourCounts[hour] = (hourCounts[hour] ?? 0) + 1;
  }
  const busiestHours = Object.entries(hourCounts)
    .map(([h, count]) => ({ hour: `${h}:00`, count }))
    .sort((a, b) => a.hour.localeCompare(b.hour));

  // Busiest days
  const dayCounts: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  for (const a of rangeAppts) dayCounts[new Date(a.date).getDay()]++;
  const dayNames = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
  const busiestDays = Object.entries(dayCounts).map(([d, count]) => ({ day: dayNames[Number(d)], count: count as number }));

  // Occupancy
  const [weekBooked, monthBooked] = await Promise.all([
    db.appointment.count({ where: { date: { gte: weekStart, lt: weekEnd }, status: { not: "cancelled" } } }),
    db.appointment.count({ where: { date: { gte: monthStart, lt: monthEnd }, status: { not: "cancelled" } } }),
  ]);
  const todayBooked = todayAppts.filter((a) => a.status !== "cancelled").length;
  const occupancy = {
    today: calcOccupancy(barbers, todayStart, todayEnd, todayBooked),
    week: calcOccupancy(barbers, weekStart, weekEnd, weekBooked),
    month: calcOccupancy(barbers, monthStart, monthEnd, monthBooked),
  };

  // Customers
  const [totalCustomers, newCustomers, returningCustomers, todaySalesAgg, monthSalesAgg, pendingKasaCount] = await Promise.all([
    db.customer.count(),
    db.customer.count({ where: { createdAt: { gte: monthStart } } }),
    db.customer.count({ where: { completedCount: { gt: 1 } } }),
    db.sale.aggregate({
      where: { saleDate: { gte: todayStart, lt: todayEnd }, saleStatus: { not: "VOIDED" } },
      _sum: { saleAmount: true, paidAmount: true, remainingAmount: true },
      _count: { id: true },
    }),
    db.sale.aggregate({
      where: { saleDate: { gte: monthStart, lt: monthEnd }, saleStatus: { not: "VOIDED" } },
      _sum: { saleAmount: true, paidAmount: true, remainingAmount: true },
    }),
    db.appointment.count({ where: { status: "completed", sales: { none: {} } } }),
  ]);

  return {
    rangeStart,
    rangeEnd,
    revenue: { range: rangeRevenue, today: todayRevenue, week: weekRevenue, month: monthRevenue, total: totalRevenue, avg: avgTicket },
    today: {
      total: todayAppts.length,
      pending: todayAppts.filter((a) => a.status === "pending").length,
      confirmed: todayAppts.filter((a) => a.status === "confirmed").length,
      completed: todayAppts.filter((a) => a.status === "completed").length,
      cancelled: todayAppts.filter((a) => a.status === "cancelled").length,
    },
    occupancy,
    barberPerformance,
    servicePerformance,
    busiestHours,
    busiestDays,
    customers: { total: totalCustomers, newThisMonth: newCustomers, returning: returningCustomers, rate: totalCustomers > 0 ? Math.round((returningCustomers / totalCustomers) * 100) : 0 },
    kasa: {
      todaySales: todaySalesAgg._sum.saleAmount ?? 0,
      todayCollection: todaySalesAgg._sum.paidAmount ?? 0,
      todayCredit: todaySalesAgg._sum.remainingAmount ?? 0,
      todayCount: todaySalesAgg._count.id,
      monthSales: monthSalesAgg._sum.saleAmount ?? 0,
      monthCollection: monthSalesAgg._sum.paidAmount ?? 0,
      pendingKasa: pendingKasaCount,
    },
    last30Days: last30Days.map((d) => ({
      date: new Date(d.date).toLocaleDateString("tr-TR", { month: "short", day: "numeric" }),
      count: d._count.id,
    })),
    pendingAppts,
  };
}

const RANGE_LABELS: Record<string, string> = { today: "Bugün", week: "Bu Hafta", month: "Bu Ay", custom: "Özel" };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const range = sp.range ?? "month";
  const stats = await getStats(range, sp.from, sp.to);

  const filterLinks = [
    { label: "Bugün", value: "today" },
    { label: "Bu Hafta", value: "week" },
    { label: "Bu Ay", value: "month" },
  ];

  return (
    <div className="p-6 md:p-8 max-w-[1500px]">
      {/* Başlık + filtreler */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-black text-white">Dashboard</h1>
          <p className="text-[#9ca3af] text-sm mt-1">
            {new Date().toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          </p>
        </div>
        {/* Filtre bar */}
        <div className="flex items-center gap-2 flex-wrap">
          {filterLinks.map((f) => (
            <a
              key={f.value}
              href={`/admin/dashboard?range=${f.value}`}
              className={`px-4 py-1.5 rounded-md text-xs font-semibold border transition-all ${
                range === f.value
                  ? "bg-[#c9762c] border-[#c9762c] text-white"
                  : "border-[#1e1e1e] text-[#9ca3af] hover:border-[#2a2a2a] hover:text-[#9ca3af] bg-[#111]"
              }`}
            >
              {f.label}
            </a>
          ))}
          {/* Özel tarih aralığı */}
          <form method="GET" action="/admin/dashboard" className="flex items-center gap-1">
            <input type="hidden" name="range" value="custom" />
            <input
              name="from"
              type="date"
              defaultValue={sp.from ?? ""}
              className="bg-[#111] border border-[#1e1e1e] text-[#9ca3af] text-xs rounded-md px-2 py-1.5 outline-none focus:border-[#c9762c] w-32"
            />
            <span className="text-[#9ca3af] text-xs">–</span>
            <input
              name="to"
              type="date"
              defaultValue={sp.to ?? ""}
              className="bg-[#111] border border-[#1e1e1e] text-[#9ca3af] text-xs rounded-md px-2 py-1.5 outline-none focus:border-[#c9762c] w-32"
            />
            <button
              type="submit"
              className="px-3 py-1.5 bg-[#1e1e1e] border border-[#2a2a2a] hover:border-[#c9762c]/40 text-[#9ca3af] text-xs rounded-md transition-colors"
            >
              Uygula
            </button>
          </form>
        </div>
      </div>

      {/* Dönem etiketi */}
      <div className="mb-5 flex items-center gap-2">
        <span className="text-xs text-[#9ca3af] uppercase tracking-wider">Görüntülenen dönem:</span>
        <span className="text-xs font-semibold text-[#c9762c] bg-[#c9762c]/10 border border-[#c9762c]/15 px-2 py-0.5 rounded">
          {RANGE_LABELS[range] ?? "Özel"}{range === "custom" && sp.from && sp.to ? ` · ${sp.from} – ${sp.to}` : ""}
        </span>
      </div>

      {/* ─── BÖLÜM 1: Gelir ─── */}
      <SectionTitle>Gelir Özeti</SectionTitle>
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
        <RevenueCard label="Dönem Geliri" value={stats.revenue.range} highlight />
        <RevenueCard label="Bugün" value={stats.revenue.today} />
        <RevenueCard label="Bu Hafta" value={stats.revenue.week} />
        <RevenueCard label="Bu Ay" value={stats.revenue.month} />
        <RevenueCard label="Toplam Ciro" value={stats.revenue.total} />
        <RevenueCard label="Ort. Randevu" value={stats.revenue.avg} sub="tutarı" />
      </div>

      {/* ─── BÖLÜM 1b: Kasa Özeti ─── */}
      <SectionTitle>Kasa Özeti (Bugün)</SectionTitle>
      {stats.kasa.pendingKasa > 0 && (
        <div className="mb-4 flex items-center gap-3 bg-yellow-500/5 border border-yellow-500/20 rounded-xl px-5 py-3">
          <svg className="w-4 h-4 text-yellow-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          <p className="text-[13px] text-yellow-300">
            <span className="font-bold">{stats.kasa.pendingKasa}</span> tamamlanan randevunun kasa kaydı eksik.{" "}
            <a href="/admin/kasa" className="underline hover:text-yellow-200">Kasaya git →</a>
          </p>
        </div>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <RevenueCard label="Bugün Satış" value={stats.kasa.todaySales} sub={`${stats.kasa.todayCount} işlem`} />
        <RevenueCard label="Bugün Tahsilat" value={stats.kasa.todayCollection} highlight />
        <RevenueCard label="Bugün Veresiye" value={stats.kasa.todayCredit} />
        <RevenueCard label="Bu Ay Satış" value={stats.kasa.monthSales} />
      </div>

      {/* ─── BÖLÜM 2: Bugün durumu ─── */}
      <SectionTitle>Bugünün Durumu</SectionTitle>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard label="Bekleyen" value={stats.today.pending} accent="yellow"
          icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />} />
        <StatCard label="Onaylı" value={stats.today.confirmed} accent="green"
          icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />} />
        <StatCard label="Tamamlanan" value={stats.today.completed} accent="copper"
          icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 13l4 4L19 7" />} />
        <StatCard label="İptal" value={stats.today.cancelled} accent="red"
          icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />} />
      </div>

      {/* ─── BÖLÜM 3: Doluluk oranları ─── */}
      <SectionTitle>Doluluk Oranları</SectionTitle>
      <div className="grid grid-cols-3 gap-3 mb-6">
        <OccupancyCard label="Günlük" pct={stats.occupancy.today} />
        <OccupancyCard label="Haftalık" pct={stats.occupancy.week} />
        <OccupancyCard label="Aylık" pct={stats.occupancy.month} />
      </div>

      {/* ─── BÖLÜM 4: Grafikler ─── */}
      <SectionTitle>Trafik Analizi</SectionTitle>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <div className="bg-[#111] border border-[#1e1e1e] rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-white">Son 30 Gün</h3>
            <span className="text-xs text-[#9ca3af]">Randevu sayısı</span>
          </div>
          <AppointmentAreaChart data={stats.last30Days} />
        </div>
        <div className="bg-[#111] border border-[#1e1e1e] rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-white">En Yoğun Saatler</h3>
            <span className="text-xs text-[#9ca3af]">Randevu sayısı</span>
          </div>
          {stats.busiestHours.length > 0 ? (
            <HoursBarChart data={stats.busiestHours} />
          ) : (
            <EmptyChart />
          )}
        </div>
      </div>

      {/* En yoğun günler */}
      <div className="bg-[#111] border border-[#1e1e1e] rounded-xl p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-white">Haftanın En Yoğun Günleri</h3>
          <span className="text-xs text-[#9ca3af]">Dönem içinde</span>
        </div>
        {stats.busiestDays.some((d) => d.count > 0) ? (
          <DaysBarChart data={stats.busiestDays} />
        ) : (
          <EmptyChart />
        )}
      </div>

      {/* ─── BÖLÜM 5: Berber performansı ─── */}
      {stats.barberPerformance.length > 0 && (
        <>
          <SectionTitle>Berber Performansı</SectionTitle>
          <div className="bg-[#111] border border-[#1e1e1e] rounded-xl overflow-hidden mb-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1a1a1a]">
                  {["Çalışan", "Toplam", "Tamamlanan", "İptal", "Ciro", "Ort. Tutar"].map((h) => (
                    <th key={h} className="text-left px-5 py-3 text-[#9ca3af] text-xs font-semibold uppercase tracking-wider">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#141414]">
                {stats.barberPerformance.map((b) => {
                  const initials = b.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
                  return (
                    <tr key={b.id} className="hover:bg-[#161616] transition-colors">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="w-7 h-7 rounded-full bg-[#c9762c]/10 border border-[#c9762c]/15 flex items-center justify-center shrink-0">
                            <span className="text-[#c9762c] text-[10px] font-black">{initials}</span>
                          </div>
                          <span className="font-semibold text-white">{b.name}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-[#9ca3af]">{b.total}</td>
                      <td className="px-5 py-3.5 text-emerald-400">{b.completed}</td>
                      <td className="px-5 py-3.5 text-red-400">{b.cancelled}</td>
                      <td className="px-5 py-3.5 font-bold text-[#c9762c]">{formatPrice(b.revenue)}</td>
                      <td className="px-5 py-3.5 text-[#9ca3af]">{formatPrice(b.avgTicket)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ─── BÖLÜM 6: Hizmet performansı ─── */}
      {stats.servicePerformance.length > 0 && (
        <>
          <SectionTitle>Hizmet Performansı</SectionTitle>
          <div className="bg-[#111] border border-[#1e1e1e] rounded-xl overflow-hidden mb-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1a1a1a]">
                  {["Hizmet", "Seçilme", "Ciro", "Ort. Fiyat"].map((h) => (
                    <th key={h} className="text-left px-5 py-3 text-[#9ca3af] text-xs font-semibold uppercase tracking-wider">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#141414]">
                {stats.servicePerformance.map((s, idx) => (
                  <tr key={s.id} className="hover:bg-[#161616] transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <span className="text-[#9ca3af] text-xs font-mono w-5 shrink-0">{String(idx + 1).padStart(2, "0")}</span>
                        <span className="font-semibold text-white">{s.name}</span>
                        {idx === 0 && (
                          <span className="text-[9px] px-1.5 py-0.5 bg-[#c9762c]/10 border border-[#c9762c]/15 text-[#c9762c] rounded font-bold uppercase tracking-wider">
                            En Çok
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-[#9ca3af]">{s.count}×</td>
                    <td className="px-5 py-3.5 font-bold text-[#c9762c]">{formatPrice(s.revenue)}</td>
                    <td className="px-5 py-3.5 text-[#9ca3af]">{formatPrice(s.avgPrice)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ─── BÖLÜM 7: Müşteri özeti ─── */}
      <SectionTitle>Müşteri Özeti</SectionTitle>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <InfoCard title="Toplam Müşteri" value={stats.customers.total} sub="kayıtlı" />
        <InfoCard title="Bu Ay Yeni" value={stats.customers.newThisMonth} sub="kayıt" />
        <InfoCard title="Tekrar Gelen" value={stats.customers.returning} sub="müşteri" accent />
        <InfoCard title="Sadakat Oranı" value={`${stats.customers.rate}%`} sub="geri dönüş" accent />
      </div>

      {/* ─── BÖLÜM 8: Bekleyen randevular ─── */}
      {stats.pendingAppts.length > 0 && (
        <>
          <SectionTitle>Onay Bekleyen Randevular</SectionTitle>
          <div className="bg-[#111] border border-[#1e1e1e] rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-[#1e1e1e] flex items-center justify-between">
              <h2 className="font-bold text-white text-sm">Bekleyen</h2>
              <span className="text-xs text-[#c9762c] bg-[#c9762c]/10 border border-[#c9762c]/15 px-2 py-0.5 rounded">
                {stats.pendingAppts.length} randevu
              </span>
            </div>
            <div className="divide-y divide-[#1a1a1a]">
              {stats.pendingAppts.map((a) => (
                <div key={a.id} className="flex items-center justify-between px-6 py-3.5 hover:bg-[#161616] transition-colors">
                  <div className="flex items-center gap-4">
                    <div className="w-8 h-8 rounded-full bg-[#c9762c]/10 border border-[#c9762c]/15 flex items-center justify-center shrink-0">
                      <span className="text-[#c9762c] text-xs font-black">
                        {a.customer.fullName.split(" ").map((w: string) => w[0]).slice(0, 2).join("").toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <div className="font-semibold text-white text-sm">{a.customer.fullName}</div>
                      <div className="text-[#9ca3af] text-xs">{a.service?.name ?? "—"} · {a.barber.name}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[#c9762c] font-bold text-sm">{a.startTime}</div>
                    <div className="text-[#9ca3af] text-xs">{formatDate(a.date)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <h2 className="text-xs font-bold text-[#9ca3af] uppercase tracking-[0.2em]">{children}</h2>
      <div className="flex-1 h-px bg-[#1a1a1a]" />
    </div>
  );
}

function RevenueCard({ label, value, sub, highlight }: { label: string; value: number; sub?: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl p-4 border transition-colors ${highlight ? "bg-[#c9762c]/8 border-[#c9762c]/20" : "bg-[#111] border-[#1e1e1e] hover:border-[#2a2a2a]"}`}>
      <p className="text-[#9ca3af] text-[10px] uppercase tracking-wider mb-2">{label}{sub && ` ${sub}`}</p>
      <p className={`text-xl font-black leading-none ${highlight ? "text-[#c9762c]" : "text-white"}`}>
        {formatPrice(value)}
      </p>
    </div>
  );
}

function StatCard({
  label, value, accent = "default", icon,
}: {
  label: string; value: number | string; accent?: "yellow" | "green" | "blue" | "red" | "copper" | "default"; icon?: React.ReactNode;
}) {
  const valueColors = { yellow: "text-yellow-400", green: "text-emerald-400", blue: "text-sky-400", red: "text-red-400", copper: "text-[#c9762c]", default: "text-white" };
  const iconColors = { yellow: "text-yellow-400/60", green: "text-emerald-400/60", blue: "text-sky-400/60", red: "text-red-400/60", copper: "text-[#c9762c]/60", default: "text-[#9ca3af]" };
  return (
    <div className="bg-[#111] border border-[#1e1e1e] rounded-xl p-4 hover:border-[#2a2a2a] transition-colors">
      <div className="flex items-start justify-between mb-3">
        <p className="text-[#9ca3af] text-[10px] uppercase tracking-wider">{label}</p>
        {icon && (
          <svg className={`w-4 h-4 shrink-0 ${iconColors[accent]}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">{icon}</svg>
        )}
      </div>
      <p className={`text-3xl font-black ${valueColors[accent]}`}>{value}</p>
    </div>
  );
}

function OccupancyCard({ label, pct }: { label: string; pct: number }) {
  const color = pct >= 70 ? "#c9762c" : pct >= 40 ? "#6b7280" : "#2a2a2a";
  return (
    <div className="bg-[#111] border border-[#1e1e1e] rounded-xl p-5 flex items-center gap-5">
      {/* Ring */}
      <div className="relative w-14 h-14 shrink-0">
        <svg viewBox="0 0 56 56" className="w-14 h-14 -rotate-90">
          <circle cx="28" cy="28" r="22" fill="none" stroke="#1e1e1e" strokeWidth="5" />
          <circle
            cx="28" cy="28" r="22" fill="none"
            stroke={color} strokeWidth="5"
            strokeDasharray={`${2 * Math.PI * 22}`}
            strokeDashoffset={`${2 * Math.PI * 22 * (1 - pct / 100)}`}
            strokeLinecap="round"
            style={{ transition: "stroke-dashoffset 0.5s ease" }}
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-xs font-black text-white">{pct}%</span>
      </div>
      <div>
        <p className="text-white font-bold text-base">{pct}%</p>
        <p className="text-[#9ca3af] text-xs mt-0.5">{label} Doluluk</p>
      </div>
    </div>
  );
}

function InfoCard({ title, value, sub, accent }: { title: string; value: number | string; sub: string; accent?: boolean }) {
  return (
    <div className="bg-[#111] border border-[#1e1e1e] rounded-xl p-4">
      <h3 className="text-[10px] text-[#9ca3af] uppercase tracking-wider mb-2">{title}</h3>
      <div className={`font-black text-2xl leading-none ${accent ? "text-[#c9762c]" : "text-white"}`}>{value}</div>
      <p className="text-[#9ca3af] text-xs mt-1">{sub}</p>
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="h-[180px] flex items-center justify-center">
      <p className="text-[#9ca3af] text-sm">Bu dönemde veri yok</p>
    </div>
  );
}
