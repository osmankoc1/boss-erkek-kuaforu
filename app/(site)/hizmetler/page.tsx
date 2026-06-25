import Link from "next/link";
import { db } from "@/lib/db";
import { formatPrice } from "@/lib/utils";
import { FadeIn } from "@/components/site/Animate";

export const metadata = { title: "Hizmetler — BOSS Erkek Kuaförü" };

export default async function HizmetlerPage() {
  const services = await db.service.findMany({ where: { isActive: true }, orderBy: { price: "asc" } });

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      {/* Header */}
      <div className="relative py-24 px-6 overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{ background: "radial-gradient(ellipse at 50% 0%, #c9762c, transparent 70%)" }}
        />
        <FadeIn className="relative max-w-4xl mx-auto text-center">
          <p className="text-[#c9762c] text-xs font-bold tracking-[0.4em] uppercase mb-4">Ne Yapalım?</p>
          <h1 className="text-5xl md:text-6xl font-black mb-5 leading-tight">Hizmetlerimiz</h1>
          <p className="text-[#6b7280] text-lg max-w-md mx-auto">
            Profesyonel kadromuz tarafından sunulan tüm bakım hizmetleri.
          </p>
        </FadeIn>
      </div>

      {/* Hizmet listesi */}
      <div className="px-6 pb-24">
        <div className="max-w-3xl mx-auto">
          {services.length === 0 ? (
            <p className="text-center text-[#6b7280] py-16">Henüz hizmet eklenmemiş.</p>
          ) : (
            <div className="space-y-2">
              {services.map((s, i) => (
                <FadeIn key={s.id} delay={i * 0.05}>
                <div
                  className="group flex items-center justify-between bg-[#141414] border border-[#2a2a2a] hover:border-[#c9762c]/40 rounded-lg px-6 py-5 transition-all duration-200 hover:shadow-[0_0_20px_rgba(201,118,44,0.07)]"
                >
                  <div className="flex items-center gap-5">
                    <span className="text-[#c9762c]/25 text-2xl font-black w-8 text-center group-hover:text-[#c9762c]/50 transition-colors select-none">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <h3 className="font-bold text-white">{s.name}</h3>
                      {s.description && <p className="text-[#6b7280] text-sm mt-0.5">{s.description}</p>}
                    </div>
                  </div>
                  <div className="text-right shrink-0 ml-6">
                    <div className="text-[#c9762c] font-black text-lg">{formatPrice(s.price)}</div>
                    <div className="text-[#6b7280] text-xs mt-0.5">{s.durationMinutes} dk</div>
                  </div>
                </div>
                </FadeIn>
              ))}
            </div>
          )}

          {/* CTA */}
          <FadeIn className="mt-14 text-center">
            <p className="text-[#6b7280] text-sm mb-6">Hizmetlerimizi beğendiniz mi?</p>
            <Link
              href="/randevu"
              className="inline-block px-10 py-4 bg-[#c9762c] hover:bg-[#e8913a] text-white font-bold rounded-md transition-all hover:shadow-[0_0_35px_rgba(201,118,44,0.35)] text-sm uppercase tracking-wide"
            >
              Randevu Al
            </Link>
          </FadeIn>
        </div>
      </div>
    </div>
  );
}
