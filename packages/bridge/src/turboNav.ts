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
}

type FetchFn = (url: string, init?: { credentials?: string; headers?: Record<string, string> }) => Promise<FetchLike>;

const getFetch = (): FetchFn | null => {
  const candidate = (globalThis as unknown as { fetch?: FetchFn }).fetch;
  return typeof candidate === "function" ? candidate : null;
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
  private hoverTimer?: ReturnType<typeof setTimeout>;
  private readonly onMouseOver: (event: MouseEvent) => void;
  private readonly onMouseOut: () => void;
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
    this.onPopstate = (): void => {
      void this.applyUrl(window.location.href, false);
    };

    this.originRoot.addEventListener("mouseover", this.onMouseOver);
    this.originRoot.addEventListener("mouseout", this.onMouseOut);
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

  async prefetch(url: string): Promise<void> {
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
      const html = await response.text();
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

  private async applyUrl(url: string, push: boolean): Promise<boolean> {
    const html = await this.fetchDocument(url);
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
    this.swapOriginContent(parsed);
    this.copyHeadAssets(parsed);
    try {
      this.onRouteChanged(url, parsed);
    } catch {
      /* 回调异常不影响导航完成 */
    }
    return true;
  }

  /** 用新页 body 原子替换 #wr-origin-wrapper 内容；script 重建以真实执行 */
  private swapOriginContent(parsed: Document): void {
    const wrapper = document.getElementById("wr-origin-wrapper");
    if (!wrapper) return;
    while (wrapper.firstChild) wrapper.removeChild(wrapper.firstChild);
    const scripts: HTMLScriptElement[] = [];
    for (const node of Array.from(parsed.body.childNodes)) {
      if (node.nodeType === 1 && (node as Element).tagName === "SCRIPT") {
        scripts.push(node as HTMLScriptElement);
        continue;
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
