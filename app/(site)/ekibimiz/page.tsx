import Link from "next/link";
import { db } from "@/lib/db";
import { FadeIn, HoverLift } from "@/components/site/Animate";

export const metadata = { title: "Ekibimiz — BOSS Erkek Kuaförü" };

export default async function EkibimizPage() {
  const barbers = await db.barber.findMany({ where: { isActive: true } });

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      {/* Header */}
      <div className="relative py-24 px-6 overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{ background: "radial-gradient(ellipse at 50% 0%, #c9762c, transparent 70%)" }}
        />
        <FadeIn className="relative max-w-4xl mx-auto text-center">
          <p className="text-[#c9762c] text-xs font-bold tracking-[0.4em] uppercase mb-4">Uzman Kadro</p>
          <h1 className="text-5xl md:text-6xl font-black mb-5 leading-tight">Ekibimiz</h1>
          <p className="text-[#6b7280] text-lg max-w-md mx-auto">
            Deneyimli ve tutkulu ekibimiz, size en iyi hizmeti sunmak için burada.
          </p>
        </FadeIn>
      </div>

      {/* Ekip kartları */}
      <div className="px-6 pb-24">
        <div className="max-w-6xl mx-auto">
          {barbers.length === 0 ? (
            <p className="text-center text-[#6b7280] py-16">Henüz ekip üyesi eklenmemiş.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
              {barbers.map((b, i) => {
                const initials = b.name
                  .split(" ")
                  .map((w) => w[0])
                  .slice(0, 2)
                  .join("")
                  .toUpperCase();
                return (
                  <FadeIn key={b.id} delay={i * 0.1}>
                  <HoverLift>
                  <div
                    className="group bg-[#141414] border border-[#2a2a2a] hover:border-[#c9762c]/30 rounded-xl overflow-hidden transition-all duration-300 hover:shadow-[0_0_30px_rgba(201,118,44,0.08)]"
                  >
                    {/* Fotoğraf / avatar alanı */}
                    <div className="relative h-72 bg-[#0f0f0f] overflow-hidden">
                      {b.photoUrl ? (
                        <img
                          src={b.photoUrl}
                          alt={b.name}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center">
                          <div className="w-24 h-24 rounded-full border-2 border-[#c9762c]/30 bg-[#c9762c]/8 flex items-center justify-center mb-4 group-hover:border-[#c9762c]/60 transition-all">
                            <span className="text-[#c9762c] text-3xl font-black tracking-widest">{initials}</span>
                          </div>
                          <div className="w-16 h-px bg-[#c9762c]/20" />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-[#141414] via-[#141414]/10 to-transparent" />
                      {b.specialty && (
                        <div className="absolute bottom-4 left-4 right-4">
                          <span className="inline-block text-[10px] font-bold tracking-[0.25em] uppercase text-[#c9762c] bg-[#c9762c]/10 border border-[#c9762c]/20 rounded px-2.5 py-1">
                            {b.specialty}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Bilgi alanı */}
                    <div className="p-6">
                      <h2 className="text-xl font-black text-white mb-1">{b.name}</h2>
                      {b.experienceYrs > 0 && (
                        <p className="text-[#6b7280] text-xs mb-3">{b.experienceYrs} Yıl Deneyim</p>
                      )}
                      {b.bio && (
                        <p className="text-[#6b7280] text-sm leading-relaxed border-t border-[#2a2a2a] pt-4 mt-3">
                          {b.bio}
                        </p>
                      )}
                      <div className="mt-5">
                        <Link
                          href={`/randevu?berber=${b.id}`}
                          className="w-full block text-center px-4 py-2.5 bg-transparent hover:bg-[#c9762c] text-[#c9762c] hover:text-white text-sm font-bold border border-[#c9762c]/30 hover:border-[#c9762c] rounded-md transition-all duration-200"
                        >
                          Randevu Al
                        </Link>
                      </div>
                    </div>
                  </div>
                  </HoverLift>
                  </FadeIn>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
