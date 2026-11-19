/**
 * OriginManager —— 隐身原站管理器 + 三态视图（remastered / original / split）。
 *
 * 原站业务节点用 appendChild 原址物理移动进 #wr-origin-wrapper（严禁 innerHTML/cloneNode，
 * EventListener、CSRF Token、ASP.NET __VIEWSTATE 100% 存活）；remastered 模式下整包
 * 移出视口隐身（严禁 display:none，保证后台表单/iframe/播放器持续存活）。
 * split 模式为真网页活体分屏：clip-path 左右切割 + 可拖拽发光分割条，双向皆可交互。
 */
export type ViewMode = "remastered" | "original" | "split";

export interface OriginManagerOptions {
  /** 是否绑定 Alt+Shift+R 全局快捷键，默认 true */
  hotkey?: boolean;
  /** 初始分屏百分比，默认 50 */
  splitPercent?: number;
}

export interface OriginManager {
  readonly wrapper: HTMLElement | null;
  captureAndHideOrigin(): HTMLElement;
  getViewMode(): ViewMode;
  setViewMode(mode: ViewMode): void;
  setSplitPercent(percent: number): void;
  showFallbackToast(reason: string): void;
  onViewModeChange(cb: (mode: ViewMode) => void): () => void;
  dispose(): void;
}

const ORIGIN_STYLE_CSS =
  '#wr-origin-wrapper[data-wr-mode="remastered"]{position:fixed!important;left:-99999px!important;top:0!important;width:1280px!important;height:800px!important;opacity:0!important;pointer-events:none!important;overflow:hidden!important;z-index:-9999!important;}' +
  'html[data-wr-view="original"] web-remaster-root{display:none!important;}';

const SPLIT_HANDLE_CSS =
  "#wr-split-handle{position:fixed;top:0;bottom:0;width:8px;cursor:col-resize;z-index:2147483636;background:linear-gradient(180deg,rgba(110,168,254,.9),rgba(110,168,254,.15));box-shadow:0 0 12px rgba(110,168,254,.55);}" +
  "#wr-split-handle:hover{background:linear-gradient(180deg,rgba(110,168,254,1),rgba(110,168,254,.3));}";

const TOAST_CSS =
  '[data-wr-toast]{position:fixed;left:50%;transform:translateX(-50%);background:rgba(15,17,21,.88);color:#e8eaed;font:13px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:10px 16px;border-radius:10px;max-width:80vw;z-index:2147483647;box-shadow:0 6px 24px rgba(0,0,0,.35);}';

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

/** head 内幂等注入一段样式（按属性名去重） */
const ensureStyle = (attr: string, css: string): void => {
  if (typeof document === "undefined") return;
  if (document.querySelector(`style[${attr}]`)) return;
  const styleEl = document.createElement("style");
  styleEl.setAttribute(attr, "");
  styleEl.textContent = css;
  (document.head ?? document.documentElement).appendChild(styleEl);
};

class DefaultOriginManager implements OriginManager {
  private currentWrapper: HTMLElement | null = null;
  private mode: ViewMode = "remastered";
  private split: number;
  private readonly hotkeyEnabled: boolean;
  private readonly callbacks = new Set<(mode: ViewMode) => void>();

  constructor(opts?: OriginManagerOptions) {
    this.split = clamp(opts?.splitPercent ?? 50, 0, 100);
    this.hotkeyEnabled = opts?.hotkey !== false;
    if (this.hotkeyEnabled && typeof window !== "undefined") {
      window.addEventListener("keydown", this.onHotkey);
    }
  }

  get wrapper(): HTMLElement | null {
    return this.currentWrapper;
  }

  captureAndHideOrigin(): HTMLElement {
    if (typeof document === "undefined") {
      throw new Error("OriginManager requires a DOM environment");
    }
    if (this.currentWrapper && this.currentWrapper.isConnected) {
      return this.currentWrapper; // 幂等：已捕获直接返回
    }
    ensureStyle("data-wr-origin-style", ORIGIN_STYLE_CSS);
    const wrapper = document.createElement("div");
    wrapper.id = "wr-origin-wrapper";
    wrapper.setAttribute("data-wr-origin", "true");
    wrapper.setAttribute("data-wr-mode", "remastered");
    document.body.appendChild(wrapper);
    // 快照后逐个 appendChild 原址移动；跳过 wrapper 自身 / 脚本样式 / 我们的自定义元素
    const nodes = Array.from(document.body.childNodes);
    for (const node of nodes) {
      if (node === wrapper) continue;
      if (node.nodeType === 1) {
        const tag = (node as Element).tagName;
        if (tag === "SCRIPT" || tag === "STYLE" || tag === "LINK" || tag === "WEB-REMASTER-ROOT") {
          continue;
        }
      }
      wrapper.appendChild(node);
    }
    this.currentWrapper = wrapper;
    this.mode = "remastered";
    return wrapper;
  }

  getViewMode(): ViewMode {
    return this.mode;
  }

