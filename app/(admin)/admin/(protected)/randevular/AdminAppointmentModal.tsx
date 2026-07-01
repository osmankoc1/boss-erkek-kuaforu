"use client";
import { useState, useEffect, useRef } from "react";
import ServicePicker, { type PickerService, type SelectedItem } from "@/components/admin/ServicePicker";

type Barber = { id: string; name: string; calendarColor: string };
type CustomerResult = { id: string; fullName: string; phone: string };

type Props = {
  barbers: Barber[];
  services: PickerService[];
  defaultDate?: string;
  onClose: () => void;
  onSaved: () => void;
};

type CustomerMode = "search" | "new" | "manual";

function addMinutes(time: string, mins: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + mins;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export default function AdminAppointmentModal({ barbers, services, defaultDate, onClose, onSaved }: Props) {
  const today = new Date().toISOString().slice(0, 10);

  // Customer
  const [customerMode, setCustomerMode] = useState<CustomerMode>("search");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<CustomerResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerResult | null>(null);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualPhone, setManualPhone] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Appointment
  const [barberId, setBarberId] = useState(barbers[0]?.id ?? "");
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([]);
  const [date, setDate] = useState(defaultDate ?? today);
  const [startTime, setStartTime] = useState("10:00");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const totalDuration = selectedItems.reduce((s, i) => s + i.durationMinutes, 0);
  const totalPrice = selectedItems.reduce((s, i) => s + i.price, 0);
  const endTime = totalDuration > 0 ? addMinutes(startTime, totalDuration) : "";

  // Customer search debounce
  useEffect(() => {
    if (customerMode !== "search" || searchQuery.length < 2) {
      setSearchResults([]); setShowDropdown(false); return;
    }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/customers?q=${encodeURIComponent(searchQuery)}`);
        const data = await res.json();
        setSearchResults((data.customers ?? []).slice(0, 8));
        setShowDropdown(true);
      } catch { /* silent */ }
      finally { setSearching(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [searchQuery, customerMode]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setShowDropdown(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const noResults = customerMode === "search" && searchQuery.length >= 2 && !searching && searchResults.length === 0;

  function clearCustomer() { setSelectedCustomer(null); setSearchQuery(""); setSearchResults([]); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    let customerName = "", customerPhone = "";
    if (customerMode === "search") {
      if (!selectedCustomer) { setError("Müşteri seçin veya başka bir mod kullanın."); return; }
      customerName = selectedCustomer.fullName; customerPhone = selectedCustomer.phone;
    } else if (customerMode === "new") {
      if (!newName.trim() || !newPhone.trim()) { setError("Ad ve telefon zorunludur."); return; }
      customerName = newName.trim(); customerPhone = newPhone.trim();
    } else {
      if (!manualName.trim() || !manualPhone.trim()) { setError("Ad ve telefon zorunludur."); return; }
      customerName = manualName.trim(); customerPhone = manualPhone.trim();
    }
    if (!date) { setError("Tarih seçin."); return; }
    if (selectedItems.length === 0) { setError("En az bir hizmet seçin."); return; }

    setLoading(true);
    try {
      const res = await fetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceIds: selectedItems.map((i) => i.serviceId),
          totalDuration,
          barberId, date, startTime,
          customerName, customerPhone,
          notes: notes || undefined,
          status: "confirmed",
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Hata oluştu."); return; }
      onSaved();
    } catch {
      setError("Bağlantı hatası.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#0f0f0f] border border-[#1e1e1e] rounded-xl w-full max-w-lg shadow-2xl overflow-y-auto max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1e1e1e]">
          <h2 className="text-sm font-bold text-white">Yeni Randevu Oluştur</h2>
          <button onClick={onClose} className="text-[#6b7280] hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">

          {/* Müşteri */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[11px] font-semibold text-[#9ca3af] uppercase tracking-wider">Müşteri</label>
              <div className="flex gap-1 text-[11px]">
                {(["search", "new", "manual"] as CustomerMode[]).map((m) => {
                  const labels = { search: "Ara", new: "Yeni", manual: "Manuel" };
                  return (
                    <button key={m} type="button"
                      onClick={() => { setCustomerMode(m); clearCustomer(); }}
                      className={`px-2 py-0.5 rounded border transition-all ${
                        customerMode === m
                          ? "bg-[#c9762c]/15 border-[#c9762c]/40 text-[#c9762c]"
                          : "border-[#2a2a2a] text-[#6b7280] hover:text-[#7a7a7a]"
                      }`}>
                      {labels[m]}
                    </button>
                  );
                })}
              </div>
            </div>

            {customerMode === "search" && (
              <div className="relative" ref={dropdownRef}>
                {selectedCustomer ? (
                  <div className="flex items-center justify-between bg-[#1a1a1a] border border-[#c9762c]/30 rounded-md px-3 py-2.5">
                    <div>
                      <span className="text-[13px] font-semibold text-white">{selectedCustomer.fullName}</span>
                      <span className="text-[12px] text-[#9ca3af] ml-2">{selectedCustomer.phone}</span>
                    </div>
                    <button type="button" onClick={clearCustomer} className="text-[#6b7280] hover:text-[#9ca3af]">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="relative">
                      <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                        onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
                        placeholder="Ad veya telefon ile ara..."
                        className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-md pl-9 pr-3 py-2 text-[13px] text-white placeholder-[#5a5a5a] focus:outline-none focus:border-[#c9762c]/50" />
                      <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#6b7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                      {searching && <div className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 border border-[#5a5a5a] border-t-transparent rounded-full animate-spin" />}
                    </div>
                    {showDropdown && searchResults.length > 0 && (
                      <div className="absolute z-10 mt-1 w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-md shadow-xl overflow-hidden">
                        {searchResults.map((c) => (
                          <button key={c.id} type="button" onClick={() => { setSelectedCustomer(c); setShowDropdown(false); setSearchQuery(""); }}
                            className="w-full text-left px-4 py-2.5 hover:bg-[#252525] transition-colors border-b border-[#222] last:border-0">
                            <span className="text-[13px] text-white font-medium">{c.fullName}</span>
                            <span className="text-[11px] text-[#9ca3af] ml-2">{c.phone}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {noResults && (
                      <div className="mt-2 p-3 bg-[#1a1a1a] border border-[#2a2a2a] rounded-md">
                        <p className="text-[12px] text-[#9ca3af] mb-2">"{searchQuery}" bulunamadı.</p>
                        <button type="button" onClick={() => { setCustomerMode("new"); setNewName(searchQuery); }}
                          className="text-[12px] text-[#c9762c] hover:underline">
                          + Yeni müşteri olarak oluştur
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {customerMode === "new" && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Ad Soyad *"
                    className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-md px-3 py-2 text-[13px] text-white placeholder-[#5a5a5a] focus:outline-none focus:border-[#c9762c]/50" />
                  <input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="5551828629 *"
                    className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-md px-3 py-2 text-[13px] text-white placeholder-[#5a5a5a] focus:outline-none focus:border-[#c9762c]/50" />
                </div>
                <p className="text-[11px] text-[#6b7280]">Aynı telefon varsa mevcut müşteriye bağlanır.</p>
              </div>
            )}

            {customerMode === "manual" && (
              <div className="grid grid-cols-2 gap-2">
                <input value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder="Ad Soyad *"
                  className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-md px-3 py-2 text-[13px] text-white placeholder-[#5a5a5a] focus:outline-none focus:border-[#c9762c]/50" />
                <input value={manualPhone} onChange={(e) => setManualPhone(e.target.value)} placeholder="5551828629 *"
                  className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-md px-3 py-2 text-[13px] text-white placeholder-[#5a5a5a] focus:outline-none focus:border-[#c9762c]/50" />
              </div>
            )}
          </div>

          {/* Çalışan */}
          <div>
            <label className="block text-[11px] font-semibold text-[#9ca3af] uppercase tracking-wider mb-1.5">Çalışan *</label>
            <select value={barberId} onChange={(e) => setBarberId(e.target.value)}
              className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-md px-3 py-2 text-[13px] text-white focus:outline-none focus:border-[#c9762c]/50">
              {barbers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>

          {/* Hizmetler */}
          <div>
            <label className="block text-[11px] font-semibold text-[#9ca3af] uppercase tracking-wider mb-1.5">Hizmetler *</label>
            <ServicePicker
              services={services}
              selected={selectedItems}
              onChange={setSelectedItems}
              editablePrices={false}
            />
          </div>

          {/* Tarih + Saat */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-1">
              <label className="block text-[11px] font-semibold text-[#9ca3af] uppercase tracking-wider mb-1.5">Tarih *</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-md px-3 py-2 text-[13px] text-white focus:outline-none focus:border-[#c9762c]/50" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-[#9ca3af] uppercase tracking-wider mb-1.5">Başlangıç *</label>
              <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)}
                className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-md px-3 py-2 text-[13px] text-white focus:outline-none focus:border-[#c9762c]/50" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-[#9ca3af] uppercase tracking-wider mb-1.5">Bitiş</label>
              <div className="w-full bg-[#111] border border-[#1a1a1a] rounded-md px-3 py-2 text-[13px] text-[#9ca3af]">
                {endTime || "—"}
              </div>
            </div>
          </div>

          {/* Özet */}
          {selectedItems.length > 0 && (
            <div className="flex items-center gap-4 bg-[#1a1a1a] border border-[#2a2a2a] rounded-md px-4 py-2.5 text-[12px] text-[#9ca3af]">
              <span>Süre: <span className="text-white">{totalDuration} dk</span></span>
              <span>Toplam: <span className="text-[#c9762c] font-bold">{totalPrice} ₺</span></span>
              <span className="ml-auto text-green-400/60">✓ Onaylı randevu olarak oluşturulacak</span>
            </div>
          )}

          {/* Not */}
          <div>
            <label className="block text-[11px] font-semibold text-[#9ca3af] uppercase tracking-wider mb-1.5">Not</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
              className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-md px-3 py-2 text-[13px] text-white placeholder-[#5a5a5a] focus:outline-none focus:border-[#c9762c]/50 resize-none"
              placeholder="İsteğe bağlı not..." />
          </div>

          {error && <p className="text-red-400 text-xs">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 border border-[#2a2a2a] rounded-md text-[13px] text-[#9ca3af] hover:text-white hover:border-[#3a3a3a] transition-all">
              İptal
            </button>
            <button type="submit" disabled={loading}
              className="flex-1 py-2.5 bg-[#c9762c] hover:bg-[#e8913a] rounded-md text-[13px] font-bold text-white transition-all disabled:opacity-50">
              {loading ? "Kaydediliyor..." : "Randevu Oluştur"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
