import React, { useState, useRef, useCallback, useEffect } from "react";
import { DICTIONARY, type Language } from "../i18n.js";
import { SlidersHorizontal } from "lucide-react";

export interface BeforeAfterSliderProps {
  beforeSrc: string;
  afterSrc: string;
  alt: string;
  initialPercent?: number;
  lang?: Language;
  className?: string;
  showControls?: boolean;
}

export const BeforeAfterSlider: React.FC<BeforeAfterSliderProps> = ({
  beforeSrc,
  afterSrc,
  alt,
  initialPercent = 50,
  lang = "zh",
  className = "",
  showControls = true,
}) => {
  const [percent, setPercent] = useState<number>(initialPercent);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const t = DICTIONARY[lang];

  const handleMove = useCallback((clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const clamped = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setPercent(clamped);
  }, []);

  const handlePointerDown = (e: React.PointerEvent) => {
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    handleMove(e.clientX);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (isDragging) {
      handleMove(e.clientX);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    setIsDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {/* Slider Viewport */}
      <div
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className="relative w-full aspect-[16/10] overflow-hidden rounded-xl bg-zinc-950 border border-white/10 select-none cursor-ew-resize shadow-2xl group"
      >
        {/* Layer 1: Bottom Image (Before / Legacy) */}
        <img
          src={beforeSrc}
          alt={`Before: ${alt}`}
          className="absolute inset-0 w-full h-full object-cover pointer-events-none"
        />

        {/* Layer 2: Top Image (After / Remaster) with hardware-accelerated clip-path */}
        <div
          className="absolute inset-0 w-full h-full pointer-events-none"
          style={{
            clipPath: `inset(0 ${100 - percent}% 0 0)`,
          }}
        >
          <img
            src={afterSrc}
            alt={`After: ${alt}`}
            className="absolute inset-0 w-full h-full object-cover"
          />
        </div>

        {/* Dividing Line & Glowing Handle */}
        <div
          className="absolute top-0 bottom-0 pointer-events-none transition-transform"
          style={{
            left: `${percent}%`,
            transform: "translateX(-50%)",
          }}
        >
          {/* Vertical Glowing Line */}
          <div className="w-[2px] h-full bg-sky-400 shadow-[0_0_12px_#38bdf8]" />

          {/* Center Circular Controller Handle */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-zinc-900 border-2 border-sky-400 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
            <SlidersHorizontal size={14} className="text-sky-300" />
          </div>
        </div>

        {/* Badges */}
        <div className="absolute top-3 left-3 z-10">
          <span className="px-2.5 py-1 text-[11px] font-semibold tracking-wide rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/30 backdrop-blur-md">
            {t.beforeBadge}
          </span>
        </div>
        <div className="absolute top-3 right-3 z-10">
          <span className="px-2.5 py-1 text-[11px] font-semibold tracking-wide rounded-md bg-sky-500/20 text-sky-300 border border-sky-500/30 backdrop-blur-md">
            {t.afterBadge}
          </span>
        </div>
      </div>

      {/* Preset Quick Actions */}
      {showControls && (
        <div className="flex items-center justify-between text-xs text-zinc-400 px-1">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setPercent(0)}
              className={`px-2.5 py-1 rounded border transition-colors ${
                percent === 0
                  ? "bg-amber-500/20 border-amber-500/40 text-amber-300 font-medium"
                  : "bg-zinc-900 border-white/5 hover:border-white/20 text-zinc-400"
              }`}
            >
              {t.splitPreset100Before}
            </button>
            <button
              onClick={() => setPercent(50)}
              className={`px-2.5 py-1 rounded border transition-colors ${
                percent === 50
                  ? "bg-sky-500/20 border-sky-500/40 text-sky-300 font-medium"
                  : "bg-zinc-900 border-white/5 hover:border-white/20 text-zinc-400"
              }`}
            >
              {t.splitPreset50}
            </button>
            <button
              onClick={() => setPercent(100)}
              className={`px-2.5 py-1 rounded border transition-colors ${
                percent === 100
                  ? "bg-sky-500/20 border-sky-500/40 text-sky-300 font-medium"
                  : "bg-zinc-900 border-white/5 hover:border-white/20 text-zinc-400"
              }`}
            >
              {t.splitPreset100After}
            </button>
          </div>

          <div className="text-[11px] text-zinc-500 flex items-center gap-1">
            <span>{t.escapeKeyHint}</span>
          </div>
        </div>
      )}
    </div>
  );
};
