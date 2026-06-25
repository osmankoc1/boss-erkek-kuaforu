"use client";
import Link from "next/link";
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import type { Variants } from "framer-motion";

const EASE = [0.21, 0.47, 0.32, 0.98] as [number, number, number, number];

const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.12, delayChildren: 0.08 } },
};

const item: Variants = {
  hidden: { opacity: 0, y: 22 },
  show: { opacity: 1, y: 0, transition: { duration: 0.65, ease: EASE } },
};

// Animated version — only renders after hydration, so framer-motion
// never writes initial styles to server HTML → no hydration mismatch.
function MotionHero() {
  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="relative z-10 text-center px-6 max-w-4xl mx-auto"
    >
      <motion.div
        variants={item}
        className="inline-flex items-center gap-3 mb-8 px-4 py-2 border border-[#c9762c]/20 rounded-full bg-[#c9762c]/5"
      >
        <span className="w-1.5 h-1.5 bg-[#c9762c] rounded-full" />
        <span className="text-[#c9762c] text-xs font-semibold tracking-[0.4em] uppercase">
          Premium Erkek Bakım Stüdyosu
        </span>
      </motion.div>

      <motion.h1
        variants={item}
        className="text-6xl md:text-8xl font-black tracking-tight mb-6 leading-[0.9]"
      >
        <span className="text-white">BOSS</span>
        <br />
        <span className="text-[#c9762c]">ERKEK</span>{" "}
        <span className="text-[#3a3a3a]">KUAFÖRÜ</span>
      </motion.h1>

      <motion.p
        variants={item}
        className="text-[#6b7280] text-lg md:text-xl mb-12 max-w-lg mx-auto leading-relaxed"
      >
        Her detayda mükemmellik. Profesyonel ekibimizle kendinize özel bir
        bakım deneyimi.
      </motion.p>

      <motion.div
        variants={item}
        className="flex flex-col sm:flex-row gap-4 justify-center"
      >
        <Link
          href="/randevu"
          className="px-10 py-4 bg-[#c9762c] hover:bg-[#e8913a] text-white font-bold tracking-wide rounded-md transition-all hover:shadow-[0_0_40px_rgba(201,118,44,0.45)] text-sm uppercase"
        >
          Randevu Al
        </Link>
        <Link
          href="/randevu-sorgula"
          className="px-10 py-4 border border-[#2a2a2a] hover:border-[#c9762c]/50 text-[#9ca3af] hover:text-white font-semibold rounded-md transition-all text-sm uppercase"
        >
          Randevumu Sorgula
        </Link>
      </motion.div>
    </motion.div>
  );
}

export default function AnimatedHero() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Before mount: identical markup but invisible — matches server HTML, no mismatch.
  if (!mounted) {
    return (
      <div
        className="relative z-10 text-center px-6 max-w-4xl mx-auto"
        style={{ opacity: 0 }}
      >
        <div className="inline-flex items-center gap-3 mb-8 px-4 py-2 border border-[#c9762c]/20 rounded-full bg-[#c9762c]/5">
          <span className="w-1.5 h-1.5 bg-[#c9762c] rounded-full" />
          <span className="text-[#c9762c] text-xs font-semibold tracking-[0.4em] uppercase">
            Premium Erkek Bakım Stüdyosu
          </span>
        </div>
        <h1 className="text-6xl md:text-8xl font-black tracking-tight mb-6 leading-[0.9]">
          <span className="text-white">BOSS</span>
          <br />
          <span className="text-[#c9762c]">ERKEK</span>{" "}
          <span className="text-[#3a3a3a]">KUAFÖRÜ</span>
        </h1>
        <p className="text-[#6b7280] text-lg md:text-xl mb-12 max-w-lg mx-auto leading-relaxed">
          Her detayda mükemmellik. Profesyonel ekibimizle kendinize özel bir
          bakım deneyimi.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <span className="px-10 py-4 bg-[#c9762c] text-white font-bold rounded-md text-sm uppercase">
            Randevu Al
          </span>
          <span className="px-10 py-4 border border-[#2a2a2a] text-[#9ca3af] font-semibold rounded-md text-sm uppercase">
            Randevumu Sorgula
          </span>
        </div>
      </div>
    );
  }

  return <MotionHero />;
}
