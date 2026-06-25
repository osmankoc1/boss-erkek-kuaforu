"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Barber = {
  id: string;
  name: string;
  bio: string | null;
  specialty: string | null;
  experienceYrs: number;
  calendarColor: string;
};

export default function BarberEditButton({ barber }: { barber: Barber }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: barber.name,
    bio: barber.bio ?? "",
    specialty: barber.specialty ?? "",
    experienceYrs: barber.experienceYrs,
    calendarColor: barber.calendarColor,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError("Ad alanı zorunludur."); return; }
    setSaving(true);
    setError("");
    const res = await fetch(`/api/barbers/${barber.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name.trim(),
        bio: form.bio.trim() || null,
        specialty: form.specialty.trim() || null,
        experienceYrs: Number(form.experienceYrs),
        calendarColor: form.calendarColor,
      }),
    });
    setSaving(false);
    if (!res.ok) { setError("Kayıt hatası."); return; }
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 border border-[#2a2a2a] rounded-md text-[12px] text-[#9ca3af] hover:text-white hover:border-[#3a3a3a] transition-all"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
        Profili Düzenle
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative bg-[#0f0f0f] border border-[#1e1e1e] rounded-xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#1e1e1e]">
              <h2 className="text-sm font-bold text-white">Profili Düzenle</h2>
              <button onClick={() => setOpen(false)} className="text-[#6b7280] hover:text-white transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form onSubmit={handleSave} className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-[11px] font-semibold text-[#9ca3af] uppercase tracking-wider mb-1.5">Ad Soyad *</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-md px-3 py-2 text-[13px] text-white focus:outline-none focus:border-[#c9762c]/50" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-[#9ca3af] uppercase tracking-wider mb-1.5">Uzmanlık</label>
                  <input value={form.specialty} onChange={(e) => setForm({ ...form, specialty: e.target.value })}
                    placeholder="Saç, sakal, fön..."
                    className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-md px-3 py-2 text-[13px] text-white focus:outline-none focus:border-[#c9762c]/50" />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-[#9ca3af] uppercase tracking-wider mb-1.5">Deneyim (yıl)</label>
                  <input type="number" min={0} max={50} value={form.experienceYrs}
                    onChange={(e) => setForm({ ...form, experienceYrs: parseInt(e.target.value) || 0 })}
                    className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-md px-3 py-2 text-[13px] text-white focus:outline-none focus:border-[#c9762c]/50" />
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#9ca3af] uppercase tracking-wider mb-1.5">Takvim Rengi</label>
                <div className="flex items-center gap-3">
                  <input type="color" value={form.calendarColor}
                    onChange={(e) => setForm({ ...form, calendarColor: e.target.value })}
                    className="w-12 h-9 rounded-md border border-[#2a2a2a] bg-[#1a1a1a] cursor-pointer" />
                  <span className="text-[12px] text-[#9ca3af]">{form.calendarColor}</span>
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#9ca3af] uppercase tracking-wider mb-1.5">Biyografi</label>
                <textarea value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })}
                  rows={3} placeholder="Kısa tanıtım..."
                  className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-md px-3 py-2 text-[13px] text-white focus:outline-none focus:border-[#c9762c]/50 resize-none" />
              </div>

              {error && <p className="text-red-400 text-xs">{error}</p>}

              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setOpen(false)}
                  className="flex-1 py-2.5 border border-[#2a2a2a] rounded-md text-[13px] text-[#9ca3af] hover:text-white transition-all">
                  İptal
                </button>
                <button type="submit" disabled={saving}
                  className="flex-1 py-2.5 bg-[#c9762c] hover:bg-[#e8913a] rounded-md text-[13px] font-bold text-white transition-all disabled:opacity-50">
                  {saving ? "Kaydediliyor..." : "Kaydet"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
