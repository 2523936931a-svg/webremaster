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
  Sparkles,
  ThumbsUp,
  MessageSquare,
  Bookmark,
  Sun,
  Moon,
  Search,
  RotateCcw,
} from "lucide-react";

export interface SkinDetailModalProps {
  skin: SkinManifest | null;
  lang: Language;
  onClose: () => void;
}

export const SkinDetailModal: React.FC<SkinDetailModalProps> = ({ skin, lang, onClose }) => {
  const [activeTab, setActiveTab] = useState<"slider" | "gates" | "source" | "sandbox">("slider");
  const [sourceCode, setSourceCode] = useState<{ adapter?: string; app?: string }>({});
  const [copied, setCopied] = useState<boolean>(false);
  const t = DICTIONARY[lang];

  // 交互沙箱状态
  const [sandboxSearch, setSandboxSearch] = useState("");
  const [sandboxItems, setSandboxItems] = useState([
    {
      id: 1,
      title: `${skin?.name ?? "目标站点"} 核心架构与现代化重制实践`,
      author: "agent-native",
      points: 248,
      upvoted: false,
      bookmarked: false,
      comments: [
        "重制后的界面排版与响应式太舒适了，完全没有 1998 年的局促感！",
        "最关键的是原生 Cookie 和登录状态完全保持，无需二次登录。",
      ],
      commentsOpen: false,
    },
    {
      id: 2,
      title: "W3C View Transitions 与 TurboNav 零闪烁无刷新漫游体验",
      author: "dan_abramov",
      points: 189,
      upvoted: false,
      bookmarked: true,
      comments: ["页面切换拥有原生 App 般的 GPU 交叉渐变，非常精致。"],
      commentsOpen: false,
    },
    {
      id: 3,
      title: "纯本地离线执行基准测试：零 Token 消耗与零云端依赖",
      author: "rich_harris",
      points: 432,
      upvoted: true,
      bookmarked: false,
      comments: [],
      commentsOpen: false,
    },
  ]);
  const [sandboxTheme, setSandboxTheme] = useState<"dark" | "light" | "sepia">("dark");

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
          <button
            onClick={() => setActiveTab("sandbox")}
            className={`pb-3 px-3 font-medium transition-colors border-b-2 flex items-center gap-1.5 ${
              activeTab === "sandbox"
                ? "border-sky-400 text-sky-400"
                : "border-transparent text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <Sparkles size={14} className="text-amber-400" />
            <span>{t.liveSandbox}</span>
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

          {activeTab === "sandbox" && (
            <div className="flex flex-col gap-4 animate-in fade-in duration-150">
              {/* 沙箱状态栏与环境指纹 */}
              <div className="p-3.5 rounded-xl bg-gradient-to-r from-sky-950/40 via-zinc-900/60 to-purple-950/40 border border-sky-500/20 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="font-semibold text-white">WebRemaster 虚拟运行时沙箱</span>
                  <span className="text-zinc-400">· 零安装直接试玩微内核交互</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-zinc-800 text-[11px] font-mono text-zinc-300">
                    Shadow DOM · 60 FPS
                  </span>
                  {/* 主题切换 */}
                  <div className="flex items-center rounded-lg bg-zinc-900 border border-white/10 p-0.5">
                    <button
                      type="button"
                      onClick={() => setSandboxTheme("dark")}
                      className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                        sandboxTheme === "dark" ? "bg-sky-500 text-zinc-950 font-bold" : "text-zinc-400 hover:text-white"
                      }`}
                    >
                      Dark
                    </button>
                    <button
                      type="button"
                      onClick={() => setSandboxTheme("light")}
                      className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                        sandboxTheme === "light" ? "bg-sky-500 text-zinc-950 font-bold" : "text-zinc-400 hover:text-white"
                      }`}
                    >
                      Light
                    </button>
                    <button
                      type="button"
                      onClick={() => setSandboxTheme("sepia")}
                      className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                        sandboxTheme === "sepia" ? "bg-sky-500 text-zinc-950 font-bold" : "text-zinc-400 hover:text-white"
                      }`}
                    >
                      Sepia
                    </button>
                  </div>
                </div>
              </div>

              {/* 模拟页面微应用容器 */}
              <div
                className={`rounded-xl border transition-all p-4 flex flex-col gap-3 shadow-inner ${
                  sandboxTheme === "dark"
                    ? "bg-zinc-950 border-white/10 text-zinc-100"
                    : sandboxTheme === "light"
                    ? "bg-zinc-50 border-zinc-200 text-zinc-900"
                    : "bg-[#fbf0d9] border-[#e4d4b2] text-[#433422]"
                }`}
              >
                {/* 搜索过滤条 */}
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search
                      size={14}
                      className={`absolute left-3 top-2.5 ${
                        sandboxTheme === "light" ? "text-zinc-400" : sandboxTheme === "sepia" ? "text-[#8c7355]" : "text-zinc-500"
                      }`}
                    />
                    <input
                      type="text"
                      value={sandboxSearch}
                      onChange={(e) => setSandboxSearch(e.target.value)}
                      placeholder={lang === "zh" ? "在试玩条目中即时检索..." : "Live filter items in sandbox..."}
                      className={`w-full text-xs pl-8 pr-3 py-2 rounded-lg border outline-none transition-colors ${
                        sandboxTheme === "dark"
                          ? "bg-zinc-900/80 border-white/10 text-white placeholder-zinc-500 focus:border-sky-500"
                          : sandboxTheme === "light"
                          ? "bg-white border-zinc-300 text-zinc-900 placeholder-zinc-400 focus:border-sky-500"
                          : "bg-[#f4e6cb] border-[#dfceaa] text-[#433422] placeholder-[#8c7355] focus:border-[#a07840]"
                      }`}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSandboxSearch("");
                      setSandboxItems([
                        {
                          id: 1,
                          title: `${skin.name} 核心架构与现代化重制实践`,
                          author: "agent-native",
                          points: 248,
                          upvoted: false,
                          bookmarked: false,
                          comments: [
                            "重制后的界面排版与响应式太舒适了，完全没有 1998 年的局促感！",
                            "最关键的是原生 Cookie 和登录状态完全保持，无需二次登录。",
                          ],
                          commentsOpen: false,
                        },
                        {
                          id: 2,
                          title: "W3C View Transitions 与 TurboNav 零闪烁无刷新漫游体验",
                          author: "dan_abramov",
                          points: 189,
                          upvoted: false,
                          bookmarked: true,
                          comments: ["页面切换拥有原生 App 般的 GPU 交叉渐变，非常精致。"],
                          commentsOpen: false,
                        },
                        {
                          id: 3,
                          title: "纯本地离线执行基准测试：零 Token 消耗与零云端依赖",
                          author: "rich_harris",
                          points: 432,
                          upvoted: true,
                          bookmarked: false,
                          comments: [],
                          commentsOpen: false,
                        },
                      ]);
                    }}
                    className={`p-2 rounded-lg border transition-colors ${
                      sandboxTheme === "dark"
                        ? "bg-zinc-900 border-white/10 text-zinc-400 hover:text-white"
                        : sandboxTheme === "light"
                        ? "bg-white border-zinc-300 text-zinc-600 hover:text-zinc-900"
                        : "bg-[#f4e6cb] border-[#dfceaa] text-[#8c7355] hover:text-[#433422]"
                    }`}
                    title="重置试玩数据"
                  >
                    <RotateCcw size={14} />
                  </button>
                </div>

                {/* 交互条目流 */}
                <div className="flex flex-col gap-2.5">
                  {sandboxItems
                    .filter((item) =>
                      sandboxSearch.trim() === ""
                        ? true
                        : item.title.toLowerCase().includes(sandboxSearch.toLowerCase()) ||
                          item.author.toLowerCase().includes(sandboxSearch.toLowerCase())
                    )
                    .map((item) => (
                      <div
                        key={item.id}
                        className={`p-3 rounded-lg border transition-all ${
                          sandboxTheme === "dark"
                            ? "bg-zinc-900/60 border-white/5 hover:border-white/20"
                            : sandboxTheme === "light"
                            ? "bg-white border-zinc-200 hover:border-zinc-300 shadow-sm"
                            : "bg-[#fdf8ee] border-[#e8dac0] hover:border-[#cfbd9a]"
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          {/* 点赞按钮 */}
                          <button
                            type="button"
                            onClick={() => {
                              setSandboxItems((prev) =>
                                prev.map((it) =>
                                  it.id === item.id
                                    ? {
                                        ...it,
                                        upvoted: !it.upvoted,
                                        points: it.upvoted ? it.points - 1 : it.points + 1,
                                      }
                                    : it
                                )
                              );
                            }}
                            className={`flex flex-col items-center justify-center min-w-[42px] px-2 py-1.5 rounded-lg border text-xs font-bold transition-all ${
                              item.upvoted
                                ? "bg-sky-500/20 border-sky-500 text-sky-400 scale-105"
                                : sandboxTheme === "dark"
                                ? "bg-zinc-800/80 border-white/5 text-zinc-400 hover:text-white"
                                : sandboxTheme === "light"
                                ? "bg-zinc-100 border-zinc-200 text-zinc-600 hover:text-zinc-900"
                                : "bg-[#f4e6cb] border-[#dfceaa] text-[#8c7355] hover:text-[#433422]"
                            }`}
                            title="点击模拟双向状态桥接：原生赞数递增"
                          >
                            <ThumbsUp size={12} className={item.upvoted ? "fill-sky-400" : ""} />
                            <span>{item.points}</span>
                          </button>

                          {/* 内容 */}
                          <div className="flex-1 min-w-0">
                            <h5 className="text-xs font-semibold leading-snug line-clamp-2">
                              {item.title}
                            </h5>
                            <div className="flex items-center gap-3 mt-1.5 text-[11px] text-zinc-500">
                              <span>by @{item.author}</span>
                              <button
                                type="button"
                                onClick={() => {
                                  setSandboxItems((prev) =>
                                    prev.map((it) =>
                                      it.id === item.id
                                        ? { ...it, commentsOpen: !it.commentsOpen }
                                        : it
                                    )
                                  );
                                }}
                                className="inline-flex items-center gap-1 hover:text-sky-400 transition-colors"
                              >
                                <MessageSquare size={11} />
                                <span>{item.comments.length} 条讨论</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setSandboxItems((prev) =>
                                    prev.map((it) =>
                                      it.id === item.id
                                        ? { ...it, bookmarked: !it.bookmarked }
                                        : it
                                    )
                                  );
                                }}
                                className={`inline-flex items-center gap-1 transition-colors ${
                                  item.bookmarked ? "text-amber-400 font-medium" : "hover:text-zinc-300"
                                }`}
                              >
                                <Bookmark size={11} className={item.bookmarked ? "fill-amber-400" : ""} />
                                <span>{item.bookmarked ? "已收藏" : "收藏"}</span>
                              </button>
                            </div>

                            {/* 展开的讨论 */}
                            {item.commentsOpen && (
                              <div
                                className={`mt-2.5 pt-2 border-t flex flex-col gap-1.5 text-[11px] ${
                                  sandboxTheme === "dark"
                                    ? "border-white/10 text-zinc-300"
                                    : sandboxTheme === "light"
                                    ? "border-zinc-200 text-zinc-700"
                                    : "border-[#e8dac0] text-[#5c4a36]"
                                }`}
                              >
                                {item.comments.length > 0 ? (
                                  item.comments.map((c, i) => (
                                    <div key={i} className="flex items-start gap-1.5">
                                      <span className="text-sky-400 font-mono">↳</span>
                                      <span className="leading-relaxed">{c}</span>
                                    </div>
                                  ))
                                ) : (
                                  <div className="italic text-zinc-500">暂无讨论，点击原生输入框发表评论</div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              </div>

              {/* 底部直接安装激励条 */}
              <div className="p-3.5 rounded-xl bg-zinc-900/60 border border-white/5 flex items-center justify-between">
                <span className="text-xs text-zinc-400">
                  {lang === "zh"
                    ? "试玩满意？安装油猴脚本即可在真实网站上立即生效"
                    : "Ready to remaster? Install the userscript directly in your browser."}
                </span>
                <a
                  href={userscriptUrl}
                  download
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-zinc-950 font-bold text-xs transition-colors shadow-sm"
                >
                  <Download size={13} />
                  <span>{t.installUserscript}</span>
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
