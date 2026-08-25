"use client";
import { useState } from "react";

type Props = {
  barberId: string;
  barberName: string;
  /** Tüm zamanlar kalan hakediş — ödenebilecek üst sınır. */
  remaining: number;
  /** Rapor aralığı (YYYY-AA-GG) — dönem alanlarına varsayılan olarak konur. */
  defaultPeriodStart: string;
  defaultPeriodEnd: string;
  onClose: () => void;
  onSaved: () => void;
};

const METHOD_LABELS: Record<string, string> = {
  CASH: "Nakit", CARD: "Kart", TRANSFER: "Havale/EFT", OTHER: "Diğer",
};

export default function PayoutModal({
  barberId, barberName, remaining, defaultPeriodStart, defaultPeriodEnd, onClose, onSaved,
}: Props) {
  const [amount, setAmount] = useState(remaining > 0 ? remaining : 0);
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const [periodStart, setPeriodStart] = useState(defaultPeriodStart);
  const [periodEnd, setPeriodEnd] = useState(defaultPeriodEnd);
  const [note, setNote] = useState("");

  /**
   * Idempotency anahtari — modal ACILDIGINDA bir kez uretilir, her tiklamada
   * degil. Cift tiklama ayni anahtari gonderir ve sunucu tek kayit olusturur;
   * kullanici modali kapatip yeniden actiginda yeni anahtar uretilir ve
   * gercek ikinci bir odeme serbestce girilebilir (FAZ 2 · Sira 9b).
   *
   * `useState(() => ...)` bilerek kullanildi: deger ilk render'da bir kez
   * hesaplanir ve sonraki render'larda degismez.
   */
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (amount <= 0) { setError("Tutar 0'dan büyük olmalıdır."); return; }
    if (periodStart > periodEnd) { setError("Dönem başlangıcı bitişinden sonra olamaz."); return; }
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/payouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ barberId, amount, paymentMethod, periodStart, periodEnd, note: note || null, idempotencyKey }),
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
      <div className="relative bg-[#0f0f0f] border border-[#1e1e1e] rounded-xl w-full max-w-sm shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1e1e1e]">
          <div>
            <h2 className="text-sm font-bold text-white">Hakediş Ödemesi</h2>
            <p className="text-[11px] text-[#9ca3af] mt-0.5">{barberName}</p>
          </div>
          <button onClick={onClose} className="text-[#6b7280] hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div className="bg-[#1a1a1a] rounded-lg px-4 py-3">
            <p className="text-[11px] text-[#9ca3af] uppercase tracking-wider">Kalan Hakediş (Toplam)</p>
            <p className="text-xl font-black text-[#c9762c] mt-0.5">{remaining.toFixed(2)} ₺</p>
            <p className="text-[10px] text-[#6b7280] mt-1">Bu tutarın üstünde ödeme kabul edilmez.</p>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[#9ca3af] uppercase tracking-wider mb-1.5">Ödenen Tutar ₺</label>
            <input type="number" min="0.01" step="0.01" value={amount}
              onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
              className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-md px-3 py-2 text-[13px] text-white focus:outline-none focus:border-[#c9762c]/50" />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[#9ca3af] uppercase tracking-wider mb-1.5">Hangi Döneme Ait</label>
            <div className="flex items-center gap-2">
              <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} required
                className="flex-1 bg-[#1a1a1a] border border-[#2a2a2a] rounded-md px-3 py-2 text-[12px] text-white focus:outline-none focus:border-[#c9762c]/50" />
              <span className="text-[#6b7280] text-xs">—</span>
              <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} required
                className="flex-1 bg-[#1a1a1a] border border-[#2a2a2a] rounded-md px-3 py-2 text-[12px] text-white focus:outline-none focus:border-[#c9762c]/50" />
            </div>
            <p className="text-[10px] text-[#6b7280] mt-1">
              Geçmiş dönem seçilebilir. Ödeme tarihi ise daima bugündür; sistem otomatik yazar.
            </p>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[#9ca3af] uppercase tracking-wider mb-1.5">Ödeme Yöntemi</label>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(METHOD_LABELS).map(([val, label]) => (
                <button key={val} type="button" onClick={() => setPaymentMethod(val)}
                  className={`py-2 rounded-md text-[12px] font-medium border transition-all ${
                    paymentMethod === val
                      ? "bg-[#c9762c] border-[#c9762c] text-white"
                      : "bg-[#1a1a1a] border-[#2a2a2a] text-[#9ca3af] hover:border-[#3a3a3a]"
                  }`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[#9ca3af] uppercase tracking-wider mb-1.5">Not</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500}
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
              {loading ? "Kaydediliyor..." : "Ödemeyi Kaydet"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
