import React from "react";
import { DICTIONARY, type Language } from "../i18n.js";
import { Github, Globe, Heart } from "lucide-react";

export interface FooterProps {
  lang: Language;
}

export const Footer: React.FC<FooterProps> = ({ lang }) => {
  return (
    <footer className="w-full py-12 bg-zinc-950 border-t border-white/5 text-zinc-500 text-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-sky-500/10 text-sky-400 border border-sky-500/20 flex items-center justify-center font-bold">
            W
          </div>
          <div>
            <div className="font-semibold text-zinc-300">WebRemaster</div>
            <div className="text-[11px] text-zinc-500">
              Open source project licensed under MIT.
            </div>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <a
            href="https://github.com/webremaster/webremaster"
            target="_blank"
            rel="noreferrer"
            className="hover:text-zinc-300 transition-colors flex items-center gap-1.5"
          >
            <Github size={14} />
            <span>GitHub</span>
          </a>
          <a
            href="https://news.ycombinator.com"
            target="_blank"
            rel="noreferrer"
            className="hover:text-zinc-300 transition-colors"
          >
            Hacker News
          </a>
          <a
            href="https://arxiv.org"
            target="_blank"
            rel="noreferrer"
            className="hover:text-zinc-300 transition-colors"
          >
            arXiv
          </a>
        </div>
      </div>
    </footer>
  );
};
