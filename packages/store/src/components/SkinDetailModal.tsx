import React, { useState, useEffect } from "react";
import { DICTIONARY, type Language } from "../i18n.js";
import type { SkinManifest } from "@webremaster/schema";
import { BeforeAfterSlider } from "./BeforeAfterSlider.js";
import {
  X,
  Download,
  ExternalLink,
  ShieldCheck,
  CheckCircle2,
  Code2,
  Layers,
  FileText,
  Copy,
  Check,
} from "lucide-react";

export interface SkinDetailModalProps {
  skin: SkinManifest | null;
  lang: Language;
  onClose: () => void;
}

export const SkinDetailModal: React.FC<SkinDetailModalProps> = ({ skin, lang, onClose }) => {
  const [activeTab, setActiveTab] = useState<"slider" | "gates" | "source">("slider");
  const [sourceCode, setSourceCode] = useState<{ adapter?: string; app?: string }>({});
  const [copied, setCopied] = useState<boolean>(false);
  const t = DICTIONARY[lang];

  useEffect(() => {
    if (!skin) return;

    // 尝试异步拉取源码
    const fetchSource = async () => {
      try {
        const [adapterRes, appRes] = await Promise.all([
          fetch(`./data/skins/${skin.id}/src/adapter.ts`),
          fetch(`./data/skins/${skin.id}/src/SkinApp.tsx`),
        ]);
        const adapter = adapterRes.ok ? await adapterRes.text() : "// adapter.ts";
        const app = appRes.ok ? await appRes.text() : "// SkinApp.tsx";
        setSourceCode({ adapter, app });
      } catch {
        // ignore
      }
    };
    fetchSource();
  }, [skin]);

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [onClose]);

  if (!skin) return null;

  const tagline = lang === "zh" ? skin.tagline.zh : skin.tagline.en;
  const beforeUrl = `./data/skins/${skin.id}/${skin.beforeImage}`;
  const afterUrl = `./data/skins/${skin.id}/${skin.afterImage}`;
  const userscriptUrl = `./data/skins/${skin.id}/${skin.userscriptFile}`;

  const gates = [
    { name: "zero-runtime-errors", label: "0 运行时错误 (pageerror=0, console.error=0)" },
    { name: "zero-flash-curtain-lifted", label: "零闪烁幕帘揭起 (data-wr-ready=true)" },
    { name: "data-parity-and-health", label: `数据对齐率 ≥ 90% (当前 ${Math.round(skin.dataParityRatio * 100)}%)` },
    { name: "no-broken-render", label: "无样式破损 (无溢出、无 undefined/NaN)" },
    { name: "bridge-and-split-smoke", label: "Alt+Shift+R 三态瞬切与原生状态桥接" },
    { name: "portal-and-turbonav-integrity", label: "TurboNav 0ms 预取与同源无刷新导航" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-4xl max-h-[92vh] flex flex-col rounded-2xl bg-zinc-950 border border-white/10 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/10 bg-zinc-900/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-600 to-sky-400 flex items-center justify-center text-white font-extrabold text-lg">
              {skin.name.charAt(0)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-white">{skin.name}</h2>
                <span className="px-2 py-0.5 text-xs rounded bg-sky-500/10 text-sky-400 border border-sky-500/20 font-medium">
                  {skin.category}
                </span>
                <span className="text-xs font-mono text-zinc-500">
                  v{skin.version}
                </span>
              </div>
              <a
                href={skin.targetUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-zinc-400 hover:text-sky-400 flex items-center gap-1 mt-0.5"
              >
                <span>{skin.targetUrl}</span>
                <ExternalLink size={12} />
              </a>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                const fullUrl = new URL(userscriptUrl, window.location.href).href;
                navigator.clipboard?.writeText(fullUrl);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-xl bg-zinc-900 border border-white/10 hover:border-white/20 text-zinc-300 hover:text-white font-medium text-xs transition-colors"
              title={lang === "zh" ? "复制脚本安装地址" : "Copy script URL"}
            >
              {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
              <span>{copied ? (lang === "zh" ? "已复制" : "Copied") : (lang === "zh" ? "复制链接" : "Copy URL")}</span>
            </button>

            <a
              href={userscriptUrl}
              download
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-zinc-950 font-bold text-xs transition-colors shadow-lg shadow-sky-500/20"
            >
              <Download size={14} />
              <span>{t.installUserscript}</span>
            </a>

            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-zinc-900 border border-white/10 hover:border-white/20 text-zinc-400 hover:text-white transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center gap-2 px-6 pt-3 border-b border-white/5 bg-zinc-900/20 text-xs">
          <button
            onClick={() => setActiveTab("slider")}
            className={`pb-3 px-3 font-medium transition-colors border-b-2 ${
              activeTab === "slider"
                ? "border-sky-400 text-sky-400"
                : "border-transparent text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {t.viewDetails} (Before/After)
          </button>
          <button
            onClick={() => setActiveTab("gates")}
            className={`pb-3 px-3 font-medium transition-colors border-b-2 flex items-center gap-1.5 ${
              activeTab === "gates"
                ? "border-sky-400 text-sky-400"
                : "border-transparent text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <ShieldCheck size={14} />
            <span>{t.verificationReport}</span>
          </button>
          <button
            onClick={() => setActiveTab("source")}
            className={`pb-3 px-3 font-medium transition-colors border-b-2 flex items-center gap-1.5 ${
              activeTab === "source"
                ? "border-sky-400 text-sky-400"
                : "border-transparent text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <Code2 size={14} />
            <span>{t.sourceCode}</span>
          </button>
        </div>

        {/* Body Content */}
        <div className="p-6 overflow-y-auto flex-1 flex flex-col gap-6">
          {activeTab === "slider" && (
            <div className="flex flex-col gap-6">
              <BeforeAfterSlider
                beforeSrc={beforeUrl}
                afterSrc={afterUrl}
                alt={skin.name}
                initialPercent={50}
                lang={lang}
              />

              <div className="p-4 rounded-xl bg-zinc-900/40 border border-white/5 flex flex-col gap-3">
                <h4 className="text-sm font-semibold text-white">
                  {lang === "zh" ? "设计与功能说明" : "Design & Architectural Highlights"}
                </h4>
                <p className="text-xs text-zinc-300 leading-relaxed">{tagline}</p>

                <div className="pt-2">
                  <span className="text-xs font-medium text-zinc-400">
                    {t.enhancedFeatures}：
                  </span>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {skin.enhancements.map((enh) => (
                      <span
                        key={enh}
                        className="px-2.5 py-1 text-xs rounded-lg bg-sky-500/10 text-sky-300 border border-sky-500/20"
                      >
                        {enh}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "gates" && (
            <div className="flex flex-col gap-4">
              <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <CheckCircle2 size={24} className="text-emerald-400" />
                  <div>
                    <h4 className="text-sm font-bold text-white">
                      Playwright 真浏览器 6 重硬门禁全绿
                    </h4>
                    <span className="text-xs text-emerald-300/80">
                      通过自动化回归校验，功能与原生事件 100% 存活，无任何运行时破损
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-extrabold text-emerald-400">
                    {skin.vlmScore} / 10
                  </div>
                  <span className="text-[10px] text-zinc-400">VLM 视觉评审得分</span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {gates.map((g, idx) => (
                  <div
                    key={g.name}
                    className="p-3.5 rounded-xl bg-zinc-900/40 border border-white/5 flex items-start gap-3"
                  >
                    <div className="mt-0.5 w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-xs">
                      {idx + 1}
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-zinc-200">
                        {g.label}
                      </div>
                      <span className="text-[11px] font-mono text-zinc-500">
                        Gate: {g.name}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === "source" && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>生成的纯 TypeScript 桥接与 React 挂载代码：</span>
                <span className="font-mono text-sky-400">
                  {Math.round(skin.bundleSizeKb)} KB 打包单文件
                </span>
              </div>

              <div className="flex flex-col gap-3">
                <div className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
                  <FileText size={14} className="text-sky-400" />
                  <span>skins/{skin.id}/src/adapter.ts</span>
                </div>
                <pre className="p-4 rounded-xl bg-zinc-900 border border-white/10 text-xs font-mono text-zinc-300 overflow-x-auto max-h-60">
                  {sourceCode.adapter || "// Loading adapter..."}
                </pre>

                <div className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5 mt-2">
                  <FileText size={14} className="text-sky-400" />
                  <span>skins/{skin.id}/src/SkinApp.tsx</span>
                </div>
                <pre className="p-4 rounded-xl bg-zinc-900 border border-white/10 text-xs font-mono text-zinc-300 overflow-x-auto max-h-60">
                  {sourceCode.app || "// Loading SkinApp..."}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
