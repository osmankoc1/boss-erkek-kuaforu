"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

type SearchResult = {
  id: string;
  fullName: string;
  phone: string;
};

type Preview = {
  visits: number;
  totalSale: number;
  totalPaid: number;
  totalDebt: number;
};

type Props = {
  currentId: string;
  currentName: string;
};

export default function MergeCustomerButton({ currentId, currentName }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"search" | "confirm">("search");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) { setStep("search"); setQuery(""); setResults([]); setSelected(null); setPreview(null); setError(""); }
  }, [open]);

  useEffect(() => {
    if (query.length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/customers?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        setResults((data.customers ?? []).filter((c: SearchResult) => c.id !== currentId).slice(0, 8));
      } catch { /* silent */ }
      finally { setSearching(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [query, currentId]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setResults([]);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  async function loadPreview(secondary: SearchResult) {
    setSelected(secondary);
    setStep("confirm");
    setLoadingPreview(true);
    try {
      const res = await fetch(`/api/customers/${secondary.id}/preview-merge?primaryId=${currentId}`);
      const data = await res.json();
      setPreview(data.preview);
    } catch { /* silent */ }
    finally { setLoadingPreview(false); }
  }

  async function handleMerge() {
    if (!selected) return;
    setMerging(true);
    setError("");
    try {
      const res = await fetch("/api/customers/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ primaryId: currentId, secondaryId: selected.id }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Hata oluştu."); return; }
      setOpen(false);
      router.push(`/admin/musteriler/${currentId}`);
      router.refresh();
    } catch {
      setError("Bağlantı hatası.");
    } finally {
      setMerging(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 border border-[#2a2a2a] rounded-md text-[12px] text-[#9ca3af] hover:text-yellow-400 hover:border-yellow-500/30 transition-all"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
        Birleştir
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative bg-[#0f0f0f] border border-[#1e1e1e] rounded-xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#1e1e1e]">
              <div>
                <h2 className="text-sm font-bold text-white">Müşteri Birleştir</h2>
                <p className="text-[11px] text-[#6b7280] mt-0.5">Ana kayıt: <span className="text-[#c9762c]">{currentName}</span></p>
              </div>
              <button onClick={() => setOpen(false)} className="text-[#6b7280] hover:text-white">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {step === "search" && (
                <>
                  <p className="text-[12px] text-[#9ca3af]">
                    Hangi müşteri bu kayıtla birleştirilsin? Tüm satış, randevu ve ödemeler ana kayda aktarılır.
                  </p>
                  <div className="relative" ref={dropdownRef}>
                    <div className="relative">
                      <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Ad veya telefon ile ara..."
                        className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-md pl-9 pr-3 py-2 text-[13px] text-white placeholder-[#5a5a5a] focus:outline-none focus:border-[#c9762c]/50"
                      />
                      <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#6b7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                      {searching && <div className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 border border-[#5a5a5a] border-t-transparent rounded-full animate-spin" />}
                    </div>
                    {results.length > 0 && (
                      <div className="absolute z-10 mt-1 w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-md shadow-xl overflow-hidden">
                        {results.map((c) => (
                          <button key={c.id} type="button" onClick={() => loadPreview(c)}
                            className="w-full text-left px-4 py-2.5 hover:bg-[#252525] transition-colors border-b border-[#222] last:border-0">
                            <span className="text-[13px] text-white font-medium">{c.fullName}</span>
                            <span className="text-[11px] text-[#9ca3af] ml-2">{c.phone}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}

              {step === "confirm" && selected && (
                <>
                  <div className="bg-yellow-500/8 border border-yellow-500/20 rounded-lg p-4 space-y-2">
                    <p className="text-[12px] font-semibold text-yellow-400">Birleştirme önizlemesi</p>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[12px]">
                      <span className="text-[#9ca3af]">Ana müşteri:</span>
                      <span className="text-white font-medium">{currentName}</span>
                      <span className="text-[#9ca3af]">Silinecek kayıt:</span>
                      <span className="text-white font-medium">{selected.fullName} <span className="text-[#6b7280]">({selected.phone})</span></span>
                    </div>
                  </div>

                  {loadingPreview ? (
                    <div className="flex items-center gap-2 text-[12px] text-[#6b7280]">
                      <div className="w-3 h-3 border border-[#5a5a5a] border-t-transparent rounded-full animate-spin" />
                      Önizleme yükleniyor...
                    </div>
                  ) : preview && (
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { label: "Toplam Ziyaret", value: preview.visits },
                        { label: "Toplam Satış", value: `${preview.totalSale.toFixed(2)} ₺` },
                        { label: "Toplam Tahsilat", value: `${preview.totalPaid.toFixed(2)} ₺` },
                        { label: "Toplam Borç", value: `${preview.totalDebt.toFixed(2)} ₺`, warn: preview.totalDebt > 0 },
                      ].map((item) => (
                        <div key={item.label} className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-md px-3 py-2">
                          <p className="text-[10px] text-[#6b7280] uppercase tracking-wider">{item.label}</p>
                          <p className={`text-[14px] font-bold mt-0.5 ${item.warn ? "text-orange-400" : "text-white"}`}>{item.value}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  <p className="text-[11px] text-[#6b7280]">
                    Birleştirme sonrası <strong className="text-[#9ca3af]">{selected.fullName}</strong> kaydı pasife alınır; silinmez, geçmiş korunur.
                  </p>

                  {error && <p className="text-red-400 text-xs">{error}</p>}

                  <div className="flex gap-3">
                    <button type="button" onClick={() => setStep("search")}
                      className="flex-1 py-2 border border-[#2a2a2a] rounded-md text-[12px] text-[#9ca3af] hover:text-white transition-all">
                      ← Geri
                    </button>
                    <button type="button" onClick={handleMerge} disabled={merging}
                      className="flex-1 py-2 bg-yellow-600 hover:bg-yellow-500 rounded-md text-[12px] font-bold text-white transition-all disabled:opacity-50">
                      {merging ? "Birleştiriliyor..." : "Birleştir"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
