import { db } from "@/lib/db";

export const metadata = { title: "İletişim — BOSS Erkek Kuaförü" };

async function getSettings() {
  const settings = await db.setting.findMany();
  return Object.fromEntries(settings.map((s) => [s.key, s.value]));
}

export default async function IletisimPage() {
  const settings = await getSettings();

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      {/* Header */}
      <div className="relative py-24 px-6 overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{ background: "radial-gradient(ellipse at 50% 0%, #c9762c, transparent 70%)" }}
        />
        <div className="relative max-w-4xl mx-auto text-center">
          <p className="text-[#c9762c] text-xs font-bold tracking-[0.4em] uppercase mb-4">Bize Ulaşın</p>
          <h1 className="text-5xl md:text-6xl font-black mb-5 leading-tight">İletişim</h1>
          <p className="text-[#6b7280] text-lg max-w-sm mx-auto">
            Sorularınız için bize ulaşın.
          </p>
        </div>
      </div>

      {/* İçerik */}
      <div className="px-6 pb-24">
        <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-5 gap-8">
          {/* Sol: bilgiler */}
          <div className="lg:col-span-2 space-y-4">
            {[
              {
                icon: (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                ),
                label: "Adres",
                value: settings.business_address ?? "İstanbul, Türkiye",
              },
              {
                icon: (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                ),
                label: "Telefon",
                value: settings.business_phone ?? "+90 555 000 00 00",
              },
              {
                icon: (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                ),
                label: "E-posta",
                value: settings.business_email ?? "info@boss-kuafor.com",
              },
              {
                icon: (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                ),
                label: "Çalışma Saatleri",
                value: "Pazartesi–Cumartesi: 09:00–19:00",
              },
            ].map(({ icon, label, value }) => (
              <div key={label} className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-5 flex items-start gap-4 hover:border-[#c9762c]/20 transition-colors">
                <div className="w-9 h-9 rounded-lg bg-[#c9762c]/10 border border-[#c9762c]/15 flex items-center justify-center shrink-0 mt-0.5">
                  <svg className="w-4 h-4 text-[#c9762c]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    {icon}
                  </svg>
                </div>
                <div>
                  <p className="text-[#6b7280] text-xs uppercase tracking-wider mb-1">{label}</p>
                  <p className="text-white font-medium text-sm">{value}</p>
                </div>
              </div>
            ))}

            {/* Sosyal */}
            <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-5">
              <h3 className="text-xs font-bold uppercase tracking-[0.25em] text-[#6b7280] mb-4">Sosyal Medya</h3>
              <div className="flex gap-3">
                {["Instagram", "Facebook"].map((s) => (
                  <div
                    key={s}
                    className="flex-1 text-center px-4 py-2.5 border border-[#2a2a2a] hover:border-[#c9762c]/40 rounded-md text-sm text-[#6b7280] hover:text-white transition-all cursor-pointer"
                  >
                    {s}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Sağ: harita */}
          <div className="lg:col-span-3">
            <div className="h-80 lg:h-full min-h-72 bg-[#141414] border border-[#2a2a2a] rounded-xl overflow-hidden">
              {settings.maps_link ? (
                <iframe
                  src={settings.maps_link}
                  className="w-full h-full"
                  style={{ border: 0 }}
                  allowFullScreen
                  loading="lazy"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <div className="text-center">
                    <div className="w-14 h-14 rounded-full bg-[#c9762c]/10 border border-[#c9762c]/15 flex items-center justify-center mx-auto mb-4">
                      <svg className="w-6 h-6 text-[#c9762c]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                          d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </div>
                    <p className="text-[#6b7280] text-sm font-medium">Harita buraya eklenecek</p>
                    <p className="text-[#4b5563] text-xs mt-1">Admin panelinden ekleyebilirsiniz</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
