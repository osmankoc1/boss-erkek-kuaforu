"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Campaign } from "@/app/generated/prisma/client";

type FormState = {
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  buttonText: string;
  buttonLink: string;
  priority: number;
  showOnHome: boolean;
  isActive: boolean;
};

const EMPTY_FORM: FormState = {
  title: "", description: "", startDate: "", endDate: "",
  buttonText: "", buttonLink: "", priority: 0, showOnHome: true, isActive: true,
};

function toFormState(c: Campaign): FormState {
  return {
    title: c.title,
    description: c.description,
    startDate: new Date(c.startDate).toISOString().split("T")[0],
    endDate: new Date(c.endDate).toISOString().split("T")[0],
    buttonText: c.buttonText ?? "",
    buttonLink: c.buttonLink ?? "",
    priority: c.priority,
    showOnHome: c.showOnHome,
    isActive: c.isActive,
  };
}

function campaignStatus(c: Campaign): "active" | "expired" | "upcoming" | "inactive" {
  if (!c.isActive) return "inactive";
  const now = new Date();
  if (new Date(c.endDate) < now) return "expired";
  if (new Date(c.startDate) > now) return "upcoming";
  return "active";
}

const STATUS_STYLE: Record<string, string> = {
  active: "text-emerald-400 border-emerald-500/20 bg-emerald-500/5",
  expired: "text-[#6b7280] border-[#2a2a2a] bg-[#111]",
  upcoming: "text-sky-400 border-sky-500/20 bg-sky-500/5",
  inactive: "text-[#6b7280] border-[#2a2a2a] bg-[#111]",
};
const STATUS_LABEL: Record<string, string> = {
  active: "Aktif", expired: "Süresi Dolmuş", upcoming: "Yakında", inactive: "Pasif",
};

