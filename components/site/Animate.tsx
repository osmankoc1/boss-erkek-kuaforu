"use client";
import {
  useRef,
  useEffect,
  useState,
  type ReactNode,
  type CSSProperties,
} from "react";
import { motion, useReducedMotion } from "framer-motion";

// ── FadeIn ─────────────────────────────────────────────────────────────────
// Pure CSS transition + IntersectionObserver; no framer-motion → no SSR mismatch.
// Server render: no inline styles (element fully visible).
// Client after hydration: observes viewport and animates on entry.
export function FadeIn({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // "ssr"     → no inline style (server + initial client render)
  // "hidden"  → opacity:0, translateY(16px)
  // "visible" → opacity:1, no transform, with transition
  const [phase, setPhase] = useState<"ssr" | "hidden" | "visible">("ssr");

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      setPhase("visible");
      return;
    }

    // Check synchronously whether the element is already in the viewport.
    const rect = el.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const alreadyVisible = rect.top < vh + 80 && rect.bottom > -80;

    if (alreadyVisible) {
      // Go hidden → visible in one microtask so the CSS transition fires.
      setPhase("hidden");
      const id = setTimeout(() => setPhase("visible"), 20);
      return () => clearTimeout(id);
    }

    // Element below the fold: hide immediately and reveal on scroll.
    setPhase("hidden");
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setPhase("visible");
          observer.disconnect();
        }
      },
      { rootMargin: "80px 0px -20px 0px", threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tr = `opacity 0.5s ${delay}s cubic-bezier(0.21,0.47,0.32,0.98), transform 0.5s ${delay}s cubic-bezier(0.21,0.47,0.32,0.98)`;

  const style: CSSProperties | undefined =
    phase === "ssr"
      ? undefined
      : phase === "hidden"
      ? { opacity: 0, transform: "translateY(16px)", transition: tr }
      : { opacity: 1, transform: "none", transition: tr };

  return (
    <div ref={ref} className={className} style={style}>
      {children}
    </div>
  );
}

// ── HoverLift ──────────────────────────────────────────────────────────────
// framer-motion whileHover only — no initial/animate so no SSR style injection.
export function HoverLift({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const reduced = useReducedMotion();
  if (reduced) return <div className={className}>{children}</div>;
  return (
    <motion.div
      whileHover={{ y: -4 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
