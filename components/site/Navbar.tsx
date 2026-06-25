"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

const links = [
  { href: "/", label: "Ana Sayfa" },
  { href: "/hizmetler", label: "Hizmetler" },
  { href: "/ekibimiz", label: "Ekibimiz" },
  { href: "/iletisim", label: "İletişim" },
  { href: "/randevu-sorgula", label: "Randevum" },
];

export default function Navbar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 12);
    handler();
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  return (
    <nav
      className={cn(
        "fixed top-0 inset-x-0 z-50 transition-all duration-300",
        scrolled
          ? "bg-[#0a0a0a]/95 backdrop-blur-md border-b border-[#1e1e1e]"
          : "bg-transparent border-b border-transparent"
      )}
    >
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-3 group">
          <div className="flex items-center">
            <span className="text-xl font-black tracking-[0.2em] text-white">BOSS</span>
            <span className="ml-2 text-[10px] text-[#c9762c] font-bold tracking-[0.35em] uppercase border-l border-[#c9762c]/30 pl-2">
              Erkek Kuaförü
            </span>
          </div>
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-1">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                "px-4 py-2 text-sm font-medium tracking-wide rounded-md transition-all",
                pathname === l.href
                  ? "text-[#c9762c]"
                  : "text-[#6b7280] hover:text-white hover:bg-white/5"
              )}
            >
              {l.label}
            </Link>
          ))}
        </div>

        <div className="hidden md:flex items-center gap-3">
          <Link
            href="/randevu-sorgula"
            className={cn(
              "px-4 py-2 text-sm font-medium border border-[#2a2a2a] hover:border-[#c9762c]/50 text-[#9ca3af] hover:text-white rounded-md transition-all",
              pathname === "/randevu-sorgula" && "hidden"
            )}
          >
            Randevumu Sorgula
          </Link>
          <Link
            href="/randevu"
            className="px-5 py-2 bg-[#c9762c] hover:bg-[#e8913a] text-white text-sm font-semibold rounded-md transition-all hover:shadow-[0_0_20px_rgba(201,118,44,0.35)]"
          >
            Randevu Al
          </Link>
        </div>

        {/* Mobile burger */}
        <button
          className="md:hidden p-2 text-[#6b7280] hover:text-white transition-colors"
          onClick={() => setOpen(!open)}
          aria-label="Menü"
        >
          {open ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="md:hidden border-t border-[#1e1e1e] bg-[#0d0d0d] px-6 py-5 flex flex-col gap-1">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className={cn(
                "px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                pathname === l.href ? "text-[#c9762c] bg-[#c9762c]/5" : "text-[#6b7280] hover:text-white hover:bg-white/5"
              )}
            >
              {l.label}
            </Link>
          ))}
          <div className="pt-3 mt-2 border-t border-[#1e1e1e] flex flex-col gap-2">
            <Link
              href="/randevu-sorgula"
              onClick={() => setOpen(false)}
              className="px-3 py-2.5 rounded-md text-sm font-medium text-[#9ca3af] border border-[#2a2a2a] text-center transition-colors hover:border-[#c9762c]/40"
            >
              Randevumu Sorgula
            </Link>
            <Link
              href="/randevu"
              onClick={() => setOpen(false)}
              className="px-3 py-2.5 rounded-md text-sm font-semibold bg-[#c9762c] text-white text-center hover:bg-[#e8913a] transition-colors"
            >
              Randevu Al
            </Link>
          </div>
        </div>
      )}
    </nav>
  );
}
