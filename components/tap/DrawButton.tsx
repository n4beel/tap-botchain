"use client";

import React, { useMemo } from "react";
import type { TapPhase } from "@/lib/tap";

interface DrawButtonProps {
  phase: TapPhase;
  fraction?: number; // 0..1 (0 = just drew, 1 = ready)
  countdownText?: string;
  loading?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}

export default function DrawButton({
  phase,
  fraction = 1,
  countdownText,
  loading = false,
  onClick,
  disabled = false,
}: DrawButtonProps) {
  // Clamped percent for liquid fill height
  const percent = useMemo(() => {
    return Math.max(0, Math.min(100, Math.round(fraction * 100)));
  }, [fraction]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-4">
        <div className="draw-hero-btn bg-[#FFD23F] text-[#0B1B4D] shadow-lg">
          <span className="w-8 h-8 border-4 border-[#0B1B4D] border-t-transparent rounded-full animate-spin" />
          <span className="mt-2 text-[12px] font-bold tracking-wider uppercase">Confirming</span>
        </div>
      </div>
    );
  }

  if (phase === "canDraw") {
    return (
      <div className="flex flex-col items-center justify-center p-4">
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          className="draw-hero-btn draw-ready group focus:outline-none focus:ring-4 focus:ring-yellow-300"
          aria-label="Draw from tap"
        >
          <span className="text-[32px] font-extrabold tracking-tight text-[#0B1B4D] group-hover:scale-105 transition-transform">
            DRAW
          </span>
          <span className="text-[11px] font-bold uppercase tracking-widest text-[#0B1B4D]/75 mt-0.5">
            Ready
          </span>
        </button>
      </div>
    );
  }

  if (phase === "cooldown") {
    return (
      <div className="flex flex-col items-center justify-center p-4">
        <div
          className="draw-hero-btn draw-cooldown relative"
          role="status"
          aria-label={`Tap on cooldown. ${countdownText ?? "Please wait."}`}
        >
          {/* Liquid level fill rising from bottom */}
          <div
            className="absolute inset-0 bg-[#FFD23F] transition-all duration-1000 ease-linear pointer-events-none"
            style={{
              clipPath: `inset(${100 - percent}% 0 0 0)`,
            }}
          />
          {/* Wave line separator */}
          <div
            className="absolute left-0 right-0 h-[2px] bg-yellow-200 pointer-events-none transition-all duration-1000 ease-linear"
            style={{
              top: `${100 - percent}%`,
              opacity: percent > 0 && percent < 100 ? 1 : 0,
            }}
          />
          {/* Content overlay */}
          <div className="relative z-10 flex flex-col items-center justify-center text-center px-2">
            <span
              className="text-[11px] font-bold uppercase tracking-wider transition-colors"
              style={{
                color: percent > 50 ? "#0B1B4D" : "#C9D5F8",
              }}
            >
              Next Draw
            </span>
            <span
              className="mono text-[18px] font-bold tracking-tight transition-colors"
              style={{
                color: percent > 50 ? "#0B1B4D" : "#FFFFFF",
              }}
            >
              {countdownText || `${percent}%`}
            </span>
          </div>
        </div>
      </div>
    );
  }

  if (phase === "used") {
    return (
      <div className="flex flex-col items-center justify-center p-4">
        <div className="draw-hero-btn draw-used" role="status" aria-label="Tap already used">
          <span className="text-[20px] font-bold uppercase tracking-wider text-slate-300">
            Used
          </span>
          <span className="text-[10px] uppercase tracking-widest text-slate-400 mt-1">
            Once only
          </span>
        </div>
      </div>
    );
  }

  // phase === "empty"
  return (
    <div className="flex flex-col items-center justify-center p-4">
      <div className="draw-hero-btn draw-empty" role="status" aria-label="Tap is dry">
        <span className="text-[24px] font-bold uppercase tracking-wider text-[#FFD23F]">
          Dry
        </span>
        <span className="text-[10px] uppercase tracking-widest text-yellow-200/80 mt-1">
          Needs Top Up
        </span>
      </div>
    </div>
  );
}