export default function CampaignManager({ campaigns }: { campaigns: Campaign[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "add" | "edit">("idle");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function openAdd() { setForm(EMPTY_FORM); setEditingId(null); setMode("add"); setError(""); }

  function openEdit(c: Campaign) { setForm(toFormState(c)); setEditingId(c.id); setMode("edit"); setError(""); }

  function closeForm() { setMode("idle"); setEditingId(null); setError(""); }

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title || !form.description || !form.startDate || !form.endDate) {
      setError("Başlık, açıklama ve tarihler zorunludur.");
      return;
    }
    setSaving(true);
    setError("");

    const payload = {
      ...form,
      buttonText: form.buttonText || null,
      buttonLink: form.buttonLink || null,
    };

    try {
      if (mode === "add") {
        const res = await fetch("/api/campaigns", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) { setError("Kayıt başarısız."); return; }
      } else {
        const res = await fetch(`/api/campaigns/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) { setError("Güncelleme başarısız."); return; }
      }
      closeForm();
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(id: string, current: boolean) {
    await fetch(`/api/campaigns/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !current }),
    });
    router.refresh();
  }

  async function handleDelete(id: string) {
    if (!confirm("Kampanyayı silmek istediğinize emin misiniz?")) return;
    await fetch(`/api/campaigns/${id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {/* Üst aksiyon */}
      {mode === "idle" && (
        <button
          onClick={openAdd}
          className="flex items-center gap-2 px-4 py-2 bg-[#c9762c] hover:bg-[#e8913a] text-white text-sm font-semibold rounded-lg transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Yeni Kampanya
        </button>
      )}

      {/* Form (add veya edit) */}
      {mode !== "idle" && (
        <div className="bg-[#141414] border border-[#c9762c]/25 rounded-xl p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-bold text-white text-sm">
              {mode === "add" ? "Yeni Kampanya Ekle" : "Kampanyayı Düzenle"}
            </h2>
            <button onClick={closeForm} className="text-[#9ca3af] hover:text-white transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {error && (
            <div className="mb-4 px-3 py-2 bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg">{error}</div>
          )}

          <form onSubmit={handleSave} className="space-y-5">
            {/* Satır 1: Başlık + Öncelik */}
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px] gap-4">
              <Field label="Banner Başlığı *" value={form.title} onChange={(v) => set("title", v)} placeholder="Haziran Özel — %20 İndirim" />
              <div>
                <label className="block text-xs text-[#9ca3af] mb-1.5 uppercase tracking-wider">Öncelik</label>
                <input
                  type="number" min={0} max={99} value={form.priority}
                  onChange={(e) => set("priority", Number(e.target.value))}
                  className="w-full bg-[#1e1e1e] border border-[#2a2a2a] focus:border-[#c9762c] rounded-lg px-3 py-2 text-white outline-none text-sm"
                />
                <p className="text-[#9ca3af] text-[10px] mt-1">0 = önce göster</p>
              </div>
            </div>

            {/* Açıklama */}
            <div>
              <label className="block text-xs text-[#9ca3af] mb-1.5 uppercase tracking-wider">Açıklama *</label>
              <textarea
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
                rows={2}
                placeholder="Kampanya detaylarını yazın..."
                className="w-full bg-[#1e1e1e] border border-[#2a2a2a] focus:border-[#c9762c] rounded-lg px-3 py-2 text-white placeholder-[#4b5563] outline-none text-sm resize-none"
              />
            </div>

            {/* Satır 3: Tarihler */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Başlangıç Tarihi *" value={form.startDate} onChange={(v) => set("startDate", v)} type="date" />
              <Field label="Bitiş Tarihi *" value={form.endDate} onChange={(v) => set("endDate", v)} type="date" />
            </div>

            {/* Satır 4: Buton (opsiyonel) */}
            <div className="border-t border-[#1e1e1e] pt-5">
              <p className="text-xs text-[#9ca3af] uppercase tracking-wider mb-3">Aksiyon Butonu (opsiyonel)</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Buton Metni" value={form.buttonText} onChange={(v) => set("buttonText", v)} placeholder="Hemen Yararlan" />
                <Field label="Buton Linki" value={form.buttonLink} onChange={(v) => set("buttonLink", v)} placeholder="/randevu" />
              </div>
            </div>

            {/* Satır 5: Toggle'lar */}
            <div className="flex flex-wrap gap-6 pt-1">
              <Toggle label="Ana sayfada göster" checked={form.showOnHome} onChange={(v) => set("showOnHome", v)} />
              <Toggle label="Aktif" checked={form.isActive} onChange={(v) => set("isActive", v)} />
            </div>

            <div className="flex gap-3 pt-1">
              <button
                type="submit"
                disabled={saving}
                className="px-6 py-2 bg-[#c9762c] hover:bg-[#e8913a] text-white text-sm font-semibold rounded-lg disabled:opacity-50 transition-colors"
              >
                {saving ? "Kaydediliyor..." : mode === "add" ? "Ekle" : "Güncelle"}
              </button>
              <button
                type="button"
                onClick={closeForm}
                className="px-5 py-2 border border-[#2a2a2a] text-[#9ca3af] hover:text-white text-sm rounded-lg transition-colors"
              >
                İptal
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Kampanya listesi */}
      <div className="space-y-3">
        {campaigns.map((c) => {
          const status = campaignStatus(c);
          const isEditing = editingId === c.id && mode === "edit";
          return (
            <div
              key={c.id}
              className={`bg-[#141414] border rounded-xl p-5 transition-all ${isEditing ? "border-[#c9762c]/40" : "border-[#2a2a2a]"}`}
            >
              <div className="flex items-start justify-between gap-4">
                {/* Sol: İçerik */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <span className="font-bold text-white text-sm truncate">{c.title}</span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 border rounded-full ${STATUS_STYLE[status]}`}>
                      {STATUS_LABEL[status]}
                    </span>
                    {c.showOnHome && (
                      <span className="text-[10px] px-2 py-0.5 border border-[#c9762c]/25 text-[#c9762c] rounded-full">
                        Ana Sayfa
                      </span>
                    )}
                    {c.priority === 0 && (
                      <span className="text-[10px] px-2 py-0.5 border border-[#2a2a2a] text-[#9ca3af] rounded-full">
                        Önce Göster
                      </span>
                    )}
                  </div>
                  <p className="text-[#6b7280] text-xs leading-relaxed mb-2">{c.description}</p>
                  <div className="flex items-center gap-4 text-[#9ca3af] text-[11px]">
                    <span className="flex items-center gap-1">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      {new Date(c.startDate).toLocaleDateString("tr-TR")} — {new Date(c.endDate).toLocaleDateString("tr-TR")}
                    </span>
                    {c.buttonText && (
                      <span className="flex items-center gap-1 text-[#c9762c]/70">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 9l3 3m0 0l-3 3m3-3H8m13 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {c.buttonText}
                      </span>
                    )}
                  </div>
                </div>

                {/* Sağ: Aksiyonlar */}
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => openEdit(c)}
                    className="text-xs px-3 py-1.5 border border-[#2a2a2a] text-[#9ca3af] hover:border-[#c9762c]/40 hover:text-white rounded-lg transition-colors"
                  >
                    Düzenle
                  </button>
                  <button
                    onClick={() => handleToggleActive(c.id, c.isActive)}
                    className={`text-xs px-3 py-1.5 border rounded-lg transition-colors ${
                      c.isActive
                        ? "border-[#2a2a2a] text-[#9ca3af] hover:border-red-500/30 hover:text-red-400"
                        : "border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/5"
                    }`}
                  >
                    {c.isActive ? "Pasife Al" : "Aktif Et"}
                  </button>
                  <button
                    onClick={() => handleDelete(c.id)}
                    className="text-xs px-3 py-1.5 border border-red-500/15 text-red-400/70 hover:text-red-400 hover:bg-red-500/5 rounded-lg transition-colors"
                  >
                    Sil
                  </button>
                </div>
              </div>
            </div>
          );
        })}
        {campaigns.length === 0 && (
          <div className="text-center py-16 bg-[#111] border border-[#1e1e1e] rounded-xl">
            <div className="w-12 h-12 rounded-full bg-[#1e1e1e] flex items-center justify-center mx-auto mb-4">
              <svg className="w-5 h-5 text-[#9ca3af]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
              </svg>
            </div>
            <p className="text-[#9ca3af] text-sm font-medium">Henüz kampanya yok</p>
            <p className="text-[#6b7280] text-xs mt-1">Yukarıdan yeni kampanya ekleyin</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <div>
      <label className="block text-xs text-[#9ca3af] mb-1.5 uppercase tracking-wider">{label}</label>
      <input
        type={type} value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-[#1e1e1e] border border-[#2a2a2a] focus:border-[#c9762c] rounded-lg px-3 py-2 text-white placeholder-[#4b5563] outline-none text-sm"
      />
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2.5 cursor-pointer select-none">
      <div
        onClick={() => onChange(!checked)}
        className={`relative w-9 h-5 rounded-full transition-colors ${checked ? "bg-[#c9762c]" : "bg-[#2a2a2a]"}`}
      >
        <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all shadow-sm ${checked ? "left-4" : "left-0.5"}`} />
      </div>
      <span className="text-sm text-[#9ca3af]">{label}</span>
    </label>
  );
}
