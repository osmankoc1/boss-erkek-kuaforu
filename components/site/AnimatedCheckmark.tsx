"use client";
import { useState, useEffect } from "react";
import { motion } from "framer-motion";

function CheckIcon() {
  return (
    <>
      <div className="w-16 h-16 rounded-full bg-[#c9762c]/10 border border-[#c9762c]/20 flex items-center justify-center">
        <svg
          className="w-8 h-8 text-[#c9762c]"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M5 13l4 4L19 7"
          />
        </svg>
      </div>
      <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-[#0a0a0a] border-2 border-[#c9762c]/30 flex items-center justify-center">
        <span className="text-[8px] text-[#c9762c] font-black">✓</span>
      </div>
    </>
  );
}

export default function AnimatedCheckmark() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Pre-mount: invisible placeholder (matches server HTML — no mismatch)
  if (!mounted) {
    return (
      <div
        className="relative mx-auto mb-6 w-16 h-16"
        style={{ opacity: 0 }}
      />
    );
  }

  return (
    <motion.div
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{
        type: "spring",
        stiffness: 250,
        damping: 18,
        delay: 0.15,
      }}
      className="relative mx-auto mb-6 w-16 h-16"
    >
      <CheckIcon />
    </motion.div>
  );
}
