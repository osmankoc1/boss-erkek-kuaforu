import Link from "next/link";
import { db } from "@/lib/db";
import { formatPrice } from "@/lib/utils";
import AnimatedHero from "@/components/site/AnimatedHero";
import { FadeIn, HoverLift } from "@/components/site/Animate";

export default async function HomePage() {
  const [services, barbers, campaigns] = await Promise.all([
    db.service.findMany({ where: { isActive: true }, take: 4 }),
    db.barber.findMany({ where: { isActive: true }, take: 3 }),
    db.campaign.findMany({
      where: {
        isActive: true,
        showOnHome: true,
        endDate: { gte: new Date() },
        startDate: { lte: new Date() },
      },
      orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
    }),
  ]);

  return (
    <div className="bg-[#0a0a0a]">
      {/* ───── Hero ───── */}
      <section className="relative min-h-[92vh] flex items-center justify-center overflow-hidden">
        <div className="absolute inset-0">
          <div className="absolute inset-0 bg-[#0a0a0a]" />
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[900px] rounded-full opacity-[0.07]"
            style={{ background: "radial-gradient(circle, #c9762c 0%, transparent 65%)" }}
          />
        </div>

        <AnimatedHero />

        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#c9762c]/40 to-transparent" />
      </section>

      {/* ───── Kampanyalar ───── */}
      {campaigns.length > 0 && (
        <section className="relative py-14 px-6 overflow-hidden">
          {/* Arka plan efekti */}
          <div
            className="absolute inset-0 opacity-[0.04]"
            style={{ background: "radial-gradient(ellipse at 50% 50%, #c9762c, transparent 65%)" }}
          />
          <div className="relative max-w-6xl mx-auto">
            {/* Bölüm başlığı */}
            <div className="flex items-center gap-3 mb-6">
              <div className="w-px h-6 bg-[#c9762c]" />
              <p className="text-[#c9762c] text-xs font-bold tracking-[0.4em] uppercase">Güncel Kampanyalar</p>
            </div>

            <div className="space-y-4">
              {campaigns.map((c, idx, arr) => {
                const daysLeft = Math.ceil((new Date(c.endDate).getTime() - Date.now()) / 86400000);
                const isUrgent = daysLeft <= 7;

                return (
                  <FadeIn key={c.id} delay={idx * 0.08}>
                  <div
                    className="group relative overflow-hidden rounded-xl border border-[#c9762c]/20 bg-gradient-to-r from-[#141414] via-[#121212] to-[#111] hover:border-[#c9762c]/40 transition-all duration-300"
                  >
                    {/* Sol vurgu çizgisi */}
                    <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-gradient-to-b from-[#c9762c]/80 via-[#c9762c]/40 to-transparent" />

                    <div className="flex items-center gap-5 px-7 py-5 sm:py-6">
                      {/* İkon */}
                      <div className="w-10 h-10 rounded-lg bg-[#c9762c]/12 border border-[#c9762c]/20 flex items-center justify-center shrink-0">
                        <svg className="w-4 h-4 text-[#c9762c]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                            d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                        </svg>
                      </div>

                      {/* Metin */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <h3 className="font-black text-white text-base">{c.title}</h3>
                          {isUrgent && (
                            <span className="text-[10px] font-bold px-2 py-0.5 bg-[#c9762c]/15 border border-[#c9762c]/30 text-[#e8913a] rounded-full uppercase tracking-wide">
                              Son {daysLeft} Gün
                            </span>
                          )}
                          {idx === 0 && campaigns.length > 1 && (
                            <span className="text-[10px] font-bold px-2 py-0.5 bg-white/5 border border-white/10 text-white/50 rounded-full">
                              #1
                            </span>
                          )}
                        </div>
                        <p className="text-[#9ca3af] text-sm leading-relaxed">{c.description}</p>
                        <p className="text-[#5a5a5a] text-xs mt-2">
                          {new Date(c.startDate).toLocaleDateString("tr-TR")} — {new Date(c.endDate).toLocaleDateString("tr-TR")}
                        </p>
                      </div>

                      {/* Buton (opsiyonel) */}
                      {c.buttonText && c.buttonLink && (
                        <Link
                          href={c.buttonLink}
                          className="shrink-0 px-5 py-2.5 bg-[#c9762c] hover:bg-[#e8913a] text-white text-xs font-bold rounded-lg transition-all hover:shadow-[0_0_20px_rgba(201,118,44,0.3)] uppercase tracking-wide whitespace-nowrap"
                        >
                          {c.buttonText}
                        </Link>
                      )}
                    </div>
                  </div>
                  </FadeIn>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* ───── Hizmetler ───── */}
      {services.length > 0 && (
        <section className="py-24 px-6">
          <div className="max-w-6xl mx-auto">
            <FadeIn className="mb-14">
              <p className="text-[#c9762c] text-xs font-bold tracking-[0.4em] uppercase mb-3">Hizmetlerimiz</p>
              <h2 className="text-4xl md:text-5xl font-black text-white">Öne Çıkan Hizmetler</h2>
            </FadeIn>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {services.map((s, i) => (
                <FadeIn key={s.id} delay={i * 0.07}>
                <div
                  className="group relative bg-[#141414] border border-[#2a2a2a] hover:border-[#c9762c]/40 rounded-lg p-6 transition-all duration-300 hover:shadow-[0_0_25px_rgba(201,118,44,0.08)] overflow-hidden"
                >
                  <div className="absolute top-0 right-0 w-24 h-24 opacity-5 group-hover:opacity-10 transition-opacity"
                    style={{ background: "radial-gradient(circle at top right, #c9762c, transparent 70%)" }} />
                  <div className="text-[#c9762c]/30 text-5xl font-black mb-4 leading-none select-none">
                    {String(i + 1).padStart(2, "0")}
                  </div>
                  <h3 className="font-bold text-white mb-1.5">{s.name}</h3>
                  {s.description && <p className="text-[#6b7280] text-xs mb-4 leading-relaxed">{s.description}</p>}
                  <div className="flex items-center justify-between pt-4 border-t border-[#2a2a2a]">
                    <span className="text-[#c9762c] font-black text-lg">{formatPrice(s.price)}</span>
                    <span className="text-[#6b7280] text-xs">{s.durationMinutes} dk</span>
                  </div>
                </div>
                </FadeIn>
              ))}
            </div>
            <div className="mt-10">
              <Link href="/hizmetler" className="inline-flex items-center gap-2 text-[#c9762c] hover:text-[#e8913a] text-sm font-semibold transition-colors">
                Tüm hizmetleri gör
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* ───── Ekip ───── */}
      {barbers.length > 0 && (
        <section className="py-24 px-6 border-t border-[#141414]">
          <div className="max-w-6xl mx-auto">
            <FadeIn className="mb-14">
              <p className="text-[#c9762c] text-xs font-bold tracking-[0.4em] uppercase mb-3">Uzman Kadro</p>
              <h2 className="text-4xl md:text-5xl font-black text-white">Ekibimiz</h2>
            </FadeIn>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              {barbers.map((b, i) => {
                const initials = b.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
                return (
                  <FadeIn key={b.id} delay={i * 0.1}>
                  <div className="bg-[#141414] border border-[#2a2a2a] hover:border-[#c9762c]/30 rounded-lg overflow-hidden group transition-all duration-300">
                    <div className="h-52 bg-[#111] flex items-center justify-center relative overflow-hidden">
                      {b.photoUrl ? (
                        <img src={b.photoUrl} alt={b.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                      ) : (
                        <div className="flex flex-col items-center gap-3">
                          <div className="w-20 h-20 rounded-full bg-[#c9762c]/10 border border-[#c9762c]/20 flex items-center justify-center">
                            <span className="text-[#c9762c] text-2xl font-black tracking-wide">{initials}</span>
                          </div>
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-[#141414] via-transparent to-transparent" />
                    </div>
                    <div className="p-5">
                      <h3 className="font-black text-white text-lg">{b.name}</h3>
                      {b.specialty && <p className="text-[#c9762c] text-xs font-semibold tracking-wide uppercase mt-0.5">{b.specialty}</p>}
                      {b.bio && <p className="text-[#6b7280] text-sm leading-relaxed mt-3">{b.bio}</p>}
                      {b.experienceYrs > 0 && (
                        <p className="text-[#9ca3af] text-xs mt-3">{b.experienceYrs} yıl deneyim</p>
                      )}
                    </div>
                  </div>
                  </FadeIn>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* ───── CTA ───── */}
      <section className="py-28 px-6 relative overflow-hidden">
        <div className="absolute inset-0"
          style={{ background: "radial-gradient(ellipse at 50% 100%, rgba(201,118,44,0.12) 0%, transparent 70%)" }} />
        <FadeIn className="relative z-10 max-w-2xl mx-auto text-center">
          <p className="text-[#c9762c] text-xs font-bold tracking-[0.4em] uppercase mb-5">Hemen Başlayın</p>
          <h2 className="text-4xl md:text-6xl font-black mb-5 leading-tight">
            Randevunuzu<br />Alın
          </h2>
          <p className="text-[#6b7280] text-lg mb-10 leading-relaxed">
            Online randevu alın, bekleme yok. İstediğiniz berber ve saati seçin.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/randevu"
              className="px-10 py-4 bg-[#c9762c] hover:bg-[#e8913a] text-white font-bold rounded-md transition-all hover:shadow-[0_0_50px_rgba(201,118,44,0.4)] text-sm uppercase tracking-wide"
            >
              Hemen Randevu Al
            </Link>
            <Link
              href="/hizmetler"
              className="px-10 py-4 border border-[#2a2a2a] hover:border-[#c9762c]/40 text-[#9ca3af] hover:text-white font-semibold rounded-md transition-all text-sm uppercase tracking-wide"
            >
              Hizmetleri İncele
            </Link>
          </div>
        </FadeIn>
      </section>

      {/* ───── Bilgi çubuğu ───── */}
      <section className="border-t border-[#141414] bg-[#0d0d0d]">
        <div className="max-w-6xl mx-auto px-6 py-12 grid grid-cols-1 md:grid-cols-3 gap-8">
          {[
            {
              icon: (
                <svg className="w-5 h-5 text-[#c9762c]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              ),
              title: "Çalışma Saatleri",
              desc: "Pazartesi–Cumartesi: 09:00–19:00",
            },
            {
              icon: (
                <svg className="w-5 h-5 text-[#c9762c]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              ),
              title: "Konum",
              desc: "İstanbul, Türkiye",
            },
            {
              icon: (
                <svg className="w-5 h-5 text-[#c9762c]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
              ),
              title: "Telefon",
              desc: "+90 555 000 00 00",
            },
          ].map((item, i) => (
            <FadeIn key={item.title} delay={i * 0.08}>
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-[#c9762c]/10 border border-[#c9762c]/15 flex items-center justify-center shrink-0 mt-0.5">
                {item.icon}
              </div>
              <div>
                <h3 className="font-bold text-white text-sm">{item.title}</h3>
                <p className="text-[#6b7280] text-sm mt-0.5">{item.desc}</p>
              </div>
            </div>
            </FadeIn>
          ))}
        </div>
      </section>
    </div>
  );
}
