import React, { useState } from "react";
import { DICTIONARY, type Language } from "../i18n.js";
import { BeforeAfterSlider } from "./BeforeAfterSlider.js";
import { Sparkles, Download, Github, ShieldCheck, Zap, Terminal } from "lucide-react";

export interface HeroProps {
  lang: Language;
}

interface DemoOption {
  id: string;
  label: string;
  beforeSrc: string;
  afterSrc: string;
  alt: string;
}

const DEMO_SITES: DemoOption[] = [
  {
    id: "hackernews",
    label: "Hacker News (1998 → 2026)",
    beforeSrc: "./data/skins/hackernews/before.png",
    afterSrc: "./data/skins/hackernews/after.png",
    alt: "Hacker News Before/After Remaster",
  },
];

export const Hero: React.FC<HeroProps> = ({ lang }) => {
  const [activeDemo, setActiveDemo] = useState<DemoOption>(DEMO_SITES[0]!);
  const t = DICTIONARY[lang];

  return (
    <section className="relative pt-12 pb-20 overflow-hidden bg-grid-mesh radial-top-mask">
      {/* Background ambient radial glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[550px] bg-sky-500/10 rounded-full blur-[150px] pointer-events-none" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          {/* Left Column: Headlines & Actions */}
          <div className="lg:col-span-5 flex flex-col gap-6 text-left">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-sky-500/10 border border-sky-500/20 text-sky-400 text-xs font-semibold w-fit shadow-[0_0_15px_rgba(56,189,248,0.15)]">
              <Sparkles size={13} />
              <span>
                {lang === "zh"
                  ? "零 Token 编译期 AI 重制架构 · 融合 Raycast / Arc 交互"
                  : "Zero-Token Compiler Architecture · Raycast & Arc Inspired"}
              </span>
            </div>

            <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-white leading-[1.12]">
              {t.heroTitle1} <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-sky-400 via-sky-200 to-indigo-300">
                {t.heroTitle2}
              </span>
            </h1>

            <p className="text-sm sm:text-base text-zinc-400 leading-relaxed">
              {t.heroSubtitle}
            </p>

            {/* CTA Buttons */}
            <div className="flex flex-wrap items-center gap-4 pt-2">
              <a
                href="#skins-matrix"
                className="px-6 py-3 rounded-xl bg-sky-500 hover:bg-sky-400 text-zinc-950 font-bold text-sm shadow-xl shadow-sky-500/20 transition-all flex items-center gap-2 hover:scale-[1.02]"
              >
                <Zap size={16} />
                <span>{lang === "zh" ? "探索 40+ 重制矩阵" : "Explore 40+ Remasters"}</span>
              </a>

              <a
                href="https://github.com/webremaster/webremaster"
                target="_blank"
                rel="noreferrer"
                className="px-6 py-3 rounded-xl bg-zinc-900 border border-white/10 hover:border-white/20 text-white font-semibold text-sm transition-all flex items-center gap-2 hover:bg-zinc-800"
              >
                <Github size={16} />
                <span>{t.githubRepo}</span>
              </a>
            </div>

            {/* Feature Bullets */}
            <div className="pt-4 grid grid-cols-2 gap-3 text-xs text-zinc-400 border-t border-white/5">
              <div className="flex items-center gap-2">
                <ShieldCheck size={14} className="text-sky-400 flex-shrink-0" />
                <span>Shadow DOM 样式隔离</span>
              </div>
              <div className="flex items-center gap-2">
                <ShieldCheck size={14} className="text-sky-400 flex-shrink-0" />
                <span>Portal Slot 原生虫洞</span>
              </div>
              <div className="flex items-center gap-2">
                <ShieldCheck size={14} className="text-sky-400 flex-shrink-0" />
                <span>Arc Zap 元素粉碎枪</span>
              </div>
              <div className="flex items-center gap-2">
                <ShieldCheck size={14} className="text-sky-400 flex-shrink-0" />
                <span>View Transitions 0ms 转场</span>
              </div>
            </div>
          </div>

          {/* Right Column: Interactive Giant Before/After Showcase */}
          <div className="lg:col-span-7 flex flex-col items-center">
            <div className="w-full relative">
              {/* Demo selector pill */}
              <div className="flex items-center justify-between pb-3">
                <span className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
                  <Terminal size={13} className="text-sky-400" />
                  <span>{activeDemo.label}</span>
                </span>
                <span className="text-[11px] font-mono text-zinc-500">
                  {lang === "zh" ? "交互式实时对比" : "Interactive Inspection"}
                </span>
              </div>

              <BeforeAfterSlider
                beforeSrc={activeDemo.beforeSrc}
                afterSrc={activeDemo.afterSrc}
                alt={activeDemo.alt}
                initialPercent={100}
                initialViewMode="fade"
                lang={lang}
                className="glow-sky"
              />
            </div>
            <span className="text-xs text-zinc-500 mt-2.5">
              {lang === "zh"
                ? "💡 首屏默认展示重制版成品；点「100% BEFORE」看 1998 原版，或切到分屏模式拖动中轴逐项对照"
                : "💡 Starts on the remastered result; hit “100% BEFORE” for the 1998 original, or switch to split mode and drag the divider"}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
};
