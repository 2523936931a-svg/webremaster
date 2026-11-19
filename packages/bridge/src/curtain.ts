/**
 * Zero-Flash Curtain —— document-start 零闪烁开幕帘。
 *
 * 在文档最早期（head 可能尚未解析）就把 body 藏起来，并铺上暗色流光骨架屏，
 * 拦截老站首屏白屏闪烁；failsafe 定时器保证无论上层应用发生任何异常，
 * 幕帘最终一定会被揭开 —— 数学上杜绝永久白屏。
 */

export interface ZeroFlashCurtainOptions {
  /** 骨架屏暗色底色，默认 #0b0f17 */
  darkBg?: string;
  /** failsafe 兜底毫秒数，默认 1800 */
  failsafeMs?: number;
}

/** 揭幕时追加的淡出规则（::after 是骨架光条，一并淡出避免突兀消失） */
const CURTAIN_FADE_CSS =
  'html[data-wr-ready="true"]::before,html[data-wr-ready="true"]::after{opacity:0!important;transition:opacity .12s ease-out;}';

const buildCurtainCss = (darkBg: string): string => `
html:not([data-wr-ready="true"]) body{visibility:hidden!important;}
html:not([data-wr-ready="true"])::before{
  content:"";
  position:fixed;
  inset:0;
  background:radial-gradient(60% 40% at 50% 50%, rgba(110,168,254,.06), transparent 70%), ${darkBg};
  z-index:2147483646;
  pointer-events:none;
  animation:wr-curtain-glow 2.4s ease-in-out infinite;
}
html:not([data-wr-ready="true"])::after{
  content:"";
  position:fixed;
  left:50%;
  top:50%;
  width:220px;
  height:4px;
  margin:-2px 0 0 -110px;
  border-radius:9999px;
  background:linear-gradient(90deg, rgba(110,168,254,0), rgba(110,168,254,.85), rgba(110,168,254,0));
  box-shadow:0 0 16px rgba(110,168,254,.45);
  z-index:2147483647;
  pointer-events:none;
  animation:wr-curtain-breathe 1.4s ease-in-out infinite;
}
@keyframes wr-curtain-glow{
  0%,100%{opacity:1;}
  50%{opacity:.86;}
}
@keyframes wr-curtain-breathe{
  0%,100%{opacity:.35;transform:scaleX(.72);}
  50%{opacity:.95;transform:scaleX(1);}
}
@media (prefers-reduced-motion: reduce){
  html:not([data-wr-ready="true"])::before,
  html:not([data-wr-ready="true"])::after{animation:none;}
}
`;

/**
 * 安装零闪烁幕帘，返回揭幕函数 liftCurtain()。
 * - document-start 阶段 head 可能不存在，样式统一注入 documentElement；
 * - failsafe 定时器超时无条件自动揭幕；
 * - liftCurtain 幂等：重复调用安全、不报错、不重复定时；
 * - SSR / 无 DOM 环境返回 no-op。
 */
export function installZeroFlashCurtain(opts?: ZeroFlashCurtainOptions): () => void {
  // SSR 安全：无 document 时优雅返回
  if (typeof document === "undefined") {
    return () => {};
  }

  const darkBg = opts?.darkBg ?? "#0b0f17";
  const failsafeMs = opts?.failsafeMs ?? 1800;

  let styleEl: HTMLStyleElement | null = null;
  let lifted = false;
  let failsafeTimer: ReturnType<typeof setTimeout> | undefined;
  let installTimer: ReturnType<typeof setInterval> | undefined;

  const liftCurtain = (): void => {
    if (typeof document === "undefined" || lifted) return;
    lifted = true;
    if (failsafeTimer !== undefined) {
      clearTimeout(failsafeTimer);
      failsafeTimer = undefined;
    }
    if (installTimer !== undefined) {
      clearInterval(installTimer);
      installTimer = undefined;
    }
    try {
      document.documentElement?.setAttribute("data-wr-ready", "true");
    } catch {
      /* 属性写入失败不阻断揭幕 */
    }
    try {
      // 淡出规则追加进同一个 curtain style，120ms 后整体移除（幕帘未安装时无操作）
      if (styleEl !== null) {
        styleEl.textContent = `${styleEl.textContent ?? ""}\n${CURTAIN_FADE_CSS}`;
        setTimeout(() => {
          try {
            styleEl?.remove();
          } catch {
            /* 元素已被外部移除时忽略 */
          }
        }, 120);
      }
    } catch {
      /* 样式追加失败不阻断揭幕 */
    }
  };

  const inject = (): boolean => {
    const root = document.documentElement;
    if (!root) return false; // 真实浏览器 document-start 阶段 html 可能尚未创建
    styleEl = document.createElement("style");
    styleEl.setAttribute("data-wr-curtain", "");
    styleEl.textContent = buildCurtainCss(darkBg);
    root.appendChild(styleEl);
    return true;
  };

  if (!inject()) {
    // documentElement 未就绪：0ms 轮询，出现的第一时间注入（failsafe 与安装独立计时，双保险）
    installTimer = setInterval(() => {
      if (inject() && installTimer !== undefined) {
        clearInterval(installTimer);
        installTimer = undefined;
      }
    }, 0);
  }

  // failsafe：无论上层发生什么异常，超时必自动揭幕（幕帘未装上时 body 本就未被隐藏，同样安全）
  failsafeTimer = setTimeout(liftCurtain, failsafeMs);

  return liftCurtain;
}
