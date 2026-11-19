import React from "react";
import { DICTIONARY, type Language } from "../i18n.js";
import { BeforeAfterSlider } from "./BeforeAfterSlider.js";
import { Sparkles, Download, Github, ShieldCheck, Zap } from "lucide-react";

export interface HeroProps {
  lang: Language;
}

export const Hero: React.FC<HeroProps> = ({ lang }) => {
  const t = DICTIONARY[lang];

  return (
    <section className="relative pt-12 pb-20 overflow-hidden">
      {/* Background radial gradient glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[500px] bg-sky-500/10 rounded-full blur-[140px] pointer-events-none" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          {/* Left Column: Headlines & Actions */}
          <div className="lg:col-span-5 flex flex-col gap-6 text-left">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-sky-500/10 border border-sky-500/20 text-sky-400 text-xs font-medium w-fit">
              <Sparkles size={13} />
              <span>
                {lang === "zh"
                  ? "零 Token 编译期 AI 重制架构"
                  : "Zero-Token Compiler Architecture"}
              </span>
            </div>

            <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-white leading-[1.15]">
              {t.heroTitle1} <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-sky-400 via-sky-300 to-indigo-400">
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
                <ShieldCheck size={14} className="text-sky-400" />
                <span>Shadow DOM 样式隔离</span>
              </div>
              <div className="flex items-center gap-2">
                <ShieldCheck size={14} className="text-sky-400" />
                <span>双向原生状态桥接</span>
              </div>
              <div className="flex items-center gap-2">
                <ShieldCheck size={14} className="text-sky-400" />
                <span>Playwright 6重门禁验收</span>
              </div>
              <div className="flex items-center gap-2">
                <ShieldCheck size={14} className="text-sky-400" />
                <span>Alt+Shift+R 0ms 逃生开关</span>
              </div>
            </div>
          </div>

          {/* Right Column: Interactive Giant Before/After Showcase */}
          <div className="lg:col-span-7 flex flex-col items-center">
            <div className="w-full relative">
              <BeforeAfterSlider
                beforeSrc="./data/skins/hackernews/before.png"
                afterSrc="./data/skins/hackernews/after.png"
                alt="Hacker News Before/After Remaster"
                initialPercent={50}
                lang={lang}
                className="glow-sky"
              />
            </div>
            <span className="text-xs text-zinc-500 mt-2">
              {lang === "zh"
                ? "💡 左右拖拽滑块或点击下方按钮，亲眼见证 1998 原版到 2026 次世代界面的蜕变"
                : "💡 Drag the glowing divider or click buttons below to inspect the transformation"}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
};
