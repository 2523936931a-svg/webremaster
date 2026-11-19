import React from "react";
import { DICTIONARY, type Language } from "../i18n.js";
import { Github, Globe, Sparkles, Download } from "lucide-react";

export interface HeaderProps {
  lang: Language;
  onToggleLang: () => void;
}

export const Header: React.FC<HeaderProps> = ({ lang, onToggleLang }) => {
  const t = DICTIONARY[lang];

  return (
    <header className="sticky top-0 z-50 w-full backdrop-blur-xl bg-zinc-950/80 border-b border-white/5">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand Logo */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-sky-600 to-sky-400 flex items-center justify-center text-white font-extrabold text-lg shadow-lg shadow-sky-500/20">
            W
          </div>
          <div className="flex flex-col">
            <span className="font-bold text-base tracking-tight text-white flex items-center gap-2">
              WebRemaster
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20">
                v0.1.0
              </span>
            </span>
            <span className="text-xs text-zinc-400">
              {lang === "zh" ? "老旧网站次世代重制编译器" : "Legacy Web Remaster Compiler"}
            </span>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-3">
          {/* Language Toggle */}
          <button
            onClick={onToggleLang}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 border border-white/10 hover:border-white/20 text-xs font-medium text-zinc-300 transition-colors"
            title="Toggle Language / 切换中英文"
          >
            <Globe size={13} className="text-sky-400" />
            <span>{lang === "zh" ? "English" : "简体中文"}</span>
          </button>

          {/* GitHub Star */}
          <a
            href="https://github.com/webremaster/webremaster"
            target="_blank"
            rel="noreferrer"
            className="hidden sm:flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-zinc-900 border border-white/10 hover:border-white/20 text-xs font-medium text-zinc-300 hover:text-white transition-colors"
          >
            <Github size={14} />
            <span>Star</span>
            <span className="px-1.5 py-0.2 bg-white/10 rounded text-[10px] text-zinc-400">
              1.2k+
            </span>
          </a>

          {/* Chrome Extension CTA */}
          <a
            href="./release/webremaster-chrome-ext.zip"
            download
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-zinc-950 font-semibold text-xs transition-colors shadow-lg shadow-sky-500/20"
          >
            <Download size={14} />
            <span>{t.installExtension}</span>
          </a>
        </div>
      </div>
    </header>
  );
};
