import React from "react";
import { DICTIONARY, type Language } from "../i18n.js";
import {
  Shield,
  Layers,
  Zap,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Cpu,
  Sparkles,
  Lock,
  GitBranch,
} from "lucide-react";

export interface ArchitectureComparisonProps {
  lang: Language;
}

export const ArchitectureComparison: React.FC<ArchitectureComparisonProps> = ({ lang }) => {
  const t = DICTIONARY[lang];

  const pillars = [
    {
      icon: Shield,
      title: lang === "zh" ? "100% Shadow DOM 样式气密隔离" : "100% Shadow DOM Hermetic Isolation",
      desc:
        lang === "zh"
          ? "彻底摒弃 Stylus / 油猴的 !important 全局 CSS 注入。WebRemaster 依托封闭 Shadow Root 与 Tailwind v4 @scope，彻底杜绝新旧样式双向渗透。"
          : "Eliminates leaky !important CSS injections. Isolated inside a hermetic Shadow Root with Tailwind v4 @scope, zero CSS collisions in either direction.",
      badge: "Zero Leakage",
    },
    {
      icon: GitBranch,
      title: lang === "zh" ? "Portal Slot 原生节点虫洞穿越" : "Portal Slot Native Node Wormhole",
      desc:
        lang === "zh"
          ? "不摧毁原网页 DOM！通过 usePortalSlot 将原站搜索框、登录状态和原生表格实时虫洞投射到现代 React 容器中，WebSocket、Cookie 与事件监听 100% 存活。"
          : "Never destroys original DOM. Through usePortalSlot, native inputs, login sessions, and WebSockets are wormholed into modern React containers seamlessly.",
      badge: "DOM Alive",
    },
    {
      icon: Zap,
      title: lang === "zh" ? "0ms TurboNav 极速同源无刷新导航" : "0ms TurboNav Streaming Client-side SPA",
      desc:
        lang === "zh"
          ? "给 1998 年的传统 MPA 老网站赋予 Next.js / Remix 级别的流畅体验。拦截 link 点击流式拉取下页 DOM，提取数据并热更新界面，彻底告别整页白屏重载。"
          : "Upgrades 1998 multi-page apps into Next.js/Remix-like SPAs. Intercepts navigation, streaming-extracts next page contract, and morphs UI with zero full-page reloads.",
      badge: "Instant 0ms",
    },
    {
      icon: CheckCircle2,
      title: lang === "zh" ? "Playwright 六重门禁与 VLM 视觉终审" : "6-Gate Deterministic QA & VLM Scoring",
      desc:
        lang === "zh"
          ? "不同于社区良莠不齐的手写脚本，所有重制皮肤必须通过编译期 6 重硬性测试（零运行时错误、数据对齐率 ≥90%、样式破损检查等），且 VLM 视觉评分 ≥ 8.5 准入。"
          : "Unlike fragile community scripts, all skins pass 6 deterministic Playwright checks (0 errors, data parity ≥90%, no visual glitches) plus VLM visual score ≥ 8.5.",
      badge: "VLM ≥ 8.5",
    },
    {
      icon: Cpu,
      title: lang === "zh" ? "BYOK 隐私优先与纯离线启发式 AI" : "BYOK Privacy AI & Offline Local Heuristics",
      desc:
        lang === "zh"
          ? "内置文章速读与代码增强能力，优先直连 Chrome 内置 Gemini Nano (window.ai) 或离线启发式算法，亦支持用户自填 DeepSeek/OpenAI Key，100% 隐私无中转。"
          : "Built-in reading summarizer connects directly to Chrome on-device Gemini Nano or 100% offline local heuristics, with optional BYOK for DeepSeek/OpenAI.",
      badge: "100% Offline",
    },
  ];

  const comparisonRows = [
    {
      feature: lang === "zh" ? "样式隔离机制" : "Style Isolation",
      webremaster: { text: "Shadow DOM 隔离 (0 泄露)", ok: true },
      tampermonkey: { text: "全局 CSS 注入 (易污染)", ok: false },
      stylus: { text: "全局 !important 覆盖", ok: false },
      arc: { text: "全局 CSS/JS 混入", ok: false },
    },
    {
      feature: lang === "zh" ? "原生功能与登录态保留" : "Preserve Native Login & State",
      webremaster: { text: "虫洞插槽 (100% 存活)", ok: true },
      tampermonkey: { text: "innerHTML 易破坏监听", ok: false },
      stylus: { text: "仅换皮，不可重组", ok: "partial" },
      arc: { text: "易因改动破坏功能", ok: false },
    },
    {
      feature: lang === "zh" ? "SPA 级别的 0ms 无刷新换页" : "0ms SPA Instant Navigation",
      webremaster: { text: "TurboNav 流式预取", ok: true },
      tampermonkey: { text: "无 (整页白屏重载)", ok: false },
      stylus: { text: "无 (整页重载)", ok: false },
      arc: { text: "无 (整页重载)", ok: false },
    },
    {
      feature: lang === "zh" ? "编译期确定性门禁自动化验收" : "Automated QA Verification",
      webremaster: { text: "Playwright 6 门禁 + VLM", ok: true },
      tampermonkey: { text: "无 (全靠人工肉眼)", ok: false },
      stylus: { text: "无", ok: false },
      arc: { text: "无", ok: false },
    },
    {
      feature: lang === "zh" ? "离线运行与零云端依赖" : "Zero Cloud Dependency",
      webremaster: { text: "0 Token 纯本地运行", ok: true },
      tampermonkey: { text: "纯本地运行", ok: true },
      stylus: { text: "纯本地运行", ok: true },
      arc: { text: "依赖云端同步", ok: "partial" },
    },
  ];

  return (
    <section className="w-full py-20 bg-zinc-950/40 border-t border-white/5 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="flex flex-col items-center text-center max-w-3xl mx-auto mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-sky-500/10 border border-sky-500/20 text-sky-400 text-xs font-semibold mb-4">
            <Sparkles size={14} />
            <span>{lang === "zh" ? "行业独创 · 次世代差异化" : "Unfair Advantage · Next-Gen"}</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
            {t.architectureTitle}
          </h2>
          <p className="text-sm text-zinc-400 mt-3 leading-relaxed">
            {t.architectureSubtitle}
          </p>
        </div>

        {/* 5 Core Pillars Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-16">
          {pillars.map((pillar, idx) => {
            const Icon = pillar.icon;
            return (
              <div
                key={idx}
                className="p-6 rounded-2xl bg-zinc-900/40 border border-white/5 hover:border-sky-500/30 transition-all duration-300 flex flex-col justify-between glow-card"
              >
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div className="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-400 flex items-center justify-center">
                      <Icon size={20} />
                    </div>
                    <span className="px-2.5 py-0.5 text-[10px] font-mono font-semibold rounded-full bg-white/5 text-zinc-300 border border-white/10">
                      {pillar.badge}
                    </span>
                  </div>
                  <h3 className="text-base font-bold text-white mb-2">{pillar.title}</h3>
                  <p className="text-xs text-zinc-400 leading-relaxed">{pillar.desc}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Benchmark Matrix Table */}
        <div className="rounded-2xl border border-white/10 bg-zinc-900/30 overflow-hidden shadow-2xl">
          <div className="p-5 border-b border-white/10 bg-zinc-900/60">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Layers size={16} className="text-sky-400" />
              <span>
                {lang === "zh"
                  ? "全维度技术实力对标矩阵（WebRemaster vs 传统方案）"
                  : "Comprehensive Technical Benchmark Matrix"}
              </span>
            </h3>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-950/60 border-b border-white/5 text-zinc-400 uppercase font-mono text-[10px]">
                <tr>
                  <th className="py-3.5 px-5 font-semibold">{lang === "zh" ? "核心能力维度" : "Capability"}</th>
                  <th className="py-3.5 px-5 font-bold text-sky-400 bg-sky-500/5">WebRemaster</th>
                  <th className="py-3.5 px-5 font-medium">Tampermonkey</th>
                  <th className="py-3.5 px-5 font-medium">Stylus / UserCSS</th>
                  <th className="py-3.5 px-5 font-medium">Arc Boosts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-zinc-300">
                {comparisonRows.map((row, i) => (
                  <tr key={i} className="hover:bg-white/[0.02] transition-colors">
                    <td className="py-3.5 px-5 font-medium text-white">{row.feature}</td>
                    <td className="py-3.5 px-5 bg-sky-500/5 font-semibold text-sky-300 flex items-center gap-1.5">
                      <CheckCircle2 size={14} className="text-emerald-400 flex-shrink-0" />
                      <span>{row.webremaster.text}</span>
                    </td>
                    <td className="py-3.5 px-5 text-zinc-400">
                      <div className="flex items-center gap-1.5">
                        {row.tampermonkey.ok ? (
                          <CheckCircle2 size={13} className="text-emerald-400" />
                        ) : (
                          <XCircle size={13} className="text-zinc-600" />
                        )}
                        <span>{row.tampermonkey.text}</span>
                      </div>
                    </td>
                    <td className="py-3.5 px-5 text-zinc-400">
                      <div className="flex items-center gap-1.5">
                        {row.stylus.ok === true ? (
                          <CheckCircle2 size={13} className="text-emerald-400" />
                        ) : row.stylus.ok === "partial" ? (
                          <HelpCircle size={13} className="text-amber-400" />
                        ) : (
                          <XCircle size={13} className="text-zinc-600" />
                        )}
                        <span>{row.stylus.text}</span>
                      </div>
                    </td>
                    <td className="py-3.5 px-5 text-zinc-400">
                      <div className="flex items-center gap-1.5">
                        {row.arc.ok === true ? (
                          <CheckCircle2 size={13} className="text-emerald-400" />
                        ) : row.arc.ok === "partial" ? (
                          <HelpCircle size={13} className="text-amber-400" />
                        ) : (
                          <XCircle size={13} className="text-zinc-600" />
                        )}
                        <span>{row.arc.text}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
};
