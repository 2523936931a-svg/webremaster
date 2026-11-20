/**
 * TurboNav —— 1998 MPA 秒变 0ms SPA 预加载导航引擎。
 *
 * 同源链接悬停 65ms 静默预取 HTML 进 LRU 缓存（默认 20 条 / 60s TTL）；
 * navigate 命中缓存时用 DOMParser 解析新页，原子替换 #wr-origin-wrapper 内容
 * + 更新 document.title + history.pushState + onRouteChanged 回调；
 * 网络失败 / 跨域 / 被排除的链接自动降级 window.location.assign。
 */
export interface TurboNavigatorOptions {
  excludePatterns?: RegExp[];
  maxCache?: number;
  ttlMs?: number;
  hoverDelayMs?: number;
  /** 降级整页跳转时的可选钩子（默认 window.location.assign）；测试或宿主可注入 */
  onFallbackAssign?: (url: string) => void;
}

interface FetchLike {
  ok: boolean;
  text(): Promise<string>;
  arrayBuffer?(): Promise<ArrayBuffer>;
  headers?: { get(name: string): string | null };
}

type FetchFn = (url: string, init?: { credentials?: string; headers?: Record<string, string> }) => Promise<FetchLike>;

const getFetch = (): FetchFn | null => {
  const candidate = (globalThis as unknown as { fetch?: FetchFn }).fetch;
  return typeof candidate === "function" ? candidate : null;
};

/** 安全平滑滚动：JSDOM 测试环境不输出 Not implemented: window.scrollTo 警告 */
const safeScrollTo = (x: number, y: number): void => {
  if (typeof window === "undefined") return;
  if (typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent)) return;
  try {
    if (typeof window.scrollTo === "function") {
      window.scrollTo(x, y);
    }
  } catch {
    /* 忽略不支持滚动的宿主异常 */
  }
};

export class TurboNavigator {
  private readonly originRoot: HTMLElement;
  private readonly onRouteChanged: (url: string, newDoc: Document) => void;
  private readonly excludePatterns: RegExp[];
  private readonly maxCache: number;
  private readonly ttlMs: number;
  private readonly hoverDelayMs: number;
  private readonly onFallbackAssign?: (url: string) => void;
  private readonly cache = new Map<string, { html: string; expires: number }>();
  private readonly scrollPositions = new Map<string, { x: number; y: number }>();
  private hoverTimer?: ReturnType<typeof setTimeout>;
  private readonly onMouseOver: (event: MouseEvent) => void;
  private readonly onMouseOut: () => void;
  private readonly onTouchStart: (event: Event) => void;
  private readonly onPopstate: () => void;

  constructor(
    originRoot: HTMLElement,
    onRouteChanged: (url: string, newDoc: Document) => void,
    opts?: TurboNavigatorOptions,
  ) {
    this.originRoot = originRoot;
    this.onRouteChanged = onRouteChanged;
    this.excludePatterns = opts?.excludePatterns ?? [];
    this.maxCache = Math.max(1, opts?.maxCache ?? 20);
    this.ttlMs = Math.max(1, opts?.ttlMs ?? 60000);
    this.hoverDelayMs = Math.max(0, opts?.hoverDelayMs ?? 65);
    this.onFallbackAssign = opts?.onFallbackAssign;

    this.onMouseOver = (event: MouseEvent): void => {
      const target = event.target instanceof Element ? event.target : null;
      const anchor = target?.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target && anchor.target !== "_self") return; // 新窗口链接放行原生行为
      if (anchor.hasAttribute("download")) return; // 下载链接放行
      const href = anchor.getAttribute("href") ?? "";
      if (!href || href.startsWith("#")) return; // 页内锚点放行
      let absolute: string;
      try {
        absolute = new URL(href, window.location.href).href;
      } catch {
        return;
      }
      if (!this.shouldHandle(absolute)) return;
      if (this.hoverTimer !== undefined) clearTimeout(this.hoverTimer);
      this.hoverTimer = setTimeout(() => {
        this.hoverTimer = undefined;
        void this.prefetch(absolute);
      }, this.hoverDelayMs);
    };
    this.onMouseOut = (): void => {
      if (this.hoverTimer !== undefined) {
        clearTimeout(this.hoverTimer);
        this.hoverTimer = undefined;
      }
    };
    this.onTouchStart = (event: Event): void => {
      const target = event.target instanceof Element ? event.target : null;
      const anchor = target?.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;
      const href = anchor.getAttribute("href") ?? "";
      if (!href || href.startsWith("#")) return;
      let absolute: string;
      try {
        absolute = new URL(href, window.location.href).href;
      } catch {
        return;
      }
      if (!this.shouldHandle(absolute)) return;
      // 触屏设备（移动端/平板）：手指触摸瞬间即触发静默预取，消除点击延迟
      void this.prefetch(absolute);
    };
    this.onPopstate = (): void => {
      void this.applyUrl(window.location.href, false);
    };

