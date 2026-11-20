/**
 * ElementZapper —— 灵感源自 Arc Browser (Arc Boosts) 的标志性「Zap」元素粉碎枪。
 *
 * 核心能力：
 * 1. 交互式高亮瞄准：鼠标悬停任意恼人广告、悬浮小广告或无关组件时提供发光瞄准框；
 * 2. 持久化消除：点击即触发粉碎消除，并将高健壮度选择器持久化至 localStorage；
 * 3. 自动静默屏蔽：后续刷新或无刷新导航时，自动预先屏蔽已消除的元素；
 * 4. 撤销与重置：随时通过快捷键或指令重置已消除的元素。
 */

export interface ZapperOptions {
  storagePrefix?: string;
  onZapped?: (selector: string) => void;
}

const DEFAULT_STORAGE_PREFIX = "wr_zapped_selectors_";

function getStorageKey(): string {
  const host = typeof window !== "undefined" ? window.location.hostname : "localhost";
  return `${DEFAULT_STORAGE_PREFIX}${host}`;
}

export function getZappedSelectors(): string[] {
  if (typeof window === "undefined" || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(getStorageKey());
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveZappedSelector(selector: string): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const list = getZappedSelectors();
    if (!list.includes(selector)) {
      list.push(selector);
      window.localStorage.setItem(getStorageKey(), JSON.stringify(list));
    }
  } catch {
    // ignore
  }
}

export function resetZappedSelectors(): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.removeItem(getStorageKey());
    // 移除已注入的样式
    const styleEl = document.getElementById("wr-zapper-styles");
    if (styleEl) styleEl.remove();
  } catch {
    // ignore
  }
}

/** 注入全局隐藏样式，对当前页面和后续动态加载内容持续生效 */
export function applyZappedSelectors(): void {
  if (typeof document === "undefined") return;
  const selectors = getZappedSelectors();
  if (selectors.length === 0) return;

  let styleEl = document.getElementById("wr-zapper-styles") as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = "wr-zapper-styles";
    (document.head || document.documentElement).appendChild(styleEl);
  }

  styleEl.textContent = `${selectors.join(",\n")} { display: none !important; }`;
}

function safeEscape(str: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(str);
  }
  return str.replace(/([!"#$%&'()*+,.\/:;<=>?@[\\\]^`{|}~])/g, "\\$1");
}

/** 智能推导元素的精简且高唯一性 CSS 选择器 */
export function computeResilientSelector(el: Element): string {
  if (el.id && !/^\d/.test(el.id)) {
    return `#${safeEscape(el.id)}`;
  }

  const tagName = el.tagName.toLowerCase();
  const meaningfulClasses = Array.from(el.classList).filter(
    (c) => !c.startsWith("wr-") && !c.includes("hover") && !c.includes("active") && c.length > 2,
  );

  if (meaningfulClasses.length > 0) {
    const classSelector = `${tagName}.${meaningfulClasses.slice(0, 2).map((c) => safeEscape(c)).join(".")}`;
    try {
      if (document.querySelectorAll(classSelector).length === 1) {
        return classSelector;
      }
    } catch {
      // ignore
    }
  }

  // 兜底：计算在父容器中的路径位置
  const parent = el.parentElement;
  if (!parent || parent === document.body) {
    return tagName;
  }

  const parentSelector = parent.id
    ? `#${safeEscape(parent.id)}`
    : parent.classList.length > 0
      ? `.${safeEscape(parent.classList[0]!)}`
      : parent.tagName.toLowerCase();

  const index = Array.from(parent.children).indexOf(el) + 1;
  return `${parentSelector} > ${tagName}:nth-child(${index})`;
}


let isZapperActive = false;
let overlayEl: HTMLDivElement | null = null;
let currentHoveredEl: Element | null = null;

function createOverlay(): HTMLDivElement {
  const div = document.createElement("div");
  div.id = "wr-zapper-overlay";
  div.style.cssText = `
    position: fixed;
    pointer-events: none;
    z-index: 2147483640;
    transition: all 0.08s ease-out;
    border: 2px dashed #f43f5e;
    background: rgba(244, 63, 94, 0.15);
    border-radius: 4px;
    box-shadow: 0 0 20px rgba(244, 63, 94, 0.3);
    display: none;
  `;

  const badge = document.createElement("div");
  badge.id = "wr-zapper-badge";
  badge.style.cssText = `
    position: absolute;
    top: -26px;
    left: 0;
    background: #f43f5e;
    color: white;
    font-size: 11px;
    font-weight: bold;
    padding: 2px 8px;
    border-radius: 4px;
    white-space: nowrap;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
  `;
  badge.textContent = "🎯 点击粉碎此元素 (ESC 退出)";
  div.appendChild(badge);

  document.body.appendChild(div);
  return div;
}

export function startElementZapper(options?: ZapperOptions): void {
  if (typeof document === "undefined" || isZapperActive) return;
  isZapperActive = true;

  if (!overlayEl) {
    overlayEl = createOverlay();
  }

  const handlePointerMove = (e: MouseEvent) => {
    const target = document.elementFromPoint(e.clientX, e.clientY);
    if (!target || target === overlayEl || target.closest("#wr-shadow-host") || target.closest("#wr-origin-wrapper")) {
      if (overlayEl) overlayEl.style.display = "none";
      currentHoveredEl = null;
      return;
    }

    currentHoveredEl = target;
    const rect = target.getBoundingClientRect();
    if (overlayEl) {
      overlayEl.style.display = "block";
      overlayEl.style.top = `${rect.top}px`;
      overlayEl.style.left = `${rect.left}px`;
      overlayEl.style.width = `${rect.width}px`;
      overlayEl.style.height = `${rect.height}px`;
    }
  };

  const handleClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (currentHoveredEl) {
      const selector = computeResilientSelector(currentHoveredEl);
      saveZappedSelector(selector);
      applyZappedSelectors();

      if (options?.onZapped) {
        options.onZapped(selector);
      }
    }
    stopElementZapper();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      stopElementZapper();
    }
  };

  const cleanupListeners = () => {
    window.removeEventListener("mousemove", handlePointerMove, true);
    window.removeEventListener("click", handleClick, true);
    window.removeEventListener("keydown", handleKeyDown, true);
  };

  (window as any).__wr_zapper_cleanup = cleanupListeners;

  window.addEventListener("mousemove", handlePointerMove, true);
  window.addEventListener("click", handleClick, true);
  window.addEventListener("keydown", handleKeyDown, true);
}

export function stopElementZapper(): void {
  isZapperActive = false;
  if (overlayEl) {
    overlayEl.style.display = "none";
  }
  currentHoveredEl = null;

  if (typeof (window as any).__wr_zapper_cleanup === "function") {
    (window as any).__wr_zapper_cleanup();
    delete (window as any).__wr_zapper_cleanup;
  }
}

export function toggleElementZapper(options?: ZapperOptions): boolean {
  if (isZapperActive) {
    stopElementZapper();
    return false;
  } else {
    startElementZapper(options);
    return true;
  }
}
