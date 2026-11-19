/**
 * theme —— 重制界面主题令牌。
 *
 * THEME_CSS 为纯原生 CSS（不含 Tailwind 指令）：主题变量定义在 :host（暗色默认）
 * 与 [data-wr-theme]（light/dark 双作用域，供 RemasterShell 根节点切换）两处；
 * wr-* 语义类颜色全部引用变量。组件内颜色经 useThemeVars() 以
 * var(--wr-*, 字面回退) 形式写入内联 style；Tailwind className 保持静态字面量。
 */
import { createContext, useContext, type ReactElement, type ReactNode } from "react";

export type ThemeMode = "light" | "dark";

/** 语义色板（字面量，供 var() 回退与无 Shadow 作用域场景使用）。 */
export interface ThemeVars {
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  borderStrong: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  accentSoft: string;
  success: string;
  warning: string;
  danger: string;
}

const DARK_VARS: ThemeVars = {
  bg: "#0b0f17",
  surface: "#12161f",
  surfaceAlt: "#171c27",
  border: "rgba(255,255,255,.08)",
  borderStrong: "rgba(255,255,255,.16)",
  text: "#e8eaed",
  textSecondary: "#9aa0a6",
  textMuted: "#6f7684",
  accent: "#6ea8fe",
  accentSoft: "rgba(110,168,254,.16)",
  success: "#4ade80",
  warning: "#fbbf24",
  danger: "#f87171",
};

const LIGHT_VARS: ThemeVars = {
  bg: "#f5f6f8",
  surface: "#ffffff",
  surfaceAlt: "#eef1f6",
  border: "rgba(15,23,42,.1)",
  borderStrong: "rgba(15,23,42,.18)",
  text: "#1c1e23",
  textSecondary: "#5b6472",
  textMuted: "#8a93a3",
  accent: "#2f6cd8",
  accentSoft: "rgba(47,108,216,.12)",
  success: "#16a34a",
  warning: "#d97706",
  danger: "#dc2626",
};

/** 指定模式下的字面色板。 */
export function themeVarsFor(mode: ThemeMode): ThemeVars {
  return mode === "light" ? LIGHT_VARS : DARK_VARS;
}

/** 内联 style 用的变量引用色板：每个值都是 var(--wr-*, 同模式字面回退)。 */
export function themeVars(mode: ThemeMode = "dark"): ThemeVars {
  const fallback = themeVarsFor(mode);
  return {
    bg: `var(--wr-bg, ${fallback.bg})`,
    surface: `var(--wr-surface, ${fallback.surface})`,
    surfaceAlt: `var(--wr-surface-alt, ${fallback.surfaceAlt})`,
    border: `var(--wr-border, ${fallback.border})`,
    borderStrong: `var(--wr-border-strong, ${fallback.borderStrong})`,
    text: `var(--wr-text, ${fallback.text})`,
    textSecondary: `var(--wr-text-secondary, ${fallback.textSecondary})`,
    textMuted: `var(--wr-text-muted, ${fallback.textMuted})`,
    accent: `var(--wr-accent, ${fallback.accent})`,
    accentSoft: `var(--wr-accent-soft, ${fallback.accentSoft})`,
    success: `var(--wr-success, ${fallback.success})`,
    warning: `var(--wr-warning, ${fallback.warning})`,
    danger: `var(--wr-danger, ${fallback.danger})`,
  };
}

/** 等宽字体栈（字段名 / 编号等场景）。 */
export const THEME_MONO_FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

const DARK_VAR_BLOCK =
  "--wr-bg:#0b0f17;--wr-surface:#12161f;--wr-surface-alt:#171c27;--wr-border:rgba(255,255,255,.08);" +
  "--wr-border-strong:rgba(255,255,255,.16);--wr-text:#e8eaed;--wr-text-secondary:#9aa0a6;--wr-text-muted:#6f7684;" +
  "--wr-accent:#6ea8fe;--wr-accent-soft:rgba(110,168,254,.16);--wr-success:#4ade80;--wr-warning:#fbbf24;--wr-danger:#f87171;";

const LIGHT_VAR_BLOCK =
  "--wr-bg:#f5f6f8;--wr-surface:#ffffff;--wr-surface-alt:#eef1f6;--wr-border:rgba(15,23,42,.1);" +
  "--wr-border-strong:rgba(15,23,42,.18);--wr-text:#1c1e23;--wr-text-secondary:#5b6472;--wr-text-muted:#8a93a3;" +
  "--wr-accent:#2f6cd8;--wr-accent-soft:rgba(47,108,216,.12);--wr-success:#16a34a;--wr-warning:#d97706;--wr-danger:#dc2626;";

/**
 * 主题样式表：注入 Shadow Root（<style>{THEME_CSS}</style>）或经
 * mountWebRemasterRoot(appId, THEME_CSS) 采纳均可独立生效。
 */