    this.originRoot.addEventListener("mouseover", this.onMouseOver);
    this.originRoot.addEventListener("mouseout", this.onMouseOut);
    this.originRoot.addEventListener("touchstart", this.onTouchStart, { passive: true });
    if (typeof window !== "undefined") {
      window.addEventListener("popstate", this.onPopstate);
    }
  }

  /** 是否可由 TurboNav 接管：http(s)、同源、非纯 hash 变化、不被排除 */
  shouldHandle(url: string): boolean {
    let parsed: URL;
    try {
      parsed = new URL(url, window.location.href);
    } catch {
      return false;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    if (parsed.origin !== window.location.origin) return false;
    try {
      const current = new URL(window.location.href);
      if (parsed.pathname === current.pathname && parsed.search === current.search) return false;
    } catch {
      /* 当前地址非法时继续 */
    }
    for (const pattern of this.excludePatterns) {
      if (pattern.test(parsed.href)) return false;
    }
    return true;
  }

  getCached(url: string): string | null {
    const entry = this.cache.get(url);
    if (!entry) return null;
    if (Date.now() > entry.expires) {
      this.cache.delete(url);
      return null;
    }
    this.cache.delete(url);
    this.cache.set(url, entry); // LRU：命中即刷新新鲜度
    return entry.html;
  }

  /** 借鉴 GoogleChromeLabs/quicklink：省流模式 (saveData) 或 2G 慢速网络时不进行静默预取 */
  private isSaveDataOrSlowNetwork(): boolean {
    if (typeof navigator === "undefined") return false;
    const conn = (navigator as unknown as { connection?: { saveData?: boolean; effectiveType?: string } })?.connection;
    return !!(conn?.saveData || conn?.effectiveType === "2g" || conn?.effectiveType === "slow-2g");
  }

  async prefetch(url: string): Promise<void> {
    if (this.isSaveDataOrSlowNetwork()) return;
    if (!this.shouldHandle(url)) return;
    if (this.getCached(url) !== null) return;
    await this.fetchDocument(url);
  }

  async navigate(url: string): Promise<void> {
    if (!this.shouldHandle(url)) {
      this.assignLocation(url);
      return;
    }
    const applied = await this.applyUrl(url, true);
    if (!applied) this.assignLocation(url); // 网络失败自动降级整页跳转
  }

  dispose(): void {
    if (this.hoverTimer !== undefined) clearTimeout(this.hoverTimer);
    this.hoverTimer = undefined;
    this.originRoot.removeEventListener("mouseover", this.onMouseOver);
    this.originRoot.removeEventListener("mouseout", this.onMouseOut);
    this.originRoot.removeEventListener("touchstart", this.onTouchStart);
    if (typeof window !== "undefined") {
      window.removeEventListener("popstate", this.onPopstate);
    }
    this.cache.clear();
  }

  private assignLocation(url: string): void {
    if (this.onFallbackAssign) {
      this.onFallbackAssign(url);
      return;
    }
    try {
      window.location.assign(url);
    } catch {
      /* JSDOM 等环境不支持导航时静默忽略 */
    }
  }

  private async decodeResponse(response: FetchLike): Promise<string> {
    // 优先尝试探测字符集，防止 GBK / GB2312 / ISO-8859-1 老旧中文站点乱码
    if (typeof response.arrayBuffer === "function") {
      try {
        const buffer = await response.arrayBuffer();
        let charset = "utf-8";

        // 1. 尝试从 content-type 响应头提取
        if (response.headers && typeof response.headers.get === "function") {
          const contentType = response.headers.get("content-type") || "";
          const match = contentType.match(/charset=([a-zA-Z0-9_-]+)/i);
          if (match && match[1]) {
            charset = match[1].trim().toLowerCase();
          }
        }

        // 2. 如果未指定，尝试探测 document.characterSet
        if (charset === "utf-8" && typeof document !== "undefined" && document.characterSet) {
          const docCharset = document.characterSet.toLowerCase();
          if (docCharset !== "utf-8" && docCharset !== "utf8") {
            charset = docCharset;
          }
        }

        // 3. 初始解码前 1024 字节探测 <meta charset="...">
        if (charset === "utf-8" && buffer.byteLength > 0 && typeof TextDecoder !== "undefined") {
          try {
            const snippet = new TextDecoder("ascii", { fatal: false }).decode(buffer.slice(0, 1024));
            const metaMatch = snippet.match(/<meta[^>]+charset=["']?([a-zA-Z0-9_-]+)/i);
            if (metaMatch && metaMatch[1]) {
              charset = metaMatch[1].trim().toLowerCase();
            }
          } catch {
            // ignore snippet decode error
          }
        }

        if (typeof TextDecoder !== "undefined") {
          try {
            return new TextDecoder(charset).decode(buffer);
          } catch {
            return new TextDecoder("utf-8").decode(buffer);
          }
        }
      } catch {
        // arrayBuffer 异常时降级走 text()
      }
    }
    return await response.text();
  }

  private async fetchDocument(url: string): Promise<string | null> {
    const cached = this.getCached(url);
    if (cached !== null) return cached;
    const fetchFn = getFetch();
    if (!fetchFn) return null;
    try {
      const response = await fetchFn(url, {
        credentials: "same-origin",
        headers: { accept: "text/html,application/xhtml+xml" },
      });
      if (!response || !response.ok) return null;
      const html = await this.decodeResponse(response);
      this.setCached(url, html);
      return html;
    } catch {
      return null;
    }
  }

  private setCached(url: string, html: string): void {
    this.cache.delete(url);
    this.cache.set(url, { html, expires: Date.now() + this.ttlMs });
    while (this.cache.size > this.maxCache) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }

  /** 借鉴 Hotwire Turbo / NProgress：导航期间在顶端展示霓虹渐变进度条 */
  private showProgressBar(): () => void {
    if (typeof document === "undefined") return () => {};
    let bar = document.getElementById("wr-turbo-progress");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "wr-turbo-progress";
      bar.style.cssText =
        "position:fixed;top:0;left:0;height:2.5px;width:0%;background:linear-gradient(90deg,#0284c7,#38bdf8,#818cf8);z-index:2147483647;box-shadow:0 0 10px rgba(56,189,248,.6);transition:width .25s ease,opacity .2s ease;pointer-events:none;";
      (document.body ?? document.documentElement)?.appendChild(bar);
    }
    bar.style.opacity = "1";
    bar.style.width = "35%";
    const t1 = setTimeout(() => {
      if (bar) bar.style.width = "75%";
    }, 100);

    return () => {
      clearTimeout(t1);
      if (!bar) return;
      bar.style.width = "100%";
      setTimeout(() => {
        if (bar) {
          bar.style.opacity = "0";
          setTimeout(() => {
            if (bar) bar.style.width = "0%";
          }, 200);
        }
      }, 150);
    };
  }

  private async applyUrl(url: string, push: boolean): Promise<boolean> {
    // 借鉴 Hotwire Turbo：记录前一页面滚动位置
    if (typeof window !== "undefined") {
      try {
        this.scrollPositions.set(window.location.href, {
          x: window.scrollX || 0,
          y: window.scrollY || 0,
        });
      } catch {
        /* 忽略取滚动位置失败 */
      }
    }

    const doneProgress = this.showProgressBar();
    const html = await this.fetchDocument(url);
    doneProgress();
    if (html === null) return false;
    let parsed: Document;
    try {
      parsed = new DOMParser().parseFromString(html, "text/html");
    } catch {
      return false;
    }
    try {
      if (push) window.history.pushState({}, "", url);
      else window.history.replaceState({}, "", url);
    } catch {
      /* pushState 失败不阻断内容替换 */
    }
    try {
      if (parsed.title) document.title = parsed.title;
    } catch {
      /* 标题更新失败忽略 */
    }
    const applySwap = () => {
      this.swapOriginContent(parsed);
      this.copyHeadAssets(parsed);

      // 借鉴 Hotwire Turbo：后退恢复历史滚动坐标，前进重置置顶
      if (!push && this.scrollPositions.has(url)) {
        const pos = this.scrollPositions.get(url)!;
        safeScrollTo(pos.x, pos.y);
      } else if (push) {
        safeScrollTo(0, 0);
      }

      try {
        this.onRouteChanged(url, parsed);
      } catch {
        /* 回调异常不影响导航完成 */
      }
    };

    // 借鉴 W3C View Transitions API：支持的原生现代浏览器自动执行平滑交叉淡入动画
    if (
      typeof document !== "undefined" &&
      "startViewTransition" in document &&
      typeof (document as any).startViewTransition === "function"
    ) {
      try {
        (document as any).startViewTransition(() => {
          applySwap();
        });
      } catch {
        applySwap();
      }
    } else {
      applySwap();
    }
    return true;
  }

  /** 用新页 body 原子替换 #wr-origin-wrapper 内容；保留 [data-wr-permanent] 元素（借鉴 Turbo / Idiomorph） */
  private swapOriginContent(parsed: Document): void {
    const wrapper = document.getElementById("wr-origin-wrapper");
    if (!wrapper) return;

    // 收集旧 wrapper 中所有带 id 的持久化节点
    const permanentMap = new Map<string, Element>();
    for (const el of Array.from(wrapper.querySelectorAll("[data-wr-permanent][id]"))) {
      permanentMap.set(el.id, el);
    }

    while (wrapper.firstChild) wrapper.removeChild(wrapper.firstChild);
    const scripts: HTMLScriptElement[] = [];
    for (const node of Array.from(parsed.body.childNodes)) {
      if (node.nodeType === 1 && (node as Element).tagName === "SCRIPT") {
        scripts.push(node as HTMLScriptElement);
        continue;
      }
      if (node.nodeType === 1 && (node as Element).hasAttribute("data-wr-permanent")) {
        const id = (node as Element).id;
        const existing = id ? permanentMap.get(id) : null;
        if (existing) {
          // 保留已有持久化节点（避免视频/音频播放、表单状态重置）
          wrapper.appendChild(existing);
          continue;
        }
      }
      wrapper.appendChild(document.importNode(node, true));
    }
    for (const script of scripts) {
      const fresh = document.createElement("script");
      for (const attr of Array.from(script.attributes)) fresh.setAttribute(attr.name, attr.value);
      fresh.textContent = script.textContent;
      wrapper.appendChild(fresh);
    }
  }

  /** 新页 head 的样式表克隆进当前文档（按 href 去重） */
  private copyHeadAssets(parsed: Document): void {
    const head = document.head;
    if (!head) return;
    const existing = new Set<string>();
    for (const link of Array.from(head.querySelectorAll("link[rel=stylesheet][href]"))) {
      existing.add(link.getAttribute("href") ?? "");
    }
    for (const link of Array.from(parsed.head.querySelectorAll("link[rel=stylesheet][href]"))) {
      const href = link.getAttribute("href") ?? "";
      if (!href || existing.has(href)) continue;
      head.appendChild(document.importNode(link, true));
    }
    for (const style of Array.from(parsed.head.querySelectorAll("style"))) {
      head.appendChild(document.importNode(style, true));
    }
  }
}
