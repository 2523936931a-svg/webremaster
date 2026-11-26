import React, { useCallback, useRef, useState } from "react";
import { DICTIONARY, type Language } from "../i18n.js";
import { Loader2, MonitorPlay, RefreshCw, TriangleAlert } from "lucide-react";

type DemoRoute = "feed" | "thread";
type DemoMode = "remastered" | "split" | "original";
type DemoStatus = "loading" | "ready" | "failed";

const ROUTES: Record<DemoRoute, { file: string; zh: string; en: string }> = {
  feed: { file: "data/demo/hackernews-feed.html", zh: "列表页 /front", en: "Feed /front" },
  thread: { file: "data/demo/hackernews-thread.html", zh: "详情页 /item", en: "Thread /item" },
};

const SKIN_SCRIPT = "data/skins/hackernews/hackernews.user.js";

const MODES: { id: DemoMode; zh: string; en: string }[] = [
  { id: "remastered", zh: "重制版", en: "Remastered" },
  { id: "split", zh: "左右分屏", en: "Split" },
  { id: "original", zh: "1998 原版", en: "Original" },
];

interface DebugHandle {
  setMode?: (mode: DemoMode) => void;
  getMode?: () => string;
}

/**
 * 在线试用：把一个离线 HN 快照放进 iframe，再把编译好的 userscript 文本注入进去。
 * 访客不装油猴/扩展，也能在同一页面里切「重制版 / 分屏 / 原版」。
 */
export const LivePlayground: React.FC<{ lang: Language }> = ({ lang }) => {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const injectedRef = useRef(false);
  const [route, setRoute] = useState<DemoRoute>("feed");
  const [mode, setMode] = useState<DemoMode>("remastered");
  const [status, setStatus] = useState<DemoStatus>("loading");
  const t = DICTIONARY[lang];

  const pushMode = useCallback((next: DemoMode) => {
    setMode(next);
    try {
      const win = frameRef.current?.contentWindow as { __WR_DEBUG__?: DebugHandle } | null;
      win?.__WR_DEBUG__?.setMode?.(next);
    } catch {
      /* iframe 未就绪时忽略 */
    }
  }, []);

  const injectSkin = useCallback(async () => {
    if (injectedRef.current) return;
    injectedRef.current = true;
    const frame = frameRef.current;
    let doc: Document | null = null;
    try {
      doc = frame?.contentDocument ?? null;
    } catch {
      doc = null;
    }
    if (!doc?.body) {
      setStatus("failed");
      return;
    }
    setStatus("loading");
    try {
      const res = await fetch(SKIN_SCRIPT);
      if (!res.ok) throw new Error(`userscript ${res.status}`);
      const code = await res.text();
      const script = doc.createElement("script");
      script.textContent = code;
      doc.body.appendChild(script);
      for (let i = 0; i < 40; i += 1) {
        if (doc.querySelector("web-remaster-root")) {
          setStatus("ready");
          setMode("remastered");
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      setStatus("failed");
    } catch {
      setStatus("failed");
    }
  }, []);

  const switchRoute = (next: DemoRoute) => {
    if (next === route) return;
    injectedRef.current = false;
    setStatus("loading");
    setRoute(next);
  };

  const reload = () => {
    injectedRef.current = false;
    setStatus("loading");
    setRoute((prev) => prev);
    const frame = frameRef.current;
    if (frame) frame.src = `${ROUTES[route].file}?v=${Date.now()}`;
  };

  return (
    <section id="live-demo" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4 pb-10">
      <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-zinc-900/60 to-zinc-950/60 p-3 sm:p-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3">
          <div className="flex items-center gap-2">
            <MonitorPlay className="text-sky-400" size={18} />
            <h2 className="text-sm font-bold text-white tracking-tight">
              {lang === "zh" ? "在线试用：不用装插件，现在就能玩" : "Try it live: no extension required"}
            </h2>
            <span className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-zinc-800/80 text-zinc-400 border border-white/10">
              {lang === "zh" ? "离线快照" : "offline snapshot"}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 bg-zinc-900/80 p-1 rounded-xl border border-white/5">
              {(Object.keys(ROUTES) as DemoRoute[]).map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => switchRoute(id)}
                  className={`px-2.5 py-1 text-[11px] rounded-lg font-medium transition-colors ${
                    route === id ? "bg-white/10 text-white" : "text-zinc-400 hover:text-white"
                  }`}
                >
                  {lang === "zh" ? ROUTES[id].zh : ROUTES[id].en}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 bg-zinc-900/80 p-1 rounded-xl border border-white/5">
              {MODES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  disabled={status !== "ready"}
                  onClick={() => pushMode(item.id)}
                  className={`px-2.5 py-1 text-[11px] rounded-lg font-medium transition-colors disabled:opacity-40 ${
                    mode === item.id ? "bg-sky-500/20 text-sky-300 border border-sky-500/30" : "text-zinc-400 hover:text-white"
                  }`}
                >
                  {lang === "zh" ? item.zh : item.en}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={reload}
              title={lang === "zh" ? "重新加载快照并注入皮肤" : "Reload snapshot and inject skin"}
              className="px-2 py-1.5 rounded-lg text-zinc-400 hover:text-white bg-zinc-900/80 border border-white/5"
            >
              <RefreshCw size={13} />
            </button>
          </div>
        </div>

        <div className="relative rounded-xl overflow-hidden border border-white/10 bg-zinc-950 h-[380px] sm:h-[480px] lg:h-[560px]">
          <iframe
            key={route}
            ref={frameRef}
            src={ROUTES[route].file}
            onLoad={injectSkin}
            title="WebRemaster live demo"
            className="w-full h-full bg-white"
          />

          {status === "loading" && (
            <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/70 backdrop-blur-sm text-zinc-300 text-xs gap-2">
              <Loader2 size={14} className="animate-spin" />
              {lang === "zh" ? "正在注入皮肤…" : "Injecting the skin…"}
            </div>
          )}

          {status === "failed" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-zinc-950/90 text-zinc-300 text-xs px-6 text-center">
              <TriangleAlert size={18} className="text-amber-400" />
              {lang === "zh"
                ? "这份快照没能被皮肤接管（可能是不支持的环境）。可以点右上角刷新重试，或直接看下方的静态对比图。"
                : "This snapshot was not taken over by the skin. Hit reload on the right, or use the static comparison below."}
            </div>
          )}
        </div>

        <p className="text-[11px] text-zinc-500 mt-2 leading-relaxed">
          {lang === "zh"
            ? "iframe 里跑的就是真实 userscript（零运行时 Token、Shadow DOM 隔离、原生事件桥接），快照为 1998 年 HN 离线存档。切「左右分屏」可拖动中轴逐行对照；点「1998 原版」立即回到原站。"
            : "The iframe runs the real userscript (zero runtime tokens, Shadow DOM isolation, native event bridging) against an offline 1998 HN snapshot. Split mode gives you a draggable divider; Original reverts instantly."}
        </p>
      </div>
    </section>
  );
};
