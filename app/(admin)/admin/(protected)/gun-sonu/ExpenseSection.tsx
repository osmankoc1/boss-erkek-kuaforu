"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Expense = { id: string; amount: number; category: string; description: string | null; expenseDate: string };

const CATEGORIES = ["Kira", "Elektrik", "Su", "Doğalgaz", "Malzeme", "Temizlik", "Gıda", "Ulaşım", "Reklam", "Diğer"];

export default function ExpenseSection({ initialExpenses, selectedDate }: {
  initialExpenses: Expense[];
  selectedDate: string;
}) {
  const router = useRouter();
  const [expenses, setExpenses] = useState(initialExpenses);
  const [showForm, setShowForm] = useState(false);
  const [amount, setAmount] = useState(0);
  const [category, setCategory] = useState("Malzeme");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (amount <= 0) { setError("Tutar gerekli."); return; }
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, category, description: description || null, expenseDate: selectedDate }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Hata."); return; }
      setExpenses((prev) => [{ ...data.expense, expenseDate: data.expense.expenseDate }, ...prev]);
      setShowForm(false); setAmount(0); setDescription("");
      router.refresh();
    } catch { setError("Bağlantı hatası."); }
    finally { setLoading(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm("Gideri silmek istiyor musunuz?")) return;
    await fetch(`/api/expenses/${id}`, { method: "DELETE" });
    setExpenses((prev) => prev.filter((e) => e.id !== id));
    router.refresh();
  }

  const total = expenses.reduce((s, e) => s + e.amount, 0);

  return (
    <div className="bg-[#0f0f0f] border border-[#1e1e1e] rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-bold text-white">Giderler</h3>
          <p className="text-[11px] text-[#9ca3af] mt-0.5">Toplam: <span className="text-red-400 font-bold">{total.toFixed(2)} ₺</span></p>
        </div>
        <button onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1a1a1a] border border-[#2a2a2a] hover:border-[#c9762c]/40 rounded-md text-[12px] text-[#9ca3af] hover:text-white transition-all">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Gider Ekle
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleAdd} className="bg-[#1a1a1a] rounded-lg p-4 mb-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-[#9ca3af] uppercase tracking-wider mb-1">Tutar ₺</label>
              <input type="number" min="0.01" step="0.01" value={amount}
                onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
                className="w-full bg-[#111] border border-[#2a2a2a] rounded-md px-3 py-2 text-[13px] text-white focus:outline-none focus:border-[#c9762c]/50" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-[#9ca3af] uppercase tracking-wider mb-1">Kategori</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)}
                className="w-full bg-[#111] border border-[#2a2a2a] rounded-md px-3 py-2 text-[13px] text-white focus:outline-none focus:border-[#c9762c]/50">
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-[#9ca3af] uppercase tracking-wider mb-1">Açıklama</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-[#111] border border-[#2a2a2a] rounded-md px-3 py-2 text-[13px] text-white placeholder-[#5a5a5a] focus:outline-none focus:border-[#c9762c]/50"
              placeholder="İsteğe bağlı..." />
          </div>
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowForm(false)}
              className="px-3 py-1.5 border border-[#2a2a2a] rounded text-[12px] text-[#9ca3af] hover:text-white transition-all">İptal</button>
            <button type="submit" disabled={loading}
              className="px-4 py-1.5 bg-[#c9762c] hover:bg-[#e8913a] rounded text-[12px] font-bold text-white transition-all disabled:opacity-50">
              {loading ? "..." : "Ekle"}
            </button>
          </div>
        </form>
      )}

      {expenses.length === 0 ? (
        <p className="text-[12px] text-[#6b7280] text-center py-4">Bu gün için gider kaydı yok.</p>
      ) : (
        <div className="space-y-2">
          {expenses.map((e) => (
            <div key={e.id} className="flex items-center justify-between bg-[#1a1a1a] rounded-lg px-4 py-2.5">
              <div>
                <span className="text-[12px] font-semibold text-[#9ca3af]">{e.category}</span>
                {e.description && <span className="text-[11px] text-[#6b7280] ml-2">— {e.description}</span>}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[13px] font-bold text-red-400">{e.amount.toFixed(2)} ₺</span>
                <button onClick={() => handleDelete(e.id)} className="text-[#6b7280] hover:text-red-400 transition-colors">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
