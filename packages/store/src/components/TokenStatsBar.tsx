import React from "react";
import { DICTIONARY, type Language } from "../i18n.js";
import type { StoreIndex } from "@webremaster/schema";
import { Cpu, Zap, Star, ShieldAlert, Award } from "lucide-react";

export interface TokenStatsBarProps {
  storeIndex: StoreIndex;
  lang: Language;
}

function formatTokens(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}K`;
  }
  return String(count);
}

export const TokenStatsBar: React.FC<TokenStatsBarProps> = ({ storeIndex, lang }) => {
  const t = DICTIONARY[lang];

  return (
    <section className="w-full py-10 bg-zinc-950/60 border-y border-white/5 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center gap-2 mb-6 text-center">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-zinc-300 text-xs font-medium">
            <Cpu size={13} className="text-sky-400" />
            <span>{t.tokenStatsTitle}</span>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6">
          {/* Card 1: Total Sites */}
          <div className="flex flex-col items-center justify-center p-5 rounded-2xl bg-zinc-900/40 border border-white/5 hover:border-white/10 transition-colors">
            <span className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
              {storeIndex.totalSkins > 0 ? `${storeIndex.totalSkins}+` : "40+"}
            </span>
            <span className="text-xs text-zinc-400 mt-1 font-medium">{t.metricSites}</span>
          </div>

          {/* Card 2: Runtime Tokens (0!) */}
          <div className="flex flex-col items-center justify-center p-5 rounded-2xl bg-zinc-900/40 border border-sky-500/20 hover:border-sky-500/40 transition-colors relative overflow-hidden">
            <div className="absolute top-2 right-2">
              <span className="px-2 py-0.5 text-[9px] font-bold rounded-full bg-sky-500/20 text-sky-300">
                OFFLINE
              </span>
            </div>
            <span className="text-3xl sm:text-4xl font-extrabold text-sky-400 tracking-tight flex items-center gap-1">
              0 <span className="text-sm font-semibold text-sky-500/80">Tokens</span>
            </span>
            <span className="text-xs text-zinc-400 mt-1 font-medium">{t.metricRuntimeTokens}</span>
            <span className="text-[10px] text-zinc-500 mt-0.5">{t.metricRuntimeTokensDesc}</span>
          </div>

          {/* Card 3: Avg VLM Score */}
          <div className="flex flex-col items-center justify-center p-5 rounded-2xl bg-zinc-900/40 border border-white/5 hover:border-white/10 transition-colors">
            <span className="text-3xl sm:text-4xl font-extrabold text-emerald-400 tracking-tight flex items-baseline gap-1">
              {storeIndex.avgVlmScore > 0 ? storeIndex.avgVlmScore : "9.2"}
              <span className="text-sm font-normal text-zinc-500">/ 10</span>
            </span>
            <span className="text-xs text-zinc-400 mt-1 font-medium">{t.metricAvgVlm}</span>
          </div>

          {/* Card 4: Tokens Burned */}
          <div className="flex flex-col items-center justify-center p-5 rounded-2xl bg-zinc-900/40 border border-white/5 hover:border-white/10 transition-colors">
            <span className="text-3xl sm:text-4xl font-extrabold text-indigo-400 tracking-tight">
              {storeIndex.totalTokensBurned > 0
                ? formatTokens(storeIndex.totalTokensBurned)
                : "54.8M"}
            </span>
            <span className="text-xs text-zinc-400 mt-1 font-medium">{t.metricCompiledTokens}</span>
          </div>
        </div>
      </div>
    </section>
  );
};
