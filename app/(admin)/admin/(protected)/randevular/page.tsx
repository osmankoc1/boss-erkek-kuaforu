import { db } from "@/lib/db";
import { formatDate, STATUS_LABELS } from "@/lib/utils";
import AppointmentActions from "./AppointmentActions";
import CalendarView from "./CalendarView";
import NewAppointmentButton from "./NewAppointmentButton";
import type { CalAppt, CalBarber } from "./CalendarView";

export const metadata = { title: "Randevular — BOSS Admin" };

type SearchParams = Promise<{ status?: string; date?: string; view?: string }>;

function getWeekRange(dateStr: string) {
  const base = new Date(dateStr);
  const dow = base.getDay();
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(base);
  monday.setDate(base.getDate() + mondayOffset);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { start: monday, end: sunday };
}

export default async function RandevularPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const view = params.view ?? "list";
  const today = new Date().toISOString().split("T")[0];
  const selectedDate = params.date ?? today;
  const status = params.status ?? "";
  const dateFilter = params.date ?? "";

  // ─── E-posta doğrulama bekleyen sayısı ──────────────────────────────────
  const pendingVerificationCount = await db.appointment.count({
    where: { status: "pending_verification" },
  });

  // ─── Modal için veri ─────────────────────────────────────────────────────
  const [modalBarbers, modalServices] = await Promise.all([
    db.barber.findMany({ where: { isActive: true }, select: { id: true, name: true, calendarColor: true }, orderBy: { name: "asc" } }),
    db.service.findMany({ where: { isActive: true }, select: { id: true, name: true, price: true, durationMinutes: true, displayOrder: true, category: true }, orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }] }),
  ]);

  // ─── Takvim görünümleri için veri ──────────────────────────────────────────
  let calAppts: CalAppt[] = [];
  let calBarbers: CalBarber[] = [];

  if (view === "daily" || view === "weekly") {
    const barbers = await db.barber.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
    });
    calBarbers = barbers.map((b) => ({
      id: b.id,
      name: b.name,
      calendarColor: b.calendarColor,
    }));

    let rangeStart: Date;
    let rangeEnd: Date;

    if (view === "daily") {
      rangeStart = new Date(selectedDate);
      rangeEnd = new Date(selectedDate);
      rangeEnd.setHours(23, 59, 59, 999);
    } else {
      const { start, end } = getWeekRange(selectedDate);
      rangeStart = start;
      rangeEnd = end;
    }

    const raw = await db.appointment.findMany({
      where: { date: { gte: rangeStart, lte: rangeEnd } },
      include: {
        customer: { select: { fullName: true, phone: true } },
        service: { select: { name: true, durationMinutes: true } },
        barber: { select: { id: true, name: true, calendarColor: true } },
        services: { select: { serviceName: true, durationMinutes: true } },
      },
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
    });

    calAppts = raw.map((a) => ({
      id: a.id,
      barberId: a.barberId,
      date: a.date.toISOString(),
      startTime: a.startTime,
      endTime: a.endTime,
      status: a.status,
      appointmentPrice: a.appointmentPrice,
      customer: a.customer,
      service: a.service,
      services: a.services,
      barber: a.barber,
    }));
  }

  // ─── Liste görünümü için veri ─────────────────────────────────────────────
  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (dateFilter && view === "list") {
    const d = new Date(dateFilter);
    where.date = {
      gte: new Date(d.getFullYear(), d.getMonth(), d.getDate()),
      lt: new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1),
    };
  }

  const listAppts = view === "list"
    ? await db.appointment.findMany({
        where,
        include: { customer: true, service: true, barber: true, services: true },
        orderBy: [{ date: "asc" }, { startTime: "asc" }],
        take: 200,
      })
    : [];

  // ─── Tarih navigasyonu ────────────────────────────────────────────────────
  const prevDate = (() => {
    const d = new Date(selectedDate);
    if (view === "weekly") d.setDate(d.getDate() - 7);
    else d.setDate(d.getDate() - 1);
    return d.toISOString().split("T")[0];
  })();

  const nextDate = (() => {
    const d = new Date(selectedDate);
    if (view === "weekly") d.setDate(d.getDate() + 7);
    else d.setDate(d.getDate() + 1);
    return d.toISOString().split("T")[0];
  })();

  const displayDate = view === "weekly"
    ? (() => {
        const { start, end } = getWeekRange(selectedDate);
        return `${start.toLocaleDateString("tr-TR", { day: "numeric", month: "short" })} – ${end.toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric" })}`;
      })()
    : new Date(selectedDate).toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  const statusConfig: Record<string, { label: string; cls: string }> = {
    pending_verification: { label: "E-posta Bekleniyor", cls: "bg-gray-500/8 text-gray-400 border-gray-500/15" },
    pending:   { label: "Bekleyen",    cls: "bg-yellow-500/8 text-yellow-400 border-yellow-500/15" },
    confirmed: { label: "Onaylı",      cls: "bg-emerald-500/8 text-emerald-400 border-emerald-500/15" },
    cancelled: { label: "İptal",       cls: "bg-red-500/8 text-red-400 border-red-500/15" },
    completed: { label: "Tamamlandı",  cls: "bg-[#c9762c]/8 text-[#c9762c] border-[#c9762c]/15" },
  };

  const listFilters = [
    { label: "Tümü",           value: "" },
    { label: "E-posta Bekleniyor", value: "pending_verification" },
    { label: "Bekleyen",       value: "pending" },
    { label: "Onaylı",         value: "confirmed" },
    { label: "Tamamlanan",     value: "completed" },
    { label: "İptal",          value: "cancelled" },
  ];

  return (
    <div className="p-6 md:p-8 max-w-[1500px]">
      {/* ─── Başlık ─── */}
      <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-black text-white">Randevular</h1>
          <p className="text-[#9ca3af] text-sm mt-1">
            {view === "list" ? `${listAppts.length} randevu listeleniyor` : displayDate}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <NewAppointmentButton
            barbers={modalBarbers}
            services={modalServices}
            defaultDate={selectedDate}
          />

          {/* Görünüm toggle */}
          <div className="flex items-center gap-1 bg-[#111] border border-[#1e1e1e] rounded-lg p-1">
          {[
            { v: "list",    label: "Liste",   icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 10h16M4 14h16M4 18h16" /> },
            { v: "daily",   label: "Günlük",  icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /> },
            { v: "weekly",  label: "Haftalık", icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /> },
          ].map(({ v, label, icon }) => (
            <a
              key={v}
              href={`/admin/randevular?view=${v}&date=${selectedDate}`}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                view === v ? "bg-[#c9762c] text-white" : "text-[#9ca3af] hover:text-[#9ca3af]"
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">{icon}</svg>
              <span className="hidden sm:inline">{label}</span>
            </a>
          ))}
          </div>
        </div>
      </div>

      {/* ─── Takvim görünümleri — tarih navigasyonu ─── */}
      {(view === "daily" || view === "weekly") && (
        <div className="flex items-center gap-3 mb-5">
          <a
            href={`/admin/randevular?view=${view}&date=${prevDate}`}
            className="w-8 h-8 rounded-lg bg-[#111] border border-[#1e1e1e] hover:border-[#2a2a2a] flex items-center justify-center text-[#9ca3af] hover:text-white transition-all"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </a>

          <div className="flex-1 text-center">
            <p className="text-white text-sm font-semibold">{displayDate}</p>
          </div>

          <a
            href={`/admin/randevular?view=${view}&date=${nextDate}`}
            className="w-8 h-8 rounded-lg bg-[#111] border border-[#1e1e1e] hover:border-[#2a2a2a] flex items-center justify-center text-[#9ca3af] hover:text-white transition-all"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </a>

          {selectedDate !== today && (
            <a
              href={`/admin/randevular?view=${view}&date=${today}`}
              className="px-3 py-1.5 text-xs font-semibold border border-[#c9762c]/25 text-[#c9762c] hover:bg-[#c9762c]/8 rounded-lg transition-colors"
            >
              Bugün
            </a>
          )}
        </div>
      )}

      {/* ─── Takvim Görünümü ─── */}
      {(view === "daily" || view === "weekly") && (
        <CalendarView
          appointments={calAppts}
          barbers={calBarbers}
          date={selectedDate}
          view={view}
        />
      )}

      {/* ─── Liste Görünümü ─── */}
      {view === "list" && (
        <>
          {/* E-posta Bekleyenler kartı */}
          <div className="mb-5">
            <a
              href="/admin/randevular?status=pending_verification"
              className={`inline-flex items-center gap-2.5 px-4 py-2.5 rounded-xl border transition-all text-sm font-semibold ${
                pendingVerificationCount > 0
                  ? "bg-blue-500/8 border-blue-500/20 text-blue-400 hover:bg-blue-500/12"
                  : "bg-[#111] border-[#1e1e1e] text-[#5a5a5a] hover:border-[#2a2a2a]"
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              E-posta Bekleyenler:
              <span className={`font-black ${pendingVerificationCount > 0 ? "text-blue-300" : "text-[#5a5a5a]"}`}>
                {pendingVerificationCount}
              </span>
              {pendingVerificationCount > 0 && (
                <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
              )}
            </a>
          </div>

          {/* Filtreler */}
          <div className="flex flex-wrap gap-2 mb-6">
            {listFilters.map((f) => (
              <a
                key={f.value}
                href={f.value ? `/admin/randevular?status=${f.value}` : "/admin/randevular"}
                className={`px-4 py-1.5 rounded-md text-xs font-semibold border transition-all ${
                  status === f.value
                    ? "bg-[#c9762c] border-[#c9762c] text-white"
                    : "border-[#1e1e1e] text-[#9ca3af] hover:border-[#2a2a2a] hover:text-[#9ca3af] bg-[#111]"
                }`}
              >
                {f.label}
              </a>
            ))}
          </div>

          {/* Tablo */}
          {listAppts.length === 0 ? (
            <div className="text-center py-24 bg-[#111] border border-[#1e1e1e] rounded-xl">
              <div className="w-12 h-12 rounded-full bg-[#1e1e1e] flex items-center justify-center mx-auto mb-4">
                <svg className="w-5 h-5 text-[#9ca3af]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <p className="text-[#9ca3af] font-medium text-sm">Randevu bulunamadı</p>
            </div>
          ) : (
            <div className="bg-[#111] border border-[#1e1e1e] rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#1a1a1a]">
                    {["Müşteri", "Hizmet", "Çalışan", "Tarih & Saat", "Durum", "İşlem"].map((h) => (
                      <th key={h} className="text-left px-5 py-3.5 text-[#9ca3af] text-xs font-semibold uppercase tracking-wider">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#141414]">
                  {listAppts.map((a) => {
                    const initials = a.customer.fullName.split(" ").map((w: string) => w[0]).slice(0, 2).join("").toUpperCase();
                    const sc = statusConfig[a.status];
                    return (
                      <tr key={a.id} className="hover:bg-[#161616] transition-colors">
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-7 h-7 rounded-full bg-[#c9762c]/10 border border-[#c9762c]/15 flex items-center justify-center shrink-0">
                              <span className="text-[#c9762c] text-[10px] font-black">{initials}</span>
                            </div>
                            <div>
                              <div className="font-semibold text-white text-sm">{a.customer.fullName}</div>
                              <div className="text-[#9ca3af] text-xs">{a.customer.phone}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4 text-[#9ca3af] text-sm">
                          {a.services && a.services.length > 0 ? a.services.map((s) => s.serviceName).join(", ") : a.service?.name ?? "—"}
                        </td>
                        <td className="px-5 py-4 text-[#9ca3af] text-sm">{a.barber.name}</td>
                        <td className="px-5 py-4">
                          <div className="text-[#c9762c] font-bold text-sm">{a.startTime}</div>
                          <div className="text-[#9ca3af] text-xs">{formatDate(a.date)}</div>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={`px-2.5 py-1 rounded border text-xs font-semibold ${sc?.cls ?? "text-[#9ca3af] border-[#1e1e1e]"}`}>
                              {sc?.label ?? STATUS_LABELS[a.status] ?? a.status}
                            </span>
                            {(a.riskScore ?? 0) >= 70 && (
                              <span className="px-1.5 py-0.5 rounded border text-[10px] font-semibold bg-red-500/10 text-red-400 border-red-500/20" title={`Risk skoru: ${a.riskScore}`}>
                                Şüpheli
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <AppointmentActions id={a.id} status={a.status} appt={{
                            barberId: a.barberId,
                            barberName: a.barber.name,
                            customerId: a.customerId,
                            customerName: a.customer.fullName,
                            customerPhone: a.customer.phone,
                            serviceId: a.serviceId ?? undefined,
                            serviceName: a.service?.name,
                            appointmentPrice: a.appointmentPrice,
                            services: a.services?.map((s) => ({
                              serviceId: s.serviceId,
                              serviceName: s.serviceName,
                              category: s.category,
                              price: s.price,
                              durationMinutes: s.durationMinutes,
                            })) ?? [],
                          }} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
