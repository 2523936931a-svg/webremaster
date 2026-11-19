import React, { useState } from "react";
import { DICTIONARY, type Language } from "../i18n.js";
import type { SkinManifest } from "@webremaster/schema";
import {
  Download,
  Eye,
  CheckCircle2,
  ExternalLink,
  SlidersHorizontal,
  Flame,
  Layers,
} from "lucide-react";

export interface SkinCardProps {
  skin: SkinManifest;
  lang: Language;
  onOpenDetails: (skin: SkinManifest) => void;
}

export const SkinCard: React.FC<SkinCardProps> = ({ skin, lang, onOpenDetails }) => {
  const [isHovered, setIsHovered] = useState<boolean>(false);
  const t = DICTIONARY[lang];

  const tagline = lang === "zh" ? skin.tagline.zh : skin.tagline.en;
  const userscriptUrl = `./data/skins/${skin.id}/${skin.userscriptFile}`;
  const beforeUrl = `./data/skins/${skin.id}/${skin.beforeImage}`;
  const afterUrl = `./data/skins/${skin.id}/${skin.afterImage}`;

  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="flex flex-col rounded-2xl bg-zinc-900/40 border border-white/5 hover:border-sky-500/30 transition-all duration-300 overflow-hidden glow-card group"
    >
      {/* Top Preview Image with Smooth Hover Wipe */}
      <div
        onClick={() => onOpenDetails(skin)}
        className="relative w-full aspect-[16/10] bg-zinc-950 overflow-hidden cursor-pointer"
      >
        {/* Layer 1: Before Image */}
        <img
          src={beforeUrl}
          alt={`Original ${skin.name}`}
          className="absolute inset-0 w-full h-full object-cover"
        />

        {/* Layer 2: After Image, clipped on hover */}
        <div
          className="absolute inset-0 w-full h-full transition-all duration-500 ease-out"
          style={{
            clipPath: isHovered ? "inset(0 0 0 0)" : "inset(0 50% 0 0)",
          }}
        >
          <img
            src={afterUrl}
            alt={`Remastered ${skin.name}`}
            className="absolute inset-0 w-full h-full object-cover"
          />
        </div>

        {/* Floating Badges */}
        <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5 z-10">
          <span className="px-2 py-0.5 text-[10px] font-semibold rounded bg-zinc-950/80 text-zinc-300 border border-white/10 backdrop-blur-md">
            {skin.category}
          </span>
          <span className="px-2 py-0.5 text-[10px] font-mono rounded bg-zinc-950/80 text-sky-400 border border-sky-500/20 backdrop-blur-md">
            {skin.archetype}
          </span>
        </div>

        <div className="absolute bottom-2.5 right-2.5 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
          <span className="px-2.5 py-1 text-[11px] font-medium rounded-lg bg-sky-500 text-zinc-950 flex items-center gap-1 shadow-lg">
            <Eye size={12} />
            <span>{t.viewDetails}</span>
          </span>
        </div>
      </div>

      {/* Content Body */}
      <div className="p-5 flex-1 flex flex-col justify-between gap-4">
        <div>
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-white group-hover:text-sky-300 transition-colors">
              {skin.name}
            </h3>
            <a
              href={skin.targetUrl}
              target="_blank"
              rel="noreferrer"
              title="Visit original website"
              className="text-zinc-500 hover:text-zinc-300 transition-colors p-1"
            >
              <ExternalLink size={14} />
            </a>
          </div>

          <p className="text-xs text-zinc-400 mt-2 line-clamp-2 leading-relaxed">
            {tagline}
          </p>

          {/* PowerUp Pills */}
          <div className="flex flex-wrap gap-1.5 mt-3">
            {skin.enhancements.slice(0, 4).map((enh) => (
              <span
                key={enh}
                className="px-2 py-0.5 text-[10px] rounded bg-white/5 text-zinc-300 border border-white/5"
              >
                {enh}
              </span>
            ))}
          </div>
        </div>

        {/* Quality Metrics */}
        <div className="pt-3 border-t border-white/5 flex items-center justify-between text-xs text-zinc-400">
          <div className="flex items-center gap-1 text-emerald-400">
            <CheckCircle2 size={13} />
            <span className="font-semibold">{skin.vlmScore}</span>
            <span className="text-[10px] text-zinc-500">/ 10 VLM</span>
          </div>

          <div className="flex items-center gap-1 text-zinc-400">
            <span>{t.dataParity}:</span>
            <span className="font-mono text-white">
              {Math.round(skin.dataParityRatio * 100)}%
            </span>
          </div>

          <div className="text-[11px] font-mono text-zinc-500">
            {Math.round(skin.bundleSizeKb)} KB
          </div>
        </div>

        {/* Bottom Actions */}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <a
            href={userscriptUrl}
            download
            className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 border border-sky-500/30 font-semibold text-xs transition-colors"
          >
            <Download size={13} />
            <span>.user.js</span>
          </a>

          <button
            onClick={() => onOpenDetails(skin)}
            className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium text-xs transition-colors"
          >
            <SlidersHorizontal size={13} />
            <span>{t.viewDetails}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
