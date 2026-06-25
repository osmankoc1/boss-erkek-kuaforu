"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatPrice } from "@/lib/utils";

type Service = {
  id: string; name: string; description: string | null;
  durationMinutes: number; price: number; isActive: boolean;
  displayOrder: number; category: string;
};
type ServiceStat = { count: number; revenue: number; lastUsed: string | null };

const CATEGORIES = ["Saç", "Sakal", "Bakım", "Paket", "Çocuk", "Diğer"];

const CATEGORY_COLORS: Record<string, string> = {
  Saç: "text-blue-400 border-blue-500/20 bg-blue-500/5",
  Sakal: "text-purple-400 border-purple-500/20 bg-purple-500/5",
  Bakım: "text-green-400 border-green-500/20 bg-green-500/5",
  Paket: "text-[#c9762c] border-[#c9762c]/20 bg-[#c9762c]/5",
  Çocuk: "text-pink-400 border-pink-500/20 bg-pink-500/5",
  Diğer: "text-yellow-400 border-yellow-500/30 bg-yellow-500/8",
};

const emptyForm = { name: "", description: "", durationMinutes: 30, price: 0, category: "Diğer" };

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric" });
}

async function patchService(id: string, body: Record<string, unknown>): Promise<string | null> {
  try {
    const res = await fetch(`/api/services/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      return (json as { error?: string }).error ?? `Hata ${res.status}`;
    }
    return null;
  } catch {
    return "Ağ hatası. Lütfen tekrar deneyin.";
  }
}

export default function ServiceManager({
  services: init,
  statsMap,
}: {
  services: Service[];
  statsMap: Record<string, ServiceStat>;
}) {
  const router = useRouter();
  const [services, setServices] = useState(init);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reordering, setReordering] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const uncategorized = services.filter((s) => s.category === "Diğer" && s.isActive).length;

  function showSuccess(msg: string) {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 3000);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);

    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      durationMinutes: Number(form.durationMinutes) || 30,
      price: Number(form.price) || 0,
      category: form.category,
    };

    if (!payload.name) { setError("Hizmet adı boş bırakılamaz."); setSaving(false); return; }

    const currentEditId = editId; // capture before state reset

    if (currentEditId) {
      const err = await patchService(currentEditId, payload);
      setSaving(false);
      if (err) { setError(err); return; }

      // Anında local state güncelle
      setServices((prev) =>
        prev.map((s) =>
          s.id === currentEditId
            ? { ...s, name: payload.name, description: payload.description ?? null, durationMinutes: payload.durationMinutes, price: payload.price, category: payload.category }
            : s
        )
      );
      setEditId(null);
      setShowForm(false);
      setForm(emptyForm);
      showSuccess("Hizmet güncellendi.");
      router.refresh();
    } else {
      let newService: Service | null = null;
      let err: string | null = null;
      try {
        const res = await fetch("/api/services", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          err = (json as { error?: string }).error ?? `Hata ${res.status}`;
        } else {
          const json = await res.json().catch(() => ({}));
          newService = (json as { service?: Service }).service ?? null;
        }
      } catch {
        err = "Ağ hatası. Lütfen tekrar deneyin.";
      }

      setSaving(false);
      if (err) { setError(err); return; }

      // Anında local state'e ekle
      if (newService) setServices((prev) => [...prev, newService!]);
      setShowForm(false);
      setForm(emptyForm);
      showSuccess("Hizmet eklendi.");
      router.refresh();
    }
  }

  function startEdit(s: Service) {
    setError(null);
    setForm({ name: s.name, description: s.description ?? "", durationMinutes: s.durationMinutes, price: s.price, category: s.category });
    setEditId(s.id);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function toggleActive(id: string, isActive: boolean) {
    setError(null);
    // Optimistic update
    setServices((prev) => prev.map((s) => s.id === id ? { ...s, isActive: !isActive } : s));
    const err = await patchService(id, { isActive: !isActive });
    if (err) {
      setServices((prev) => prev.map((s) => s.id === id ? { ...s, isActive } : s)); // revert
      setError(err);
    } else {
      showSuccess(`Hizmet ${!isActive ? "aktif" : "pasif"} yapıldı.`);
      router.refresh();
    }
  }

  async function moveOrder(id: string, dir: "up" | "down") {
    setError(null);
    setReordering(id);

    // Mevcut sıralama — swap öncesi snapshot
    const sortedSnapshot = [...services].sort((a, b) => a.displayOrder - b.displayOrder);
    const idx = sortedSnapshot.findIndex((s) => s.id === id);
    const swapIdx = dir === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sortedSnapshot.length) { setReordering(null); return; }

    // Swap uygula, sonra tüm listeye 1-tabanlı benzersiz sıra ver
    const newSorted = [...sortedSnapshot];
    [newSorted[idx], newSorted[swapIdx]] = [newSorted[swapIdx], newSorted[idx]];
    const newOrders = newSorted.map((s, i) => ({ id: s.id, displayOrder: i + 1 }));

    // Anında local state güncelle (optimistik)
    setServices((prev) =>
      prev.map((s) => {
        const o = newOrders.find((n) => n.id === s.id);
        return o ? { ...s, displayOrder: o.displayOrder } : s;
      })
    );

    // Sadece değişen servisleri DB'ye yaz
    const changed = newOrders.filter((o) => {
      const orig = sortedSnapshot.find((s) => s.id === o.id);
      return orig?.displayOrder !== o.displayOrder;
    });

    const results = await Promise.all(
      changed.map((o) => patchService(o.id, { displayOrder: o.displayOrder }))
    );

    setReordering(null);
    const err = results.find((r) => r !== null) ?? null;
    if (err) {
      // Geri al — snapshot'a dön
      setServices((prev) =>
        prev.map((s) => {
          const orig = sortedSnapshot.find((o) => o.id === s.id);
          return orig ? { ...s, displayOrder: orig.displayOrder } : s;
        })
      );
      setError(err);
    } else {
      router.refresh();
    }
  }

  const sorted = [...services].sort((a, b) => a.displayOrder - b.displayOrder);

  return (
    <div className="space-y-4">
      {/* Başarı mesajı */}
      {successMsg && (
        <div className="flex items-center gap-2 px-4 py-3 bg-green-500/8 border border-green-500/20 rounded-xl text-sm text-green-400">
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          {successMsg}
        </div>
      )}

      {/* Hata mesajı */}
      {error && (
        <div className="flex items-center justify-between gap-2 px-4 py-3 bg-red-500/8 border border-red-500/20 rounded-xl text-sm">
          <div className="flex items-center gap-2 text-red-400">
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            {error}
          </div>
          <button onClick={() => setError(null)} className="text-[#6b7280] hover:text-white transition-colors text-xs">Kapat</button>
        </div>
      )}

      {/* Uyarı: kategorisiz hizmetler */}
      {uncategorized > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 bg-yellow-500/5 border border-yellow-500/20 rounded-xl text-sm">
          <svg className="w-4 h-4 text-yellow-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span className="text-yellow-400 font-medium">{uncategorized} hizmetin kategorisi seçilmemiş.</span>
          <span className="text-[#9ca3af]">Analitik raporlar için &quot;Düzenle&quot; ile kategori atayın.</span>
        </div>
      )}

      {/* Araç çubuğu */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => { setEditId(null); setForm(emptyForm); setError(null); setShowForm(!showForm); }}
          className="px-4 py-2 bg-[#c9762c] hover:bg-[#e8913a] text-white text-sm font-semibold rounded-lg transition-colors"
        >
          + Yeni Hizmet
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <form onSubmit={handleSave} className="bg-[#141414] border border-[#c9762c]/30 rounded-xl p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <p className="text-sm font-bold text-white mb-4">{editId ? "Hizmet Düzenle" : "Yeni Hizmet Ekle"}</p>
          </div>
          <FormInput label="Hizmet Adı *" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          <FormInput label="Açıklama" value={form.description} onChange={(v) => setForm({ ...form, description: v })} />
          <FormInput label="Süre (dk)" value={String(form.durationMinutes)} onChange={(v) => setForm({ ...form, durationMinutes: Number(v) || 0 })} type="number" />
          <FormInput label="Fiyat (₺)" value={String(form.price)} onChange={(v) => setForm({ ...form, price: Number(v) || 0 })} type="number" />
          <div>
            <label className="block text-xs text-[#9ca3af] mb-1 uppercase tracking-wider">Kategori</label>
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
              className="w-full bg-[#1e1e1e] border border-[#2a2a2a] focus:border-[#c9762c] rounded-lg px-3 py-2 text-white outline-none text-sm">
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2 flex gap-3">
            <button type="submit" disabled={saving} className="px-5 py-2 bg-[#c9762c] text-white text-sm font-semibold rounded-lg disabled:opacity-50">
              {saving ? "Kaydediliyor..." : (editId ? "Güncelle" : "Ekle")}
            </button>
            <button type="button" onClick={() => { setShowForm(false); setEditId(null); setForm(emptyForm); setError(null); }} className="px-5 py-2 border border-[#2a2a2a] text-[#9ca3af] text-sm rounded-lg hover:text-white transition-colors">
              İptal
            </button>
          </div>
        </form>
      )}

      {/* Tablo */}
      <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl overflow-hidden">
        {sorted.length === 0 ? (
          <p className="text-center py-10 text-[#6b7280]">Henüz hizmet yok.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#2a2a2a]">
                  {["Sıra", "Hizmet", "Kategori", "Süre", "Fiyat", "Kullanım", "Ciro", "Son Kullanım", "Durum", ""].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-[#6b7280] text-xs font-semibold uppercase whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2a2a2a]">
                {sorted.map((s, idx) => {
                  const stat = statsMap[s.id];
                  const isUncategorized = s.category === "Diğer";
                  return (
                    <tr key={s.id} className={`hover:bg-[#1e1e1e] transition-colors ${!s.isActive ? "opacity-50" : ""}`}>
                      {/* Sıra */}
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-0.5">
                          <button onClick={() => moveOrder(s.id, "up")} disabled={idx === 0 || reordering !== null}
                            className="text-[#6b7280] hover:text-white disabled:opacity-20 transition-colors" title="Yukarı">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" />
                            </svg>
                          </button>
                          <span className="text-[11px] text-[#6b7280] text-center">{idx + 1}</span>
                          <button onClick={() => moveOrder(s.id, "down")} disabled={idx === sorted.length - 1 || reordering !== null}
                            className="text-[#6b7280] hover:text-white disabled:opacity-20 transition-colors" title="Aşağı">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>
                        </div>
                      </td>

                      {/* Hizmet adı */}
                      <td className="px-4 py-3">
                        <div className="font-semibold text-white">{s.name}</div>
                        {s.description && <div className="text-[#6b7280] text-xs mt-0.5 truncate max-w-[180px]">{s.description}</div>}
                      </td>

                      {/* Kategori */}
                      <td className="px-4 py-3">
                        {isUncategorized ? (
                          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border text-yellow-400 border-yellow-500/30 bg-yellow-500/8" title="Kategori seçilmemiş">
                            <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            Seçilmemiş
                          </span>
                        ) : (
                          <span className={`text-xs px-2 py-0.5 rounded border ${CATEGORY_COLORS[s.category] ?? CATEGORY_COLORS["Diğer"]}`}>
                            {s.category}
                          </span>
                        )}
                      </td>

                      {/* Süre */}
                      <td className="px-4 py-3 text-[#9ca3af] whitespace-nowrap">{s.durationMinutes} dk</td>

                      {/* Fiyat */}
                      <td className="px-4 py-3 text-[#c9762c] font-bold whitespace-nowrap">{formatPrice(s.price)}</td>

                      {/* Kullanım */}
                      <td className="px-4 py-3 text-white font-semibold whitespace-nowrap">
                        {stat ? stat.count : <span className="text-[#6b7280]">—</span>}
                      </td>

                      {/* Ciro */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        {stat ? <span className="text-green-400 font-semibold">{formatPrice(stat.revenue)}</span> : <span className="text-[#6b7280]">—</span>}
                      </td>

                      {/* Son kullanım */}
                      <td className="px-4 py-3 text-[#9ca3af] text-xs whitespace-nowrap">
                        {stat?.lastUsed ? fmtDate(stat.lastUsed) : <span className="text-[#6b7280]">—</span>}
                      </td>

                      {/* Durum */}
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded border ${s.isActive ? "text-green-400 border-green-500/20 bg-green-500/5" : "text-[#6b7280] border-[#2a2a2a]"}`}>
                          {s.isActive ? "Aktif" : "Pasif"}
                        </span>
                      </td>

                      {/* Aksiyonlar */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3 whitespace-nowrap">
                          <button onClick={() => startEdit(s)} className="text-xs text-[#6b7280] hover:text-white transition-colors">Düzenle</button>
                          <button onClick={() => toggleActive(s.id, s.isActive)} className="text-xs text-[#6b7280] hover:text-[#c9762c] transition-colors">
                            {s.isActive ? "Pasif Yap" : "Aktif Yap"}
                          </button>
                        </div>
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

function FormInput({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div>
      <label className="block text-xs text-[#9ca3af] mb-1 uppercase tracking-wider">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full bg-[#1e1e1e] border border-[#2a2a2a] focus:border-[#c9762c] rounded-lg px-3 py-2 text-white outline-none text-sm" />
    </div>
  );
}
