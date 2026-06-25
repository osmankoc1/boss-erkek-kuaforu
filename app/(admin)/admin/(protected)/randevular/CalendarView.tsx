"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatPrice, STATUS_LABELS } from "@/lib/utils";

// px per minute (her 30 dk = 56px)
const PX_PER_MIN = 56 / 30;
const GRID_START = 9 * 60;   // 09:00
const GRID_END = 20 * 60;    // 20:00
const TOTAL_MIN = GRID_END - GRID_START; // 660 dk

function timeToMin(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function gridTop(startTime: string) {
  return Math.max(0, (timeToMin(startTime) - GRID_START) * PX_PER_MIN);
}

function gridHeight(durationMinutes: number, startTime: string) {
  const startMin = timeToMin(startTime);
  const capped = Math.min(durationMinutes, GRID_END - startMin);
  return Math.max(capped * PX_PER_MIN, 28);
}

export type CalAppt = {
  id: string;
  barberId: string;
  date: string;
  startTime: string;
  endTime: string;
  status: string;
  appointmentPrice: number;
  customer: { fullName: string; phone: string };
  service: { name: string; durationMinutes: number } | null;
  services?: { serviceName: string; durationMinutes: number }[];
  barber: { id: string; name: string; calendarColor: string };
};

export type CalBarber = {
  id: string;
  name: string;
  calendarColor: string;
};

type Props = {
  appointments: CalAppt[];
  barbers: CalBarber[];
  date: string;
  view: "daily" | "weekly";
};

// Durum renkleri
const SC: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  pending:   { bg: "bg-yellow-500/15",  text: "text-yellow-200",  border: "border-yellow-500/30",  dot: "bg-yellow-400" },
  confirmed: { bg: "bg-emerald-500/15", text: "text-emerald-200", border: "border-emerald-500/30", dot: "bg-emerald-400" },
  cancelled: { bg: "bg-red-500/8",      text: "text-red-300/70",  border: "border-red-500/15",     dot: "bg-red-400" },
  completed: { bg: "bg-[#c9762c]/15",   text: "text-[#e8913a]",  border: "border-[#c9762c]/30",   dot: "bg-[#c9762c]" },
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Bekliyor", confirmed: "Onaylı", cancelled: "İptal", completed: "Tamamlandı",
};

