"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type ServiceItem = {
  serviceId?: string | null;
  serviceName: string;
  category: string;
  price: number;
  durationMinutes: number;
};

type ApptData = {
  barberId: string;
  barberName: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  // Multi-service (preferred)
  services?: ServiceItem[];
  // Legacy fallback
  serviceId?: string;
  serviceName?: string;
  appointmentPrice?: number;
};

const METHOD_LABELS: Record<string, string> = {
  CASH: "Nakit", CARD: "Kart", TRANSFER: "Havale/EFT", OTHER: "Diğer",
};

function KasaModal({ apptId, appt, onClose, onSaved }: {
  apptId: string;
  appt: ApptData;
  onClose: () => void;
  onSaved: () => void;
}) {
  // Resolve items — prefer multi-service, fall back to legacy
  const initialItems: ServiceItem[] = appt.services && appt.services.length > 0
    ? appt.services
    : appt.serviceName
      ? [{ serviceId: appt.serviceId ?? null, serviceName: appt.serviceName, category: "Diğer", price: appt.appointmentPrice ?? 0, durationMinutes: 0 }]
      : [];

  const [items, setItems] = useState<ServiceItem[]>(initialItems);
  const totalFromItems = items.reduce((s, i) => s + i.price, 0);
  const [saleAmount, setSaleAmount] = useState(totalFromItems);
  const [paidAmount, setPaidAmount] = useState(totalFromItems);
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [priceManuallySet, setPriceManuallySet] = useState(false);

  function updateItemPrice(idx: number, price: number) {
    const updated = items.map((item, i) => i === idx ? { ...item, price } : item);
    setItems(updated);
    if (!priceManuallySet) {
      const total = updated.reduce((s, i) => s + i.price, 0);
      setSaleAmount(total);
      setPaidAmount(total);
    }
  }

  const displayTitle = items.map((i) => i.serviceName).join(", ") || appt.serviceName || "Hizmet";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/cash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appointmentId: apptId,
          barberId: appt.barberId,
          customerId: appt.customerId,
          customerName: appt.customerName,
          customerPhone: appt.customerPhone,
          items: items.map((i) => ({
            serviceId: i.serviceId ?? null,
            serviceName: i.serviceName,
            category: i.category,
            price: i.price,
            durationMinutes: i.durationMinutes,
          })),
          saleAmount,
          paidAmount,
          paymentMethod,
          note: note || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Hata oluştu."); return; }
      onSaved();
    } catch { setError("Bağlantı hatası."); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#0f0f0f] border border-[#1e1e1e] rounded-xl w-full max-w-md shadow-2xl overflow-y-auto max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1e1e1e]">
          <div>
            <h2 className="text-sm font-bold text-white">Kasa Kaydı Oluştur</h2>
            <p className="text-[11px] text-[#9ca3af] mt-0.5">{appt.customerName} — {displayTitle}</p>
          </div>
          <button onClick={onClose} className="text-[#6b7280] hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">

          {/* Hizmet fiyatları */}
          {items.length > 0 && (
            <div>
              <label className="block text-[11px] font-semibold text-[#9ca3af] uppercase tracking-wider mb-2">Hizmetler</label>
              <div className="space-y-2">
                {items.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between bg-[#1a1a1a] border border-[#2a2a2a] rounded-md px-3 py-2">
                    <div>
                      <span className="text-[13px] text-white font-medium">{item.serviceName}</span>
                      {item.durationMinutes > 0 && <span className="text-[11px] text-[#6b7280] ml-2">{item.durationMinutes} dk</span>}
                    </div>
                    <div className="flex items-center gap-1">
                      <input type="number" min="0" step="0.01" value={item.price}
                        onChange={(e) => updateItemPrice(idx, parseFloat(e.target.value) || 0)}
                        className="w-20 bg-[#111] border border-[#2a2a2a] rounded px-2 py-1 text-[13px] text-[#c9762c] font-bold text-right focus:outline-none focus:border-[#c9762c]/50" />
                      <span className="text-[12px] text-[#9ca3af]">₺</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tutarlar */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-[#9ca3af] uppercase tracking-wider mb-1.5">Satış ₺</label>
              <input type="number" min="0" step="0.01" value={saleAmount}
                onChange={(e) => { setPriceManuallySet(true); const v = parseFloat(e.target.value) || 0; setSaleAmount(v); if (paidAmount > v) setPaidAmount(v); }}
                className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-md px-3 py-2 text-[13px] text-white focus:outline-none focus:border-[#c9762c]/50" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-[#9ca3af] uppercase tracking-wider mb-1.5">Ödenen ₺</label>
              <input type="number" min="0" step="0.01" value={paidAmount}
                onChange={(e) => setPaidAmount(parseFloat(e.target.value) || 0)}
                className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-md px-3 py-2 text-[13px] text-white focus:outline-none focus:border-[#c9762c]/50" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-[#9ca3af] uppercase tracking-wider mb-1.5">Kalan ₺</label>
              <div className="w-full bg-[#111] border border-[#1a1a1a] rounded-md px-3 py-2 text-[13px] text-[#9ca3af]">
                {Math.max(0, saleAmount - paidAmount).toFixed(2)}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[#9ca3af] uppercase tracking-wider mb-1.5">Ödeme Yöntemi</label>
            <div className="grid grid-cols-4 gap-2">
              {Object.entries(METHOD_LABELS).map(([val, label]) => (
                <button key={val} type="button" onClick={() => setPaymentMethod(val)}
                  className={`py-1.5 rounded-md text-[11px] font-medium border transition-all ${
                    paymentMethod === val
                      ? "bg-[#c9762c] border-[#c9762c] text-white"
                      : "bg-[#1a1a1a] border-[#2a2a2a] text-[#9ca3af] hover:border-[#3a3a3a] hover:text-[#9ca3af]"
                  }`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[#9ca3af] uppercase tracking-wider mb-1.5">Not</label>
            <input value={note} onChange={(e) => setNote(e.target.value)}
              className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-md px-3 py-2 text-[13px] text-white placeholder-[#5a5a5a] focus:outline-none focus:border-[#c9762c]/50"
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
              {loading ? "Kaydediliyor..." : "Kaydet & Tamamla"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function AppointmentActions({
  id,
  status,
  appt,
}: {
  id: string;
  status: string;
  appt?: ApptData;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [showKasaModal, setShowKasaModal] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendMsg, setResendMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  async function updateStatus(newStatus: string) {
    setLoading(true);
    await fetch(`/api/appointments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    router.refresh();
    setLoading(false);
  }

  async function handleResend() {
    setResendLoading(true);
    setResendMsg(null);
    try {
      const res = await fetch(`/api/appointments/${id}/resend-verification`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setResendMsg({ type: "ok", text: "Mail gönderildi." });
      } else {
        setResendMsg({ type: "err", text: data.error ?? "Hata oluştu." });
      }
    } catch {
      setResendMsg({ type: "err", text: "Bağlantı hatası." });
    } finally {
      setResendLoading(false);
    }
  }

  async function handleComplete() {
    if (!appt) { updateStatus("completed"); return; }
    setLoading(true);
    const res = await fetch(`/api/cash?appointmentId=${id}`);
    const data = await res.json();
    setLoading(false);
    if ((data.sales ?? []).length > 0) {
      updateStatus("completed");
    } else {
      setShowKasaModal(true);
    }
  }

  if (loading) return <span className="text-xs text-[#6b7280]">...</span>;

  return (
    <>
      <div className="flex gap-2 flex-wrap">
        {/* E-posta doğrulama bekleniyor */}
        {status === "pending_verification" && (
          <>
            <button
              onClick={() => updateStatus("cancelled")}
              className="text-xs px-2 py-1 bg-red-500/10 text-red-400 border border-red-500/20 rounded hover:bg-red-500/20 transition-colors"
            >
              İptal
            </button>
            <button
              onClick={handleResend}
              disabled={resendLoading}
              className="inline-flex items-center gap-1 text-xs px-2 py-1 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded hover:bg-blue-500/20 transition-colors disabled:opacity-50"
            >
              {resendLoading ? (
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
              ) : (
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              )}
              {resendLoading ? "Gönderiliyor..." : "Tekrar Mail Gönder"}
            </button>
            {resendMsg && (
              <span className={`text-xs font-medium ${resendMsg.type === "ok" ? "text-green-400" : "text-red-400"}`}>
                {resendMsg.text}
              </span>
            )}
          </>
        )}
        {status === "pending" && (
          <button onClick={() => updateStatus("confirmed")} className="text-xs px-2 py-1 bg-green-500/10 text-green-400 border border-green-500/20 rounded hover:bg-green-500/20 transition-colors">
            Onayla
          </button>
        )}
        {(status === "pending" || status === "confirmed") && (
          <button onClick={() => updateStatus("cancelled")} className="text-xs px-2 py-1 bg-red-500/10 text-red-400 border border-red-500/20 rounded hover:bg-red-500/20 transition-colors">
            İptal
          </button>
        )}
        {status === "confirmed" && (
          <button onClick={handleComplete} className="text-xs px-2 py-1 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded hover:bg-blue-500/20 transition-colors">
            Tamamla
          </button>
        )}
      </div>

      {showKasaModal && appt && (
        <KasaModal
          apptId={id}
          appt={appt}
          onClose={() => setShowKasaModal(false)}
          onSaved={() => { setShowKasaModal(false); router.refresh(); }}
        />
      )}
    </>
  );
}
