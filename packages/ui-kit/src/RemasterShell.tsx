/**
 * RemasterShell —— 重制版界面标准外壳。
 *
 * 职责：注入主题样式表（THEME_CSS）+ 主题上下文（深浅切换，localStorage 持久化）、
 * 顶栏（命令面板 / 三态视图切换 / 主题 / 诊断入口）、EscapePill 与 CommandPalette
 * 集成、DiagnosticsDrawer 挂载。视图状态与 OriginManager 双向同步（Alt+Shift+R 与
 * bridge 熔断回落同样驱动本组件更新）。未传 manager 时使用 bridge 共享实例
 * （熔断器 setViewMode 必须命中同一实例，故不要另建私有实例传入）。
 */
import { useCallback, useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { Activity, Columns2, Eye, Monitor, Moon, Search, Sun } from "lucide-react";
import {
  CommandPalette,
  EscapePill,
  getSharedOriginManager,
  useCommandPaletteHotkey,
  cleanDistractions,
  toggleElementZapper,
  resetZappedSelectors,
  type OriginManager,
  type PaletteCommand,
  type ViewMode,
} from "@webremaster/bridge";
import { THEME_CSS, ThemeProvider, useThemeVars, type ThemeMode } from "./theme.js";
import { DiagnosticsDrawer, type DiagnosticsSnapshot } from "./DiagnosticsDrawer.js";
import { RemasterErrorBoundary } from "./RemasterErrorBoundary.js";
import { ToastProvider } from "./Toast.js";



export interface RemasterShellProps {
  title: string;
  subtitle?: string;
  /** 缺省用 getSharedOriginManager() 共享实例；传入后仅取首次值（不随重渲染切换）。 */
  manager?: OriginManager;
  /** 无持久化记录时的初始主题，缺省暗色。 */
  initialTheme?: ThemeMode;
  /** localStorage 持久化键，缺省 webremaster-theme。 */
  themeStorageKey?: string;
  /** 追加到内置命令之后的自定义命令。 */
  commands?: ReadonlyArray<PaletteCommand>;
  /** 诊断快照；缺省时顶栏诊断按钮禁用。 */
  diagnostics?: DiagnosticsSnapshot;
  children?: ReactNode;
}

const VIEW_MODE_ORDER: readonly ViewMode[] = ["remastered", "original", "split"];

const VIEW_MODE_LABEL: Record<ViewMode, string> = {
  remastered: "重制版",
  original: "原版",
  split: "分屏",
};

const DEFAULT_THEME_STORAGE_KEY = "webremaster-theme";

function readStoredTheme(key: string): ThemeMode | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(key);
    return raw === "light" || raw === "dark" ? raw : null;
  } catch {
    return null;
  }
}

function writeStoredTheme(key: string, mode: ThemeMode): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(key, mode);
  } catch {
    /* 隐私模式等场景忽略持久化失败 */
  }
}

