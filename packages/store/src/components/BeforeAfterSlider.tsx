import React, { useState, useRef, useCallback } from "react";
import { DICTIONARY, type Language } from "../i18n.js";
import { SlidersHorizontal, Columns2, Sparkles, Layers } from "lucide-react";

export interface BeforeAfterSliderProps {
  beforeSrc: string;
  afterSrc: string;
  alt: string;
  initialPercent?: number;
  lang?: Language;
  className?: string;
  showControls?: boolean;
}

export type CompareViewMode = "split" | "side-by-side" | "fade";

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
  const [viewMode, setViewMode] = useState<CompareViewMode>("split");
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setPercent((p) => Math.max(0, p - 5));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setPercent((p) => Math.min(100, p + 5));
    } else if (e.key === "Home") {
      e.preventDefault();
      setPercent(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setPercent(100);
    }
  };

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {/* Viewport Render depending on viewMode */}
      {viewMode === "side-by-side" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full">
          {/* Before Column */}
          <div className="relative aspect-[16/10] overflow-hidden rounded-xl bg-zinc-950 border border-white/10 shadow-xl">
            <img src={beforeSrc} alt={`Before: ${alt}`} className="w-full h-full object-cover" />
            <div className="absolute top-3 left-3 z-10">
              <span className="px-2.5 py-1 text-[11px] font-semibold tracking-wide rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/30 backdrop-blur-md">
                {t.beforeBadge}
              </span>
            </div>
          </div>
          {/* After Column */}
          <div className="relative aspect-[16/10] overflow-hidden rounded-xl bg-zinc-950 border border-sky-500/30 shadow-xl glow-card">
            <img src={afterSrc} alt={`After: ${alt}`} className="w-full h-full object-cover" />
            <div className="absolute top-3 right-3 z-10">
              <span className="px-2.5 py-1 text-[11px] font-semibold tracking-wide rounded-md bg-sky-500/20 text-sky-300 border border-sky-500/30 backdrop-blur-md">
                {t.afterBadge}
              </span>
            </div>
          </div>
        </div>
      ) : viewMode === "fade" ? (
        <div className="relative w-full aspect-[16/10] overflow-hidden rounded-xl bg-zinc-950 border border-white/10 select-none shadow-2xl">
          <img
            src={beforeSrc}
            alt={`Before: ${alt}`}
            className="absolute inset-0 w-full h-full object-cover pointer-events-none"
          />
          <img
            src={afterSrc}
            alt={`After: ${alt}`}
            className="absolute inset-0 w-full h-full object-cover pointer-events-none transition-opacity duration-150"
            style={{ opacity: percent / 100 }}
          />
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
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 bg-zinc-950/80 backdrop-blur-md px-3 py-1 rounded-full border border-white/10 text-xs text-zinc-300">
            {lang === "zh" ? `透明混合: ${Math.round(percent)}%` : `Blend: ${Math.round(percent)}%`}
          </div>
        </div>
      ) : (
        /* Default Split Slider */
        <div
          ref={containerRef}
          tabIndex={0}
          role="slider"
          aria-label="Before/After Image Comparison"
          aria-valuenow={Math.round(percent)}
          aria-valuemin={0}
          aria-valuemax={100}
          onKeyDown={handleKeyDown}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          className="relative w-full aspect-[16/10] overflow-hidden rounded-xl bg-zinc-950 border border-white/10 select-none cursor-ew-resize shadow-2xl group focus:outline-none focus:ring-2 focus:ring-sky-500/50"
        >
          {/* Layer 1: Bottom Image (Before) */}
          <img
            src={beforeSrc}
            alt={`Before: ${alt}`}
            className="absolute inset-0 w-full h-full object-cover pointer-events-none"
          />

          {/* Layer 2: Top Image (After) */}
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
            <div className="w-[2px] h-full bg-sky-400 shadow-[0_0_14px_#38bdf8]" />
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
      )}

      {/* Control Toolbar */}
      {showControls && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-400 pt-1">
          {/* Preset Percentage Buttons */}
          <div className="flex items-center gap-1.5 bg-zinc-900/80 p-1 rounded-xl border border-white/5">
            <button
              type="button"
              onClick={() => setPercent(0)}
              className={`px-2.5 py-1 rounded-lg font-medium transition-colors ${
                percent === 0
                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                  : "hover:text-white"
              }`}
            >
              {t.splitPreset100Before}
            </button>
            <button
              type="button"
              onClick={() => setPercent(50)}
              className={`px-2.5 py-1 rounded-lg font-medium transition-colors ${
                percent === 50
                  ? "bg-sky-500/20 text-sky-300 border border-sky-500/30"
                  : "hover:text-white"
              }`}
            >
              {t.splitPreset50}
            </button>
            <button
              type="button"
              onClick={() => setPercent(100)}
              className={`px-2.5 py-1 rounded-lg font-medium transition-colors ${
                percent === 100
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                  : "hover:text-white"
              }`}
            >
              {t.splitPreset100After}
            </button>
          </div>

          {/* View Mode Switcher */}
          <div className="flex items-center gap-1 bg-zinc-900/80 p-1 rounded-xl border border-white/5">
            <button
              type="button"
              onClick={() => setViewMode("split")}
              className={`px-2.5 py-1 rounded-lg font-medium transition-colors flex items-center gap-1 ${
                viewMode === "split"
                  ? "bg-white/10 text-white shadow-sm"
                  : "hover:text-white"
              }`}
              title={t.viewModeSplit}
            >
              <SlidersHorizontal size={12} />
              <span>{t.viewModeSplit}</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("side-by-side")}
              className={`px-2.5 py-1 rounded-lg font-medium transition-colors flex items-center gap-1 ${
                viewMode === "side-by-side"
                  ? "bg-white/10 text-white shadow-sm"
                  : "hover:text-white"
              }`}
              title={t.viewModeSideBySide}
            >
              <Columns2 size={12} />
              <span>{t.viewModeSideBySide}</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("fade")}
              className={`px-2.5 py-1 rounded-lg font-medium transition-colors flex items-center gap-1 ${
                viewMode === "fade"
                  ? "bg-white/10 text-white shadow-sm"
                  : "hover:text-white"
              }`}
              title={t.viewModeFade}
            >
              <Layers size={12} />
              <span>{t.viewModeFade}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
