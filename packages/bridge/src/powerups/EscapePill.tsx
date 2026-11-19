/**
 * EscapePill PowerUp —— 右下角半透明极简逃生胶囊。
 *
 * 三个圆形图标按钮：切换深浅主题 / Alt+Shift+R 切换原版与新版 / 唤起命令面板。
 * 运行在 Shadow DOM 内，全部样式内联；hover 态用 React 状态模拟（不依赖外部 CSS）。
 */
import { useState, type ReactElement } from "react";

export interface EscapePillProps {
  onToggleTheme?: () => void;
  onSwitchViewMode?: () => void;
  onOpenPalette?: () => void;
  theme?: "dark" | "light";
}

interface PillButtonProps {
  glyph: string;
  title: string;
  color: string;
  onClick?: () => void;
}

/** 胶囊内的单个圆形图标按钮；未提供回调时禁用并降透明度。 */
function PillButton(props: PillButtonProps): ReactElement {
  const [hovered, setHovered] = useState(false);
  const enabled = typeof props.onClick === "function";
  return (
    <button
      type="button"
      title={props.title}
      aria-label={props.title}
      disabled={!enabled}
      onClick={props.onClick}
      onMouseEnter={() => {
        setHovered(true);
      }}
      onMouseLeave={() => {
        setHovered(false);
      }}
      style={{
        width: 36,
        height: 36,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
        border: "none",
        borderRadius: "50%",
        background: enabled && hovered ? "rgba(255,255,255,.12)" : "transparent",
        color: props.color,
        fontSize: 15,
        fontFamily: "inherit",
        lineHeight: 1,
        cursor: "pointer",
        opacity: enabled ? 1 : 0.4,
      }}
    >
      {props.glyph}
    </button>
  );
}

/** 右下角固定的半透明毛玻璃胶囊。 */
export function EscapePill(props: EscapePillProps): ReactElement {
  const isLight = props.theme === "light";
  const color = isLight ? "#1c1e23" : "#e8eaed";
  return (
    <div
      style={{
        position: "fixed",
        right: 20,
        bottom: 20,
        display: "inline-flex",
        gap: 4,
        padding: 6,
        borderRadius: 999,
        background: isLight ? "rgba(245,246,248,.7)" : "rgba(15,17,21,.55)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        border: "1px solid rgba(255,255,255,.12)",
        boxShadow: "0 4px 18px rgba(0,0,0,.25)",
        zIndex: 2147483640,
      }}
    >
      <PillButton glyph="🌓" title="切换深浅主题" color={color} onClick={props.onToggleTheme} />
      <PillButton glyph="⇄" title="切换原版/新版 (Alt+Shift+R)" color={color} onClick={props.onSwitchViewMode} />
      <PillButton glyph="⌘K" title="命令面板 (Ctrl+K)" color={color} onClick={props.onOpenPalette} />
    </div>
  );
}
