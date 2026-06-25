"use client";
import { useState } from "react";
import { formatDate, STATUS_LABELS } from "@/lib/utils";

export default function RandevuSorgulaPage() {
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [appointments, setAppointments] = useState<any[]>([]);
  const [searched, setSearched] = useState(false);
  const [cancelLoading, setCancelLoading] = useState<string | null>(null);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!phone.trim()) return;
    setLoading(true);
    const res = await fetch(`/api/appointments?phone=${encodeURIComponent(phone.trim())}`);
    const data = await res.json();
    setAppointments(data.appointments ?? []);
    setSearched(true);
    setLoading(false);
  }

  async function handleCancel(id: string) {
    if (!confirm("Randevuyu iptal etmek istediğinize emin misiniz?")) return;
    setCancelLoading(id);
    await fetch(`/api/appointments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "cancelled" }),
    });
    setAppointments((prev) => prev.map((a) => (a.id === id ? { ...a, status: "cancelled" } : a)));
    setCancelLoading(null);
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      {/* Header */}
      <div className="relative py-24 px-6 overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{ background: "radial-gradient(ellipse at 50% 0%, #c9762c, transparent 70%)" }}
        />
        <div className="relative max-w-2xl mx-auto text-center">
          <p className="text-[#c9762c] text-xs font-bold tracking-[0.4em] uppercase mb-4">Randevularım</p>
          <h1 className="text-5xl md:text-6xl font-black mb-5 leading-tight">Randevu Sorgula</h1>
          <p className="text-[#6b7280] text-lg">Telefon numaranızla tüm randevularınızı görüntüleyin.</p>
        </div>
      </div>

      {/* Form + Sonuçlar */}
      <div className="px-6 pb-24">
        <div className="max-w-2xl mx-auto">
          {/* Arama formu */}
          <form onSubmit={handleSearch} className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-6 mb-8">
            <label className="block text-xs font-bold text-[#9ca3af] mb-3 uppercase tracking-[0.2em]">
              Telefon Numaranız
            </label>
            <div className="flex gap-3">
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+90 555 000 00 00"
                className="flex-1 bg-[#0f0f0f] border border-[#2a2a2a] focus:border-[#c9762c] rounded-md px-4 py-3 text-white placeholder-[#4b5563] outline-none transition-colors text-sm"
              />
              <button
                type="submit"
                disabled={loading}
                className="px-7 py-3 bg-[#c9762c] hover:bg-[#e8913a] disabled:opacity-50 text-white font-bold rounded-md transition-all hover:shadow-[0_0_20px_rgba(201,118,44,0.3)] text-sm"
              >
                {loading ? "..." : "Sorgula"}
              </button>
            </div>
          </form>

          {/* Sonuçlar */}
          {searched && (
            appointments.length === 0 ? (
              <div className="text-center py-12 text-[#6b7280] bg-[#141414] border border-[#2a2a2a] rounded-xl">
                <div className="w-12 h-12 rounded-full bg-[#1e1e1e] flex items-center justify-center mx-auto mb-4">
                  <svg className="w-5 h-5 text-[#6b7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <p className="font-semibold text-sm">Randevu bulunamadı</p>
                <p className="text-xs mt-1 text-[#4b5563]">Bu numaraya ait kayıt yok.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {appointments.map((a) => (
                  <div key={a.id} className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-5 hover:border-[#c9762c]/20 transition-colors">
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <div className="font-bold text-white">{a.service?.name}</div>
                        <div className="text-[#6b7280] text-sm mt-0.5">{a.barber?.name}</div>
                      </div>
                      <StatusBadge status={a.status} />
                    </div>
                    <div className="flex items-center gap-5 text-sm text-[#6b7280]">
                      <span className="flex items-center gap-1.5">
                        <svg className="w-3.5 h-3.5 text-[#c9762c]/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        {formatDate(a.date)}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <svg className="w-3.5 h-3.5 text-[#c9762c]/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {a.startTime}
                      </span>
                    </div>
                    {(a.status === "pending" || a.status === "confirmed") && (
                      <button
                        onClick={() => handleCancel(a.id)}
                        disabled={cancelLoading === a.id}
                        className="mt-4 text-xs font-semibold text-red-400/70 hover:text-red-400 transition-colors disabled:opacity-40 border-t border-[#2a2a2a] pt-4 w-full text-left"
                      >
                        {cancelLoading === a.id ? "İptal ediliyor..." : "Randevuyu İptal Et"}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: "bg-yellow-500/8 text-yellow-400 border-yellow-500/15",
    confirmed: "bg-green-500/8 text-green-400 border-green-500/15",
    cancelled: "bg-red-500/8 text-red-400 border-red-500/15",
    completed: "bg-[#c9762c]/8 text-[#c9762c] border-[#c9762c]/15",
  };
  return (
    <span className={`px-2.5 py-1 rounded border text-xs font-bold tracking-wide ${styles[status] ?? "text-[#6b7280] border-[#2a2a2a]"}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}