export function RemasterShell(props: RemasterShellProps): ReactElement {
  const [manager] = useState<OriginManager>(() => props.manager ?? getSharedOriginManager());
  const storageKey = props.themeStorageKey ?? DEFAULT_THEME_STORAGE_KEY;
  const [mode, setMode] = useState<ThemeMode>(() => readStoredTheme(storageKey) ?? props.initialTheme ?? "dark");
  const [viewMode, setViewModeState] = useState<ViewMode>(() => manager.getViewMode());
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const vars = useThemeVars();

  useCommandPaletteHotkey(() => {
    setPaletteOpen(true);
  });

  useEffect(() => {
    writeStoredTheme(storageKey, mode);
  }, [storageKey, mode]);

  // 订阅视图模式变化：快捷键 / 熔断回落等外部切换同步进 React 状态
  useEffect(() => manager.onViewModeChange(setViewModeState), [manager]);

  const toggleTheme = useCallback((): void => {
    setMode((prev) => (prev === "light" ? "dark" : "light"));
  }, []);

  const cycleViewMode = useCallback((): void => {
    const next = VIEW_MODE_ORDER[(VIEW_MODE_ORDER.indexOf(viewMode) + 1) % VIEW_MODE_ORDER.length] ?? "remastered";
    manager.setViewMode(next);
  }, [manager, viewMode]);

  const [fontSize, setFontSize] = useState<number>(16);

  // 接收来自 Chrome 扩展 Popup 或宿主脚本的直控遥控事件
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== "object") return;
      if (data.type === "WEBREMASTER_ACTION") {
        switch (data.action) {
          case "open_palette":
            setPaletteOpen(true);
            break;
          case "toggle_theme":
            toggleTheme();
            break;
          case "cycle_view_mode":
            cycleViewMode();
            break;
          case "toggle_zapper":
            toggleElementZapper();
            break;
          case "open_diagnostics":
            setDiagnosticsOpen(true);
            break;
          case "reset_zapped":
            resetZappedSelectors();
            break;
          case "increase_font":
            setFontSize((prev) => Math.min(24, prev + 2));
            break;
          case "decrease_font":
            setFontSize((prev) => Math.max(12, prev - 2));
            break;
        }
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [toggleTheme, cycleViewMode]);

  const commands = useMemo<PaletteCommand[]>(
    () => [
      ...(props.commands ?? []),
      { id: "wr-toggle-theme", label: "切换深浅主题", keywords: "theme dark light 主题 深色 浅色", run: toggleTheme },
      {
        id: "wr-font-increase",
        label: `增大字号 (+2px，当前 ${fontSize}px)`,
        keywords: "font size bigger 增大 字号 字体",
        run: () => setFontSize((s) => Math.min(24, s + 2)),
      },
      {
        id: "wr-font-decrease",
        label: `缩小字号 (-2px，当前 ${fontSize}px)`,
        keywords: "font size smaller 缩小 字号 字体",
        run: () => setFontSize((s) => Math.max(12, s - 2)),
      },
      {
        id: "wr-font-reset",
        label: "重置字号为默认 (16px)",
        keywords: "font size reset 重置 字号 字体",
        run: () => setFontSize(16),
      },
      {
        id: "wr-clean-popups",
        label: "清除原站浮动广告与解除滚动锁",
        keywords: "clean popup ad banner cookie 广告 弹窗 遮罩",
        run: () => {
          cleanDistractions(document);
        },
      },
      {
        id: "wr-element-zap",
        label: "元素粉碎枪：点击永久隐藏页面指定区域 (Zap)",
        keywords: "zap hide remove vaporize 隐藏 消除 广告 净化 元素 粉碎",
        run: () => {
          toggleElementZapper();
        },
      },
      {
        id: "wr-element-unzap",
        label: "重置所有被粉碎隐藏的元素 (Restore Zapped)",
        keywords: "unzap restore reset 恢复 重置 还原",
        run: () => {
          resetZappedSelectors();
        },
      },
      {
        id: "wr-view-remastered",
        label: "视图：重制版",
        keywords: "view remastered 视图",
        run: () => {
          manager.setViewMode("remastered");
        },
      },
      {
        id: "wr-view-original",
        label: "视图：原版",
        keywords: "view original 视图 原站",
        run: () => {
          manager.setViewMode("original");
        },
      },
      {
        id: "wr-view-split",
        label: "视图：分屏对比",
        keywords: "view split 视图 分屏",
        run: () => {
          manager.setViewMode("split");
        },
      },
      {
        id: "wr-toggle-diagnostics",
        label: diagnosticsOpen ? "关闭诊断面板" : "打开诊断面板",
        keywords: "diagnostics health 诊断 健康",
        run: () => {
          setDiagnosticsOpen((prev) => !prev);
        },
      },
    ],
    [props.commands, manager, diagnosticsOpen, toggleTheme, fontSize],
  );

  return (
    <ThemeProvider mode={mode}>
      <ToastProvider>
        <div data-wr-theme={mode} className="flex min-h-screen flex-col" style={{ fontSize: `${fontSize}px` }}>

        <style>{THEME_CSS}</style>
        <header
          className="sticky top-0 z-20 flex items-center gap-3 px-4 py-2.5"
          style={{ background: vars.bg, borderBottomWidth: 1, borderBottomStyle: "solid", borderColor: vars.border }}
        >
          <div className="min-w-0">
            <h1 className="truncate text-[15px] font-semibold leading-tight" style={{ color: vars.text }}>
              {props.title}
            </h1>
            {props.subtitle !== undefined ? (
              <p className="mt-0.5 truncate text-[11px]" style={{ color: vars.textMuted }}>
                {props.subtitle}
              </p>
            ) : null}
          </div>
          <div className="flex-1" />
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              className="wr-btn wr-interactive"
              onClick={() => {
                setPaletteOpen(true);
              }}
              title="命令面板 (Ctrl+K)"
              aria-label="打开命令面板"
            >
              <Search size={14} aria-hidden />
            </button>
            <button
              type="button"
              className="wr-btn wr-interactive"
              onClick={cycleViewMode}
              title={`切换视图模式（当前：${VIEW_MODE_LABEL[viewMode]}，Alt+Shift+R）`}
              aria-label="切换视图模式"
            >
              {viewMode === "remastered" ? (
                <Monitor size={14} aria-hidden />
              ) : viewMode === "original" ? (
                <Eye size={14} aria-hidden />
              ) : (
                <Columns2 size={14} aria-hidden />
              )}
              <span>{VIEW_MODE_LABEL[viewMode]}</span>
            </button>
            <button
              type="button"
              className="wr-btn wr-interactive"
              onClick={toggleTheme}
              title={mode === "dark" ? "切换到浅色主题" : "切换到深色主题"}
              aria-label="切换深浅主题"
            >
              {mode === "dark" ? <Sun size={14} aria-hidden /> : <Moon size={14} aria-hidden />}
            </button>
            <button
              type="button"
              className="wr-btn wr-interactive"
              onClick={() => {
                setDiagnosticsOpen(true);
              }}
              disabled={props.diagnostics === undefined}
              aria-pressed={diagnosticsOpen}
              title="诊断面板"
              aria-label="打开诊断面板"
            >
              <Activity size={14} aria-hidden />
            </button>
          </div>
        </header>
        <main className="flex flex-1 flex-col">
          <RemasterErrorBoundary manager={manager}>{props.children}</RemasterErrorBoundary>
        </main>
        <EscapePill
          theme={mode}
          onToggleTheme={toggleTheme}
          onSwitchViewMode={cycleViewMode}
          onOpenPalette={() => {
            setPaletteOpen(true);
          }}
        />
        <CommandPalette open={paletteOpen} commands={commands} onClose={() => setPaletteOpen(false)} />
        {props.diagnostics !== undefined ? (
          <DiagnosticsDrawer
            open={diagnosticsOpen}
            onClose={() => {
              setDiagnosticsOpen(false);
            }}
            snapshot={props.diagnostics}
          />
        ) : null}
      </div>
      </ToastProvider>
    </ThemeProvider>
  );
}

