import Link from "next/link";

export default function Footer() {
  return (
    <footer className="bg-[#0a0a0a] border-t border-[#141414]">
      {/* Main footer */}
      <div className="max-w-7xl mx-auto px-6 py-16 grid grid-cols-1 md:grid-cols-4 gap-10">
        {/* Brand */}
        <div className="md:col-span-2">
          <div className="flex items-center gap-3 mb-5">
            <span className="text-2xl font-black tracking-[0.2em] text-white">BOSS</span>
            <span className="text-[10px] text-[#c9762c] font-bold tracking-[0.35em] uppercase border-l border-[#c9762c]/30 pl-3">
              Erkek Kuaförü
            </span>
          </div>
          <p className="text-[#6b7280] text-sm leading-relaxed max-w-xs">
            Premium erkek bakım stüdyosu. Profesyonel kadromuzla her ziyarette mükemmel bir deneyim sunuyoruz.
          </p>
          <div className="flex gap-3 mt-6">
            {["Instagram", "Facebook"].map((s) => (
              <div
                key={s}
                className="px-4 py-1.5 border border-[#2a2a2a] hover:border-[#c9762c]/40 rounded text-xs text-[#6b7280] hover:text-[#c9762c] transition-all cursor-pointer"
              >
                {s}
              </div>
            ))}
          </div>
        </div>

        {/* Links */}
        <div>
          <h3 className="text-xs font-bold tracking-[0.3em] text-[#9ca3af] uppercase mb-5">Bağlantılar</h3>
          <ul className="space-y-3">
            {[
              { href: "/hizmetler", label: "Hizmetler" },
              { href: "/ekibimiz", label: "Ekibimiz" },
              { href: "/randevu", label: "Randevu Al" },
              { href: "/randevu-sorgula", label: "Randevumu Sorgula" },
              { href: "/iletisim", label: "İletişim" },
            ].map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="text-[#6b7280] hover:text-white text-sm transition-colors">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        {/* Contact */}
        <div>
          <h3 className="text-xs font-bold tracking-[0.3em] text-[#9ca3af] uppercase mb-5">İletişim</h3>
          <ul className="space-y-4">
            {[
              {
                icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z M15 11a3 3 0 11-6 0 3 3 0 016 0z" />,
                text: "İstanbul, Türkiye",
              },
              {
                icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />,
                text: "+90 555 000 00 00",
              },
              {
                icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />,
                text: "Pzt–Cmt: 09:00–19:00",
              },
            ].map(({ icon, text }) => (
              <li key={text} className="flex items-start gap-3">
                <svg className="w-4 h-4 text-[#c9762c] mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {icon}
                </svg>
                <span className="text-[#6b7280] text-sm">{text}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="border-t border-[#141414]">
        <div className="max-w-7xl mx-auto px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span className="text-[#6b7280] text-xs">
            © {new Date().getFullYear()} BOSS Erkek Kuaförü. Tüm hakları saklıdır.
          </span>
          <span className="text-[#3a3a3a] text-xs">Premium Erkek Bakım Stüdyosu</span>
        </div>
      </div>
    </footer>
  );
}
