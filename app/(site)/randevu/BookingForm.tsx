"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { Barber } from "@/app/generated/prisma/client";
import { formatPrice } from "@/lib/utils";
import ServicePicker, { type PickerService, type SelectedItem } from "@/components/admin/ServicePicker";

type Step = 1 | 2 | 3;

interface BookingFormProps {
  services: PickerService[];
  barbers: Barber[];
  defaultBarberId?: string;
}

export default function BookingForm({ services, barbers, defaultBarberId }: BookingFormProps) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [direction, setDirection] = useState(1);
  const [loading, setLoading] = useState(false);
  const reduced = useReducedMotion();
  const [error, setError] = useState("");
  const [slots, setSlots] = useState<string[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);

  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([]);
  const [form, setForm] = useState({
    barberId: defaultBarberId ?? "",
    date: "",
    startTime: "",
    customerName: "",
    customerPhone: "",
    customerEmail: "",
    notes: "",
    website: "", // honeypot
  });

  const totalDuration = selectedItems.reduce((s, i) => s + i.durationMinutes, 0);
  const totalPrice = selectedItems.reduce((s, i) => s + i.price, 0);
  const selectedBarber = barbers.find((b) => b.id === form.barberId);

  async function fetchSlots(barberId: string, date: string, serviceIds: string[]) {
    if (!barberId || !date || serviceIds.length === 0) return;
    setSlotsLoading(true);
    const idsParam = serviceIds.join(",");
    const res = await fetch(`/api/availability?barberId=${barberId}&date=${date}&serviceIds=${idsParam}`);
    const data = await res.json();
    setSlots(data.slots ?? []);
    setSlotsLoading(false);
  }

  function handleStep1Next() {
    if (selectedItems.length === 0 || !form.barberId) { setError("Lütfen en az bir hizmet ve çalışan seçin."); return; }
    setError("");
    setDirection(1);
    setStep(2);
  }

  function handleStep2Next() {
    if (!form.date || !form.startTime) { setError("Lütfen tarih ve saat seçin."); return; }
    setError("");
    setDirection(1);
    setStep(3);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.customerName || !form.customerPhone) { setError("Ad soyad ve telefon zorunludur."); return; }
    if (!form.customerEmail) { setError("Randevu doğrulama için e-posta adresi zorunludur."); return; }
    setLoading(true);
    setError("");
    const res = await fetch("/api/appointments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serviceIds: selectedItems.map((i) => i.serviceId),
        totalDuration,
        ...form,
      }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? "Bir hata oluştu."); setLoading(false); return; }
    router.push(`/randevu/onay?id=${data.id}`);
  }

  const stepTitles = ["Hizmet & Çalışan", "Tarih & Saat", "Bilgileriniz"];

  const summaryProps = { selectedItems, barber: selectedBarber, date: form.date, time: form.startTime, step };

  return (
    <div className="flex flex-col lg:flex-row gap-5 items-start">

      {/* ─── Sol: Form ─── */}
      <div className="w-full lg:flex-1 min-w-0">

        {/* Mobil özet — formun üstünde */}
        <div className="lg:hidden mb-4">
          <MobileSummary {...summaryProps} />
        </div>

        <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl overflow-hidden">
          {/* Adım göstergesi */}
          <div className="flex border-b border-[#1e1e1e]">
            {[1, 2, 3].map((s) => (
              <div
                key={s}
                className={`flex-1 py-4 text-center text-sm font-semibold transition-colors ${
                  step === s
                    ? "text-[#c9762c] border-b-2 border-[#c9762c]"
                    : step > s
                    ? "text-[#5a5a5a]"
                    : "text-[#2a2a2a]"
                }`}
              >
                <span
                  className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-xs mr-2 ${
                    step === s ? "bg-[#c9762c] text-white" : step > s ? "bg-[#c9762c]/20 text-[#c9762c]" : "bg-[#1e1e1e] text-[#3a3a3a]"
                  }`}
                >
                  {step > s ? (
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : s}
                </span>
                <span className="hidden sm:inline">{stepTitles[s - 1]}</span>
              </div>
            ))}
          </div>

          <div className="p-6 md:p-8">
            {error && (
              <div className="mb-5 flex items-start gap-2.5 p-3.5 bg-red-500/8 border border-red-500/20 text-red-400 rounded-lg text-sm">
                <svg className="w-4 h-4 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {error}
              </div>
            )}

            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={step}
                initial={{ opacity: 0, x: direction * 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: direction * -16 }}
                transition={{ duration: reduced ? 0 : 0.22, ease: [0.21, 0.47, 0.32, 0.98] }}
              >

            {/* ── Adım 1: Hizmet & Çalışan ── */}
            {step === 1 && (
              <div className="space-y-7">
                <div>
                  <SectionLabel>Hizmet Seçin (birden fazla seçebilirsiniz)</SectionLabel>
                  <ServicePicker
                    services={services}
                    selected={selectedItems}
                    onChange={(items) => {
                      setSelectedItems(items);
                      if (form.date) fetchSlots(form.barberId, form.date, items.map((i) => i.serviceId));
                    }}
                    editablePrices={false}
                  />
                </div>

                <div>
                  <SectionLabel>Çalışan Seçin</SectionLabel>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {barbers.map((b) => {
                      const initials = b.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
                      return (
                        <button
                          key={b.id}
                          type="button"
                          onClick={() => setForm({ ...form, barberId: b.id })}
                          className={`flex items-center gap-3.5 p-4 rounded-lg border transition-all text-left ${
                            form.barberId === b.id
                              ? "border-[#c9762c] bg-[#c9762c]/8 shadow-[0_0_15px_rgba(201,118,44,0.08)]"
                              : "border-[#2a2a2a] hover:border-[#c9762c]/35 bg-[#111]"
                          }`}
                        >
                          <div className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                            form.barberId === b.id
                              ? "bg-[#c9762c]/15 border border-[#c9762c]/30"
                              : "bg-[#1e1e1e] border border-[#2a2a2a]"
                          }`}>
                            {b.photoUrl ? (
                              <img src={b.photoUrl} className="w-11 h-11 rounded-full object-cover" alt={b.name} />
                            ) : (
                              <span className={`text-sm font-black ${form.barberId === b.id ? "text-[#c9762c]" : "text-[#5a5a5a]"}`}>
                                {initials}
                              </span>
                            )}
                          </div>
                          <div>
                            <div className="font-semibold text-white text-sm">{b.name}</div>
                            {b.specialty && <div className="text-[#c9762c] text-xs mt-0.5">{b.specialty}</div>}
                            {b.experienceYrs > 0 && <div className="text-[#5a5a5a] text-[11px] mt-0.5">{b.experienceYrs} yıl deneyim</div>}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <button
                  onClick={handleStep1Next}
                  className="w-full py-3.5 bg-[#c9762c] hover:bg-[#e8913a] text-white font-bold rounded-lg transition-all hover:shadow-[0_0_25px_rgba(201,118,44,0.25)] text-sm"
                >
                  Devam Et →
                </button>
              </div>
            )}

            {/* ── Adım 2: Tarih & Saat ── */}
            {step === 2 && (
              <div className="space-y-6">
                <div>
                  <SectionLabel>Tarih Seçin</SectionLabel>
                  <input
                    type="date"
                    min={new Date().toISOString().split("T")[0]}
                    value={form.date}
                    onChange={(e) => {
                      const d = e.target.value;
                      setForm({ ...form, date: d, startTime: "" });
                      if (d) fetchSlots(form.barberId, d, selectedItems.map((i) => i.serviceId));
                    }}
                    className="w-full bg-[#111] border border-[#2a2a2a] focus:border-[#c9762c] rounded-lg px-4 py-3 text-white outline-none transition-colors"
                  />
                </div>

                {form.date && (
                  <div>
                    <SectionLabel>Müsait Saatler</SectionLabel>
                    {slotsLoading ? (
                      <div className="flex items-center gap-2 text-[#5a5a5a] text-sm py-4">
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                        </svg>
                        Yükleniyor...
                      </div>
                    ) : slots.length === 0 ? (
                      <div className="flex items-center gap-3 p-4 border border-[#2a2a2a] rounded-lg text-[#5a5a5a] text-sm bg-[#111]">
                        <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Bu tarihte müsait saat bulunmuyor.
                      </div>
                    ) : (
                      <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                        {slots.map((slot) => (
                          <button
                            key={slot}
                            type="button"
                            onClick={() => setForm({ ...form, startTime: slot })}
                            className={`py-2.5 rounded-lg text-sm font-semibold transition-all ${
                              form.startTime === slot
                                ? "bg-[#c9762c] text-white shadow-[0_0_12px_rgba(201,118,44,0.3)]"
                                : "bg-[#111] text-[#9ca3af] hover:bg-[#1e1e1e] hover:text-white border border-[#1e1e1e]"
                            }`}
                          >
                            {slot}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex gap-3">
                  <button
                    onClick={() => { setDirection(-1); setStep(1); setError(""); }}
                    className="flex-1 py-3.5 border border-[#2a2a2a] hover:border-[#c9762c]/35 text-[#9ca3af] font-semibold rounded-lg transition-colors text-sm"
                  >
                    ← Geri
                  </button>
                  <button
                    onClick={handleStep2Next}
                    className="flex-1 py-3.5 bg-[#c9762c] hover:bg-[#e8913a] text-white font-bold rounded-lg transition-all hover:shadow-[0_0_25px_rgba(201,118,44,0.25)] text-sm"
                  >
                    Devam Et →
                  </button>
                </div>
              </div>
            )}

            {/* ── Adım 3: Bilgiler ── */}
            {step === 3 && (
              <form onSubmit={handleSubmit} className="space-y-5">
                <Field label="Ad Soyad *" value={form.customerName} onChange={(v) => setForm({ ...form, customerName: v })} placeholder="Ahmet Yılmaz" />
                <Field label="Telefon *" value={form.customerPhone} onChange={(v) => setForm({ ...form, customerPhone: v })} placeholder="05xx xxx xx xx" type="tel" />
                <Field label="E-posta * (doğrulama için)" value={form.customerEmail} onChange={(v) => setForm({ ...form, customerEmail: v })} placeholder="ahmet@ornek.com" type="email" />
                {/* Honeypot — botlar doldurur, insanlar görmez */}
                <input
                  name="website"
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  value={form.website ?? ""}
                  onChange={(e) => setForm({ ...form, website: e.target.value })}
                  style={{ position: "absolute", left: "-9999px", width: "1px", height: "1px", opacity: 0 }}
                  aria-hidden="true"
                />
                <div>
                  <label className="block text-xs font-semibold text-[#5a5a5a] mb-2 uppercase tracking-[0.2em]">Not (opsiyonel)</label>
                  <textarea
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    rows={2}
                    className="w-full bg-[#111] border border-[#2a2a2a] focus:border-[#c9762c] rounded-lg px-4 py-3 text-white placeholder-[#4b5563] outline-none resize-none transition-colors text-sm"
                    placeholder="Özel istekleriniz..."
                  />
                </div>

                <div className="flex gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => { setDirection(-1); setStep(2); setError(""); }}
                    className="flex-1 py-3.5 border border-[#2a2a2a] hover:border-[#c9762c]/35 text-[#9ca3af] font-semibold rounded-lg transition-colors text-sm"
                  >
                    ← Geri
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="flex-1 py-3.5 bg-[#c9762c] hover:bg-[#e8913a] disabled:opacity-50 text-white font-bold rounded-lg transition-all hover:shadow-[0_0_25px_rgba(201,118,44,0.25)] text-sm"
                  >
                    {loading ? (
                      <span className="flex items-center justify-center gap-2">
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                        </svg>
                        Gönderiliyor...
                      </span>
                    ) : "Randevuyu Onayla"}
                  </button>
                </div>
              </form>
            )}

              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* ─── Sağ: Desktop özet sidebar ─── */}
      <div className="hidden lg:block w-[280px] xl:w-[300px] shrink-0 sticky top-8">
        <DesktopSummary {...summaryProps} />
      </div>
    </div>
  );
}

// ── Özet bileşenleri ─────────────────────────────────────────────────────────

interface SummaryProps {
  selectedItems: SelectedItem[];
  barber?: Barber;
  date?: string;
  time?: string;
  step: Step;
}

function DesktopSummary({ selectedItems, barber, date, time, step }: SummaryProps) {
  const initials = barber?.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const hasDate = !!date;
  const hasTime = !!time;
  const allSelected = selectedItems.length > 0 && !!barber && hasDate && hasTime;
  const totalDur = selectedItems.reduce((s, i) => s + i.durationMinutes, 0);
  const totalPrice = selectedItems.reduce((s, i) => s + i.price, 0);

  return (
    <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-[#1e1e1e] flex items-center justify-between">
        <h3 className="text-xs font-bold text-[#5a5a5a] uppercase tracking-[0.2em]">Randevu Özeti</h3>
        {allSelected && (
          <div className="w-5 h-5 rounded-full bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center">
            <svg className="w-3 h-3 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        )}
      </div>

      <div className="p-5 space-y-4">
        {/* Hizmetler */}
        <div className="flex items-start gap-3">
          <svg className="w-4 h-4 shrink-0 mt-0.5 text-[#3a3a3a]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-[#5a5a5a] text-[10px] uppercase tracking-wider">Hizmet</p>
            {selectedItems.length === 0 ? (
              <p className="text-[#3a3a3a] text-sm font-semibold mt-0.5">—</p>
            ) : (
              <div className="mt-0.5 space-y-0.5">
                {selectedItems.map((item, i) => (
                  <p key={i} className="text-white text-sm font-semibold truncate">{item.serviceName}</p>
                ))}
              </div>
            )}
            {selectedItems.length > 0 && <p className="text-[#5a5a5a] text-[11px] mt-1">{totalDur} dakika</p>}
          </div>
        </div>

        {/* Berber */}
        <div className="flex items-start gap-3">
          <div className="w-4 h-4 shrink-0 mt-0.5 flex items-center justify-center">
            {barber ? (
              <div className="w-6 h-6 rounded-full bg-[#c9762c]/15 border border-[#c9762c]/20 flex items-center justify-center -mt-1 -ml-1">
                <span className="text-[#c9762c] text-[8px] font-black">{initials}</span>
              </div>
            ) : (
              <svg className="w-4 h-4 text-[#3a3a3a]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            )}
          </div>
          <div>
            <p className="text-[#5a5a5a] text-[10px] uppercase tracking-wider">Çalışan</p>
            <p className={`text-sm font-semibold mt-0.5 ${barber ? "text-white" : "text-[#3a3a3a]"}`}>
              {barber?.name ?? "—"}
            </p>
            {barber?.specialty && <p className="text-[#c9762c] text-[10px] mt-0.5">{barber.specialty}</p>}
          </div>
        </div>

        {/* Tarih */}
        <SummaryItem
          icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />}
          label="Tarih"
          value={date ? new Date(date).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" }) : undefined}
        />

        {/* Saat */}
        <SummaryItem
          icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />}
          label="Saat"
          value={time}
          accent={hasTime}
        />

        {/* Toplam */}
        {selectedItems.length > 0 && (
          <div className="pt-4 mt-2 border-t border-[#1e1e1e] space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="text-[#5a5a5a]">Süre</span>
              <span className="text-[#9ca3af]">{totalDur} dakika</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-[#5a5a5a] text-xs">Toplam Tutar</span>
              <span className="text-[#c9762c] font-black text-2xl leading-none">{formatPrice(totalPrice)}</span>
            </div>
          </div>
        )}

        {/* Adım ilerleme */}
        <div className="pt-3 border-t border-[#1a1a1a]">
          <div className="flex gap-1.5 mb-2">
            {[1, 2, 3].map((s) => (
              <div
                key={s}
                className={`flex-1 h-0.5 rounded-full transition-all duration-300 ${
                  step > s ? "bg-[#c9762c]" : step === s ? "bg-[#c9762c]/40" : "bg-[#1e1e1e]"
                }`}
              />
            ))}
          </div>
          <p className="text-[#4a4a4a] text-[10px] text-center">
            {step === 1 && "Adım 1/3 — Hizmet ve çalışan"}
            {step === 2 && "Adım 2/3 — Tarih ve saat"}
            {step === 3 && "Adım 3/3 — Bilgileriniz"}
          </p>
        </div>
      </div>
    </div>
  );
}

function MobileSummary({ selectedItems, barber, date, time }: SummaryProps) {
  if (selectedItems.length === 0 && !barber && !date && !time) return null;

  const initials = barber?.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const totalPrice = selectedItems.reduce((s, i) => s + i.price, 0);

  return (
    <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-4">
      <p className="text-[10px] font-bold text-[#5a5a5a] uppercase tracking-[0.2em] mb-3">Seçimleriniz</p>
      <div className="flex flex-wrap gap-2">
        {selectedItems.map((item, i) => (
          <MobileChip key={i}
            icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />}
            label={item.serviceName}
          />
        ))}
        {selectedItems.length > 0 && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[#c9762c]/10 border border-[#c9762c]/20 rounded-lg">
            <span className="text-[#c9762c] text-xs font-black">{formatPrice(totalPrice)}</span>
          </div>
        )}
        {barber && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[#111] border border-[#2a2a2a] rounded-lg">
            <div className="w-5 h-5 rounded-full bg-[#c9762c]/15 border border-[#c9762c]/20 flex items-center justify-center shrink-0">
              <span className="text-[#c9762c] text-[8px] font-black">{initials}</span>
            </div>
            <span className="text-white text-xs font-semibold">{barber.name}</span>
          </div>
        )}
        {date && (
          <MobileChip
            icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />}
            label={new Date(date).toLocaleDateString("tr-TR", { day: "numeric", month: "short" })}
          />
        )}
        {time && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[#c9762c]/10 border border-[#c9762c]/20 rounded-lg">
            <svg className="w-3 h-3 text-[#c9762c] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-[#c9762c] text-xs font-black">{time}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Yardımcı bileşenler ───────────────────────────────────────────────────────

function SummaryItem({ icon, label, value, sub, accent }: {
  icon: React.ReactNode; label: string; value?: string; sub?: string; accent?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <svg className="w-4 h-4 shrink-0 mt-0.5 text-[#3a3a3a]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        {icon}
      </svg>
      <div>
        <p className="text-[#5a5a5a] text-[10px] uppercase tracking-wider">{label}</p>
        <p className={`text-sm font-semibold mt-0.5 ${value ? (accent ? "text-[#c9762c]" : "text-white") : "text-[#3a3a3a]"}`}>
          {value ?? "—"}
        </p>
        {sub && <p className="text-[#5a5a5a] text-[11px] mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function MobileChip({ icon, label, sub }: { icon: React.ReactNode; label: string; sub?: string }) {
  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[#111] border border-[#2a2a2a] rounded-lg">
      <svg className="w-3 h-3 text-[#5a5a5a] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        {icon}
      </svg>
      <span className="text-white text-xs font-semibold">{label}</span>
      {sub && <span className="text-[#c9762c] text-xs font-bold">{sub}</span>}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-xs font-bold text-[#5a5a5a] mb-3 uppercase tracking-[0.2em]">{children}</label>
  );
}

function Field({ label, value, onChange, placeholder, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string; type?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-bold text-[#5a5a5a] mb-2 uppercase tracking-[0.2em]">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-[#111] border border-[#2a2a2a] focus:border-[#c9762c] rounded-lg px-4 py-3 text-white placeholder-[#4b5563] outline-none transition-colors text-sm"
      />
    </div>
  );
}