export default function CalendarView({ appointments, barbers, date, view }: Props) {
  const [selected, setSelected] = useState<CalAppt | null>(null);

  return (
    <div>
      {view === "daily"
        ? <DayView appointments={appointments} barbers={barbers} date={date} onSelect={setSelected} />
        : <WeekView appointments={appointments} date={date} onSelect={setSelected} />
      }
      {selected && (
        <ApptModal appt={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

// ─── Günlük Görünüm ──────────────────────────────────────────────────────────

function DayView({ appointments, barbers, date, onSelect }: {
  appointments: CalAppt[];
  barbers: CalBarber[];
  date: string;
  onSelect: (a: CalAppt) => void;
}) {
  const dayAppts = appointments.filter(
    (a) => new Date(a.date).toISOString().split("T")[0] === date
  );

  const timeSlots: string[] = [];
  for (let m = GRID_START; m < GRID_END; m += 30) {
    const h = String(Math.floor(m / 60)).padStart(2, "0");
    const min = String(m % 60).padStart(2, "0");
    timeSlots.push(`${h}:${min}`);
  }

  const totalH = TOTAL_MIN * PX_PER_MIN;

  // En az 1 berber göster
  const displayBarbers = barbers.length > 0 ? barbers : [{ id: "all", name: "Tüm Çalışanlar", calendarColor: "#c9762c" }];

  return (
    <div className="bg-[#111] border border-[#1e1e1e] rounded-xl overflow-hidden">
      {/* Berber başlıkları */}
      <div className="flex border-b border-[#1e1e1e] sticky top-0 z-10 bg-[#111]">
        <div className="w-14 shrink-0" />
        {displayBarbers.map((b) => {
          const bAppts = dayAppts.filter((a) => a.barberId === b.id);
          return (
            <div key={b.id} className="flex-1 px-3 py-3 border-l border-[#1a1a1a]">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full shrink-0" style={{ background: b.calendarColor }} />
                <div>
                  <p className="text-white text-xs font-bold">{b.name}</p>
                  <p className="text-[#9ca3af] text-[10px]">{bAppts.length} randevu</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Zaman grid */}
      <div className="overflow-y-auto max-h-[640px]">
        <div className="flex">
          {/* Saat etiketi */}
          <div className="w-14 shrink-0 relative" style={{ height: totalH }}>
            {timeSlots.map((slot, i) => (
              <div
                key={slot}
                className="absolute right-2 text-[#6b7280] text-[10px] leading-none"
                style={{ top: i * 56 - 6 }}
              >
                {slot}
              </div>
            ))}
          </div>

          {/* Berber sütunları */}
          {displayBarbers.map((barber) => {
            const bAppts = dayAppts.filter((a) => a.barberId === barber.id);
            return (
              <div
                key={barber.id}
                className="flex-1 relative border-l border-[#1a1a1a]"
                style={{ height: totalH }}
              >
                {/* Yatay çizgiler */}
                {timeSlots.map((_, i) => (
                  <div
                    key={i}
                    className={`absolute left-0 right-0 border-t ${i % 2 === 0 ? "border-[#1a1a1a]" : "border-[#141414]"}`}
                    style={{ top: i * 56 }}
                  />
                ))}

                {/* Randevu blokları */}
                {bAppts.map((a) => {
                  const top = gridTop(a.startTime);
                  const dur = a.services && a.services.length > 0 ? a.services.reduce((s, i) => s + i.durationMinutes, 0) : (a.service?.durationMinutes ?? 30);
                  const height = gridHeight(dur, a.startTime);
                  const sc = SC[a.status] ?? SC.pending;
                  const initials = a.customer.fullName.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();

                  return (
                    <button
                      key={a.id}
                      onClick={() => onSelect(a)}
                      className={`absolute left-1 right-1 rounded-lg border px-2 py-1.5 text-left overflow-hidden transition-all hover:brightness-110 hover:shadow-lg ${sc.bg} ${sc.border}`}
                      style={{ top, height, zIndex: 2 }}
                    >
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${sc.dot}`} />
                        <span className={`text-[11px] font-bold truncate ${sc.text}`}>{a.startTime}</span>
                      </div>
                      {height >= 44 && (
                        <p className="text-white text-[11px] font-semibold truncate leading-tight">{a.customer.fullName}</p>
                      )}
                      {height >= 60 && (
                        <p className={`text-[10px] truncate leading-tight ${sc.text} opacity-80`}>
                          {a.services && a.services.length > 0 ? a.services.map(s => s.serviceName).join(", ") : a.service?.name ?? "—"}
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Boş durum */}
      {dayAppts.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <p className="text-[#6b7280] text-sm">Bu tarihte randevu yok</p>
        </div>
      )}
    </div>
  );
}

// ─── Haftalık Görünüm ─────────────────────────────────────────────────────────

function WeekView({ appointments, date, onSelect }: {
  appointments: CalAppt[];
  date: string;
  onSelect: (a: CalAppt) => void;
}) {
  // Haftanın Pazartesi'sini bul
  const base = new Date(date);
  const dow = base.getDay(); // 0=Pazar
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(base);
  monday.setDate(base.getDate() + mondayOffset);

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });

  const dayNames = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
  const today = new Date().toISOString().split("T")[0];

  return (
    <div className="bg-[#111] border border-[#1e1e1e] rounded-xl overflow-hidden">
      {/* Gün başlıkları */}
      <div className="grid grid-cols-7 border-b border-[#1e1e1e]">
        {days.map((d, i) => {
          const iso = d.toISOString().split("T")[0];
          const isToday = iso === today;
          const dayAppts = appointments.filter(
            (a) => new Date(a.date).toISOString().split("T")[0] === iso
          );
          return (
            <div key={iso} className={`px-2 py-3 text-center border-r border-[#1a1a1a] last:border-r-0 ${isToday ? "bg-[#c9762c]/5" : ""}`}>
              <p className="text-[#9ca3af] text-[10px] uppercase tracking-wider">{dayNames[i]}</p>
              <p className={`text-lg font-black mt-0.5 leading-none ${isToday ? "text-[#c9762c]" : "text-white"}`}>
                {d.getDate()}
              </p>
              {dayAppts.length > 0 && (
                <p className="text-[#c9762c] text-[9px] font-bold mt-1">{dayAppts.length}</p>
              )}
            </div>
          );
        })}
      </div>

      {/* Randevu kartları */}
      <div className="grid grid-cols-7 min-h-[300px]">
        {days.map((d) => {
          const iso = d.toISOString().split("T")[0];
          const isToday = iso === today;
          const dayAppts = appointments
            .filter((a) => new Date(a.date).toISOString().split("T")[0] === iso)
            .sort((a, b) => a.startTime.localeCompare(b.startTime));

          return (
            <div
              key={iso}
              className={`border-r border-[#1a1a1a] last:border-r-0 p-1.5 space-y-1 ${isToday ? "bg-[#c9762c]/3" : ""}`}
            >
              {dayAppts.map((a) => {
                const sc = SC[a.status] ?? SC.pending;
                const initials = a.customer.fullName.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
                return (
                  <button
                    key={a.id}
                    onClick={() => onSelect(a)}
                    className={`w-full text-left p-2 rounded-lg border transition-all hover:brightness-110 ${sc.bg} ${sc.border}`}
                  >
                    <div className="flex items-center gap-1 mb-1">
                      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${sc.dot}`} />
                      <span className={`text-[10px] font-bold ${sc.text}`}>{a.startTime}</span>
                    </div>
                    <p className="text-white text-[10px] font-semibold leading-tight truncate">{a.customer.fullName}</p>
                    <p className={`text-[9px] truncate ${sc.text} opacity-75`}>
                      {a.services && a.services.length > 0 ? a.services.map(s => s.serviceName).join(", ") : a.service?.name ?? "—"}
                    </p>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Randevu Modal ────────────────────────────────────────────────────────────

function ApptModal({ appt, onClose }: { appt: CalAppt; onClose: () => void }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const sc = SC[appt.status] ?? SC.pending;
  const initials = appt.customer.fullName.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const barberInitials = appt.barber.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  async function updateStatus(status: string) {
    setLoading(true);
    await fetch(`/api/appointments/${appt.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    router.refresh();
    setLoading(false);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      {/* Kart */}
      <div
        className="relative bg-[#141414] border border-[#2a2a2a] rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Üst çizgi */}
        <div className={`absolute top-0 left-0 right-0 h-0.5 ${sc.dot.replace("bg-", "bg-")}`} />

        {/* Başlık */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-[#1e1e1e]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-[#c9762c]/10 border border-[#c9762c]/20 flex items-center justify-center shrink-0">
              <span className="text-[#c9762c] text-xs font-black">{initials}</span>
            </div>
            <div>
              <p className="text-white font-bold text-sm">{appt.customer.fullName}</p>
              <p className="text-[#9ca3af] text-xs">{appt.customer.phone}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${sc.bg} ${sc.text} ${sc.border}`}>
              {STATUS_LABEL[appt.status] ?? appt.status}
            </span>
            <button onClick={onClose} className="text-[#9ca3af] hover:text-white transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Detaylar */}
        <div className="px-5 py-4 space-y-3">
          <ModalRow icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />}
            label="Hizmet"
            value={appt.services && appt.services.length > 0 ? appt.services.map(s => s.serviceName).join(", ") : appt.service?.name ?? "—"}
            sub={appt.services && appt.services.length > 0 ? `${appt.services.reduce((s, i) => s + i.durationMinutes, 0)} dk` : appt.service ? `${appt.service.durationMinutes} dk` : undefined} />

          <div className="flex items-center gap-3">
            <div className="w-4 h-4 shrink-0 flex items-center justify-center">
              <div className="w-5 h-5 rounded-full flex items-center justify-center -ml-0.5" style={{ background: `${appt.barber.calendarColor}20`, border: `1px solid ${appt.barber.calendarColor}40` }}>
                <span className="text-[7px] font-black" style={{ color: appt.barber.calendarColor }}>{barberInitials}</span>
              </div>
            </div>
            <div>
              <span className="text-[#9ca3af] text-xs">Çalışan</span>
              <span className="text-white text-sm font-semibold ml-2">{appt.barber.name}</span>
            </div>
          </div>

          <ModalRow icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />}
            label="Tarih" value={new Date(appt.date).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" })} />

          <ModalRow icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />}
            label="Saat" value={`${appt.startTime} – ${appt.endTime}`} accent />
        </div>

        {/* Fiyat */}
        <div className="mx-5 mb-4 px-4 py-3 bg-[#c9762c]/6 border border-[#c9762c]/15 rounded-xl flex justify-between items-center">
          <span className="text-[#9ca3af] text-xs">Randevu Tutarı</span>
          <span className="text-[#c9762c] font-black text-xl">{formatPrice(appt.appointmentPrice)}</span>
        </div>

        {/* Aksiyonlar */}
        {appt.status !== "cancelled" && appt.status !== "completed" && (
          <div className="flex gap-2 px-5 pb-5">
            {appt.status === "pending" && (
              <button
                onClick={() => updateStatus("confirmed")}
                disabled={loading}
                className="flex-1 py-2.5 text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-lg hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
              >
                Onayla
              </button>
            )}
            {appt.status === "confirmed" && (
              <button
                onClick={() => updateStatus("completed")}
                disabled={loading}
                className="flex-1 py-2.5 text-xs font-bold bg-[#c9762c]/10 text-[#c9762c] border border-[#c9762c]/20 rounded-lg hover:bg-[#c9762c]/20 transition-colors disabled:opacity-50"
              >
                Tamamla
              </button>
            )}
            <button
              onClick={() => updateStatus("cancelled")}
              disabled={loading}
              className="flex-1 py-2.5 text-xs font-bold bg-red-500/8 text-red-400 border border-red-500/15 rounded-lg hover:bg-red-500/15 transition-colors disabled:opacity-50"
            >
              {loading ? "..." : "İptal Et"}
            </button>
          </div>
        )}
        {(appt.status === "cancelled" || appt.status === "completed") && (
          <div className="px-5 pb-5">
            <p className={`text-center text-xs py-2 rounded-lg border ${sc.bg} ${sc.text} ${sc.border}`}>
              Bu randevu {appt.status === "completed" ? "tamamlandı" : "iptal edildi"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function ModalRow({ icon, label, value, sub, accent }: {
  icon: React.ReactNode; label: string; value: string; sub?: string; accent?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <svg className="w-4 h-4 shrink-0 text-[#6b7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24">{icon}</svg>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[#9ca3af] text-xs w-12 shrink-0">{label}</span>
        <span className={`text-sm font-semibold ${accent ? "text-[#c9762c]" : "text-white"}`}>{value}</span>
        {sub && <span className="text-[#9ca3af] text-xs">{sub}</span>}
      </div>
    </div>
  );
}
