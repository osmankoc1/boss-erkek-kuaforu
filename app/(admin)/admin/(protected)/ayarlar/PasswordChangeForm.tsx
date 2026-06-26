"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const RULES = [
  { label: "En az 8 karakter", test: (p: string) => p.length >= 8 },
  { label: "Büyük harf (A–Z)", test: (p: string) => /[A-Z]/.test(p) },
  { label: "Küçük harf (a–z)", test: (p: string) => /[a-z]/.test(p) },
  { label: "Rakam (0–9)", test: (p: string) => /[0-9]/.test(p) },
  { label: "Özel karakter (!@#$...)", test: (p: string) => /[^A-Za-z0-9]/.test(p) },
];

export default function PasswordChangeForm() {
  const router = useRouter();
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const allRulesPassed = RULES.every((r) => r.test(form.next));
  const confirmMatch = form.confirm === form.next;
  const canSubmit = form.current && form.next && form.confirm && allRulesPassed && confirmMatch && !loading;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!allRulesPassed) { setError("Yeni şifre kurallara uymuyor."); return; }
    if (!confirmMatch) { setError("Yeni şifreler eşleşmiyor."); return; }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: form.current,
          newPassword: form.next,
          confirmPassword: form.confirm,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Bir hata oluştu."); return; }
      setSuccess(true);
      setTimeout(() => router.push("/admin/login"), 2500);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-6">
      <h2 className="text-sm font-semibold text-[#9ca3af] uppercase tracking-wider mb-4">Hesabım</h2>

      {success ? (
        <div className="p-4 bg-green-500/10 border border-green-500/30 text-green-400 rounded-lg text-sm">
          Şifre başarıyla değiştirildi. Giriş sayfasına yönlendiriliyorsunuz...
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs text-[#9ca3af] mb-1 uppercase tracking-wider">
              Mevcut Şifre
            </label>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={form.current}
              onChange={(e) => setForm({ ...form, current: e.target.value })}
              className="w-full bg-[#1e1e1e] border border-[#2a2a2a] focus:border-[#c9762c] rounded-lg px-3 py-2 text-white outline-none text-sm"
            />
          </div>

          <div>
            <label className="block text-xs text-[#9ca3af] mb-1 uppercase tracking-wider">
              Yeni Şifre
            </label>
            <input
              type="password"
              required
              autoComplete="new-password"
              value={form.next}
              onChange={(e) => setForm({ ...form, next: e.target.value })}
              className="w-full bg-[#1e1e1e] border border-[#2a2a2a] focus:border-[#c9762c] rounded-lg px-3 py-2 text-white outline-none text-sm"
            />
            {form.next && (
              <ul className="mt-2 space-y-1">
                {RULES.map((r) => (
                  <li
                    key={r.label}
                    className={`text-xs flex items-center gap-1.5 transition-colors ${
                      r.test(form.next) ? "text-green-400" : "text-[#6b7280]"
                    }`}
                  >
                    <span className="font-mono">{r.test(form.next) ? "✓" : "○"}</span>
                    {r.label}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <label className="block text-xs text-[#9ca3af] mb-1 uppercase tracking-wider">
              Yeni Şifre Tekrar
            </label>
            <input
              type="password"
              required
              autoComplete="new-password"
              value={form.confirm}
              onChange={(e) => setForm({ ...form, confirm: e.target.value })}
              className="w-full bg-[#1e1e1e] border border-[#2a2a2a] focus:border-[#c9762c] rounded-lg px-3 py-2 text-white outline-none text-sm"
            />
            {form.confirm && !confirmMatch && (
              <p className="text-xs text-red-400 mt-1">Şifreler eşleşmiyor.</p>
            )}
          </div>

          <button
            type="submit"
            disabled={!canSubmit}
            className="px-8 py-3 bg-[#c9762c] hover:bg-[#e8913a] disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-lg transition-colors"
          >
            {loading ? "Kaydediliyor..." : "Şifreyi Değiştir"}
          </button>
        </form>
      )}
    </div>
  );
}
