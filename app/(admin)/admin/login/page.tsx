"use client";
import { useActionState } from "react";
import { login } from "@/app/actions/auth";

export default function LoginPage() {
  const [state, action, pending] = useActionState(login, undefined);

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <span className="text-3xl font-black tracking-widest">BOSS</span>
          <p className="text-[#6b7280] text-sm mt-1">Admin Paneli</p>
        </div>

        <form action={action} className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-8 space-y-5">
          {state?.error && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-400 rounded text-sm">
              {state.error}
            </div>
          )}

          <div>
            <label className="block text-sm text-[#9ca3af] mb-2">E-posta</label>
            <input
              name="email"
              type="email"
              required
              className="w-full bg-[#1e1e1e] border border-[#2a2a2a] focus:border-[#c9762c] rounded-lg px-4 py-3 text-white outline-none"
              placeholder="admin@boss.com"
            />
          </div>

          <div>
            <label className="block text-sm text-[#9ca3af] mb-2">Şifre</label>
            <input
              name="password"
              type="password"
              required
              className="w-full bg-[#1e1e1e] border border-[#2a2a2a] focus:border-[#c9762c] rounded-lg px-4 py-3 text-white outline-none"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={pending}
            className="w-full py-3 bg-[#c9762c] hover:bg-[#e8913a] disabled:opacity-50 text-white font-bold rounded-lg transition-colors"
          >
            {pending ? "Giriş yapılıyor..." : "Giriş Yap"}
          </button>
        </form>
      </div>
    </div>
  );
}