export const THEME_CSS = `
:host{${DARK_VAR_BLOCK}}
:host([data-wr-theme="light"]){${LIGHT_VAR_BLOCK}}
[data-wr-theme="dark"]{${DARK_VAR_BLOCK}}
[data-wr-theme="light"]{${LIGHT_VAR_BLOCK}}
:where([data-wr-theme]){background:var(--wr-bg);color:var(--wr-text);min-height:100vh;font-size:14px;line-height:1.6;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans","PingFang SC","Microsoft YaHei",sans-serif;}
:where([data-wr-theme]) *{box-sizing:border-box;}
:where([data-wr-theme]) button{cursor:pointer;background:none;border:none;color:inherit;font:inherit;padding:0;}
:where([data-wr-theme]) input,select,textarea{font:inherit;color:inherit;}
:where([data-wr-theme]) a{color:inherit;text-decoration:none;}
:where([data-wr-theme]) table{border-collapse:collapse;}
:where([data-wr-theme]) img{max-width:100%;}
.wr-interactive{transition:background-color .15s ease,color .15s ease,border-color .15s ease,opacity .15s ease;}
.wr-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;border-radius:8px;padding:5px 10px;font-size:12px;line-height:1.4;color:var(--wr-text-secondary);background:transparent;border:1px solid var(--wr-border);white-space:nowrap;}
.wr-btn:hover:not(:disabled){background:var(--wr-accent-soft);color:var(--wr-text);}
.wr-btn:disabled{opacity:.4;cursor:not-allowed;}
.wr-chip{display:inline-flex;align-items:center;gap:4px;border-radius:999px;padding:2px 8px;font-size:11px;line-height:1.5;background:var(--wr-surface-alt);color:var(--wr-text-secondary);white-space:nowrap;}
.wr-link:hover{text-decoration:underline;}
.wr-input{border-radius:8px;border:1px solid var(--wr-border);background:var(--wr-surface);color:var(--wr-text);padding:5px 10px;font-size:13px;outline:none;}
.wr-input:focus{border-color:var(--wr-accent);}
.wr-input::placeholder{color:var(--wr-text-muted);}
.wr-row{border-top:1px solid var(--wr-border);}
.wr-row:nth-child(even){background:var(--wr-surface-alt);}
.wr-row:hover{background:var(--wr-accent-soft);}
.wr-prose{color:var(--wr-text);font-size:15px;line-height:1.75;overflow-wrap:break-word;}
.wr-prose h1,.wr-prose h2,.wr-prose h3,.wr-prose h4{color:var(--wr-text);font-weight:700;line-height:1.3;}
.wr-prose h1{font-size:1.9rem;margin:0 0 1rem;}
.wr-prose h2{font-size:1.4rem;margin:2rem 0 .75rem;}
.wr-prose h3{font-size:1.15rem;margin:1.5rem 0 .5rem;}
.wr-prose h4{font-size:1rem;margin:1.25rem 0 .5rem;}
.wr-prose p{margin:0 0 1rem;}
.wr-prose ul,.wr-prose ol{margin:0 0 1rem;padding-left:1.5rem;}
.wr-prose li{margin:.25rem 0;}
.wr-prose blockquote{margin:0 0 1rem;padding:.1rem 0 .1rem 1rem;border-left:3px solid var(--wr-accent-soft);color:var(--wr-text-secondary);}
.wr-prose a{color:var(--wr-accent);text-decoration:underline;text-underline-offset:2px;}
.wr-prose img{border-radius:8px;}
.wr-prose hr{border:none;border-top:1px solid var(--wr-border);margin:2rem 0;}
.wr-prose code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.875em;background:var(--wr-surface-alt);border-radius:4px;padding:.15em .35em;}
.wr-prose pre{background:var(--wr-surface-alt);border:1px solid var(--wr-border);border-radius:8px;padding:12px 14px;overflow-x:auto;margin:0 0 1rem;}
.wr-prose pre code{background:none;padding:0;font-size:.85rem;line-height:1.6;}
.wr-prose table{width:100%;font-size:.9em;}
.wr-prose th,.wr-prose td{border:1px solid var(--wr-border);padding:6px 10px;text-align:left;}
`;

const ThemeModeContext = createContext<ThemeMode>("dark");

/** 主题上下文提供者：mode 由 RemasterShell 等宿主持有并切换。 */
export function ThemeProvider(props: { mode: ThemeMode; children: ReactNode }): ReactElement {
  return <ThemeModeContext.Provider value={props.mode}>{props.children}</ThemeModeContext.Provider>;
}

/** 读取当前主题模式（Provider 外使用时回退暗色）。 */
export function useThemeMode(): ThemeMode {
  return useContext(ThemeModeContext);
}

/** 读取当前主题的变量引用色板（用于内联 style）。 */
export function useThemeVars(): ThemeVars {
  return themeVars(useContext(ThemeModeContext));
}