  setViewMode(mode: ViewMode): void {
    const prev = this.mode;
    this.mode = mode;
    const wrapper = this.currentWrapper;
    if (wrapper) {
      wrapper.setAttribute("data-wr-mode", mode);
      if (mode === "split") {
        wrapper.style.cssText =
          "position:fixed;left:0;top:0;width:100vw;height:100vh;opacity:1;pointer-events:auto;overflow:auto;z-index:2147483635;";
        this.applySplit();
        this.ensureSplitHandle();
      } else {
        // 离开 split：清掉全部 inline 覆盖，回到样式表控制的隐身/文档流状态
        wrapper.style.cssText = "";
        const host = document.querySelector("web-remaster-root");
        if (host instanceof HTMLElement) host.style.removeProperty("clip-path");
        this.removeSplitHandle();
      }
    }
    if (mode === "original") {
      document.documentElement.setAttribute("data-wr-view", "original");
    } else {
      document.documentElement.removeAttribute("data-wr-view");
    }
    if (mode !== prev) {
      for (const cb of Array.from(this.callbacks)) {
        try {
          cb(mode);
        } catch {
          /* 单个订阅者异常不阻断切换 */
        }
      }
    }
  }

  setSplitPercent(percent: number): void {
    this.split = clamp(Number.isFinite(percent) ? percent : 50, 0, 100);
    if (this.mode === "split") this.applySplit();
  }

  showFallbackToast(reason: string): void {
    if (typeof document === "undefined") return;
    ensureStyle("data-wr-toast-style", TOAST_CSS);
    const toast = document.createElement("div");
    toast.setAttribute("data-wr-toast", "true");
    toast.textContent = reason;
    const stacked = document.querySelectorAll("[data-wr-toast]").length;
    toast.style.bottom = `${24 + stacked * 48}px`;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, 2600);
  }

  onViewModeChange(cb: (mode: ViewMode) => void): () => void {
    this.callbacks.add(cb);
    return () => {
      this.callbacks.delete(cb);
    };
  }

  dispose(): void {
    if (typeof window !== "undefined") {
      window.removeEventListener("keydown", this.onHotkey);
    }
    this.removeSplitHandle();
    if (typeof document !== "undefined") {
      for (const attr of ["data-wr-origin-style", "data-wr-split-style", "data-wr-toast-style"]) {
        document.querySelector(`style[${attr}]`)?.remove();
      }
      for (const toast of Array.from(document.querySelectorAll("[data-wr-toast]"))) toast.remove();
      document.documentElement.removeAttribute("data-wr-view");
    }
    if (this.currentWrapper) {
      for (const node of Array.from(this.currentWrapper.childNodes)) {
        document.body.appendChild(node); // 完整还原现场
      }
      this.currentWrapper.remove();
      this.currentWrapper = null;
    }
    this.callbacks.clear();
    if (sharedInstance === this) sharedInstance = null;
  }

  private applySplit(): void {
    const wrapper = this.currentWrapper;
    if (!wrapper || this.mode !== "split") return;
    const p = this.split;
    wrapper.style.clipPath = `inset(0 ${100 - p}% 0 0)`;
    const host = document.querySelector("web-remaster-root");
    if (host instanceof HTMLElement) host.style.clipPath = `inset(0 0 0 ${p}%)`;
    const handle = document.getElementById("wr-split-handle");
    if (handle) handle.style.left = `calc(${p}% - 4px)`;
  }

  private ensureSplitHandle(): void {
    if (typeof document === "undefined") return;
    if (document.getElementById("wr-split-handle")) return;
    ensureStyle("data-wr-split-style", SPLIT_HANDLE_CSS);
    const handle = document.createElement("div");
    handle.id = "wr-split-handle";
    handle.setAttribute("data-wr-split-handle", "true");
    handle.addEventListener("mousedown", this.onHandleMouseDown);
    document.body.appendChild(handle);
    this.applySplit();
  }

  private removeSplitHandle(): void {
    if (typeof document === "undefined") return;
    document.getElementById("wr-split-handle")?.remove();
  }

  private onHandleMouseDown = (event: MouseEvent): void => {
    event.preventDefault();
    const move = (e: MouseEvent): void => {
      const percent = clamp((e.clientX / Math.max(1, window.innerWidth)) * 100, 2, 98);
      this.setSplitPercent(percent);
    };
    const up = (): void => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  private onHotkey = (event: KeyboardEvent): void => {
    if (!event.altKey || !event.shiftKey) return;
    if (event.key !== "R" && event.key !== "r") return;
    event.preventDefault();
    const order: ViewMode[] = ["remastered", "original", "split"];
    const next = order[(order.indexOf(this.mode) + 1) % order.length];
    this.setViewMode(next);
  };
}

let sharedInstance: DefaultOriginManager | null = null;

export function createOriginManager(opts?: OriginManagerOptions): OriginManager {
  const manager = new DefaultOriginManager(opts);
  if (!sharedInstance) sharedInstance = manager; // 第一个实例成为 shared
  return manager;
}

export function getSharedOriginManager(): OriginManager {
  if (!sharedInstance) sharedInstance = new DefaultOriginManager();
  return sharedInstance;
}
