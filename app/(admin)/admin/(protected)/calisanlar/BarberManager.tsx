"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type WorkerType = "OWNER" | "COMMISSION" | "FIXED_SALARY";

type Barber = {
  id: string;
  name: string;
  bio: string | null;
  specialty: string | null;
  experienceYrs: number;
  calendarColor: string;
  isActive: boolean;
  photoUrl: string | null;
  workerType: WorkerType;
  commissionRate: number;
};

const WORKER_TYPE_LABELS: Record<WorkerType, string> = {
  OWNER: "Patron / Ortak",
  COMMISSION: "Komisyonlu",
  FIXED_SALARY: "Sabit Maaşlı",
};

const WORKER_TYPE_COLORS: Record<WorkerType, string> = {
  OWNER: "text-[#c9762c] border-[#c9762c]/30 bg-[#c9762c]/8",
  COMMISSION: "text-purple-400 border-purple-400/30 bg-purple-400/8",
  FIXED_SALARY: "text-sky-400 border-sky-400/30 bg-sky-400/8",
};

export default function BarberManager({ barbers }: { barbers: Barber[] }) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: "", bio: "", specialty: "", experienceYrs: 0,
    calendarColor: "#c9762c", workerType: "OWNER" as WorkerType, commissionRate: 0,
  });
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ workerType: WorkerType; commissionRate: number }>({
    workerType: "OWNER", commissionRate: 0,
  });
  const [editSaving, setEditSaving] = useState(false);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await fetch("/api/barbers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setShowForm(false);
    router.refresh();
    setSaving(false);
  }

  async function toggleActive(id: string, isActive: boolean) {
    await fetch(`/api/barbers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !isActive }),
    });
    router.refresh();
  }

  function openEdit(b: Barber) {
    setEditingId(b.id);
    setEditForm({ workerType: b.workerType, commissionRate: b.commissionRate });
  }

  async function handleEditSave(id: string) {
    setEditSaving(true);
    const payload: { workerType: WorkerType; commissionRate: number } = {
      workerType: editForm.workerType,
      commissionRate: editForm.workerType === "COMMISSION" ? editForm.commissionRate : 0,
    };
    await fetch(`/api/barbers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setEditingId(null);
    setEditSaving(false);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <button
        onClick={() => setShowForm(!showForm)}
        className="px-4 py-2 bg-[#c9762c] hover:bg-[#e8913a] text-white text-sm font-semibold rounded-lg transition-colors"
      >
        + Yeni Çalışan
      </button>

      {showForm && (
        <form
          onSubmit={handleAdd}
          className="bg-[#141414] border border-[#c9762c]/30 rounded-xl p-6 grid grid-cols-1 sm:grid-cols-2 gap-4"
        >
          <Input label="Ad Soyad" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          <Input label="Uzmanlık Alanı" value={form.specialty} onChange={(v) => setForm({ ...form, specialty: v })} />
          <Input
            label="Deneyim (yıl)"
            value={String(form.experienceYrs)}
            onChange={(v) => setForm({ ...form, experienceYrs: Number(v) })}
            type="number"
          />
          <div>
            <label className="block text-xs text-[#9ca3af] mb-1 uppercase tracking-wider">Takvim Rengi</label>
            <input
              type="color"
              value={form.calendarColor}
              onChange={(e) => setForm({ ...form, calendarColor: e.target.value })}
              className="w-full h-10 rounded-lg border border-[#2a2a2a] bg-[#1e1e1e] cursor-pointer"
            />
          </div>
          {/* Ücret sistemi */}
          <div>
            <label className="block text-xs text-[#9ca3af] mb-2 uppercase tracking-wider">Ücret Sistemi</label>
            <div className="space-y-1.5">
              {(["OWNER", "COMMISSION", "FIXED_SALARY"] as WorkerType[]).map((wt) => (
                <label key={wt} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="workerType_new"
                    value={wt}
                    checked={form.workerType === wt}
                    onChange={() => setForm({ ...form, workerType: wt })}
                    className="accent-[#c9762c]"
                  />
                  <span className="text-sm text-[#9ca3af]">{WORKER_TYPE_LABELS[wt]}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            {form.workerType === "COMMISSION" && (
              <>
                <label className="block text-xs text-[#9ca3af] mb-1 uppercase tracking-wider">
                  Komisyon Oranı (%)
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  value={form.commissionRate}
                  onChange={(e) => setForm({ ...form, commissionRate: parseFloat(e.target.value) || 0 })}
                  className="w-full bg-[#1e1e1e] border border-[#2a2a2a] focus:border-[#c9762c] rounded-lg px-3 py-2 text-white outline-none text-sm"
                />
              </>
            )}
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs text-[#9ca3af] mb-1 uppercase tracking-wider">Biyografi</label>
            <textarea
              value={form.bio}
              onChange={(e) => setForm({ ...form, bio: e.target.value })}
              rows={2}
              className="w-full bg-[#1e1e1e] border border-[#2a2a2a] focus:border-[#c9762c] rounded-lg px-3 py-2 text-white outline-none text-sm resize-none"
            />
          </div>
          <div className="sm:col-span-2 flex gap-3">
            <button type="submit" disabled={saving} className="px-5 py-2 bg-[#c9762c] text-white text-sm font-semibold rounded-lg disabled:opacity-50">
              {saving ? "Kaydediliyor..." : "Ekle"}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="px-5 py-2 border border-[#2a2a2a] text-[#9ca3af] text-sm rounded-lg">
              İptal
            </button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {barbers.map((b) => (
          <div key={b.id} className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-5 flex flex-col gap-3">
            {/* Üst: avatar + isim + workerType badge */}
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: `${b.calendarColor}20`, border: `1px solid ${b.calendarColor}40` }}
                >
                  {b.photoUrl ? (
                    <img src={b.photoUrl} className="w-10 h-10 rounded-full object-cover" alt={b.name} />
                  ) : (
                    <span>👨‍💈</span>
                  )}
                </div>
                <div>
                  <div className="font-bold text-white">{b.name}</div>
                  {b.specialty && <div className="text-[#c9762c] text-xs">{b.specialty}</div>}
                </div>
              </div>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded border shrink-0 ${WORKER_TYPE_COLORS[b.workerType]}`}>
                {WORKER_TYPE_LABELS[b.workerType]}
                {b.workerType === "COMMISSION" && ` %${b.commissionRate}`}
              </span>
            </div>

            {b.bio && <p className="text-[#6b7280] text-xs">{b.bio}</p>}

            {/* Ücret sistemi düzenleme */}
            {editingId === b.id ? (
              <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg p-4 space-y-3">
                <p className="text-[11px] font-semibold text-[#9ca3af] uppercase tracking-wider">Ücret Sistemi</p>
                <div className="space-y-2">
                  {(["OWNER", "COMMISSION", "FIXED_SALARY"] as WorkerType[]).map((wt) => (
                    <label key={wt} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name={`workerType_${b.id}`}
                        value={wt}
                        checked={editForm.workerType === wt}
                        onChange={() => setEditForm({ ...editForm, workerType: wt })}
                        className="accent-[#c9762c]"
                      />
                      <span className="text-sm text-[#9ca3af]">{WORKER_TYPE_LABELS[wt]}</span>
                    </label>
                  ))}
                </div>
                {editForm.workerType === "COMMISSION" && (
                  <div>
                    <label className="block text-[11px] font-semibold text-[#9ca3af] uppercase tracking-wider mb-1">
                      Komisyon Oranı (%)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={0.5}
                      value={editForm.commissionRate}
                      onChange={(e) => setEditForm({ ...editForm, commissionRate: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-[#111] border border-[#2a2a2a] focus:border-[#c9762c]/50 rounded-md px-3 py-2 text-white outline-none text-sm"
                    />
                  </div>
                )}
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => handleEditSave(b.id)}
                    disabled={editSaving}
                    className="px-3 py-1.5 bg-[#c9762c] hover:bg-[#e8913a] text-white text-xs font-bold rounded-md transition-colors disabled:opacity-50"
                  >
                    {editSaving ? "..." : "Kaydet"}
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="px-3 py-1.5 border border-[#2a2a2a] text-[#9ca3af] hover:text-white text-xs rounded-md transition-colors"
                  >
                    İptal
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => openEdit(b)}
                className="flex items-center gap-1.5 text-[12px] text-[#9ca3af] hover:text-[#c9762c] transition-colors self-start"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                Ücret sistemini düzenle
              </button>
            )}

            {/* Alt: aktiflik + detay */}
            <div className="flex items-center justify-between pt-1 border-t border-[#1e1e1e]">
              <div className="flex items-center gap-3">
                <span className={`text-xs px-2 py-0.5 rounded border ${b.isActive ? "text-green-400 border-green-500/20" : "text-[#6b7280] border-[#2a2a2a]"}`}>
                  {b.isActive ? "Aktif" : "Pasif"}
                </span>
                <button
                  onClick={() => toggleActive(b.id, b.isActive)}
                  className="text-xs text-[#6b7280] hover:text-[#c9762c] transition-colors"
                >
                  {b.isActive ? "Pasif Yap" : "Aktif Yap"}
                </button>
              </div>
              <a
                href={`/admin/calisanlar/${b.id}`}
                className="flex items-center gap-1 text-[12px] text-[#9ca3af] hover:text-[#c9762c] transition-colors"
              >
                Detay
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Input({ label, value, onChange, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void; type?: string;
}) {
  return (
    <div>
      <label className="block text-xs text-[#9ca3af] mb-1 uppercase tracking-wider">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-[#1e1e1e] border border-[#2a2a2a] focus:border-[#c9762c] rounded-lg px-3 py-2 text-white outline-none text-sm"
      />
    </div>
  );
}
