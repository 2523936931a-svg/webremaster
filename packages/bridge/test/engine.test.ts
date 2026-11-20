/**
 * Step 1 硬性验收：引擎层行为。
 * ① 4 级提取器（Tier1/2/3/4 + iframe 穿透 + 健康度）；② 熔断器状态机；
 * ③ reactiveStore 熔断自动切回 original（验收③）与防抖刷新；④ TurboNav LRU/TTL/接管规则/无刷新导航。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractFieldWithCascade, HealthTracker, type FieldRule } from "../src/resilientExtractor.js";
import { CircuitBreaker } from "../src/circuitBreaker.js";
import { createOriginStore } from "../src/reactiveStore.js";
import { createOriginManager, getSharedOriginManager, type OriginManager } from "../src/originManager.js";
import { TurboNavigator } from "../src/turboNav.js";

const managers: OriginManager[] = [];
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const clearInjectedStyles = (): void => {
  document.head.querySelectorAll("style").forEach((el) => el.remove());
  for (const el of Array.from(document.documentElement.children)) {
    if (el.tagName === "STYLE") el.remove();
  }
  document.documentElement.removeAttribute("data-wr-ready");
  document.documentElement.removeAttribute("data-wr-view");
};

describe("resilientExtractor", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  const rule = (overrides: Partial<FieldRule>): FieldRule => ({
    fieldName: "f",
    fieldType: "string",
    selectors: [],
    attribute: "textContent",
    required: true,
    ...overrides,
  });

  it("Tier 1：selector 优先级降级链命中", () => {
    document.body.innerHTML = '<div id="host"><span class="b">B</span><em class="a">A</em></div>';
    const base = document.querySelector("#host")!;
    const tracker = new HealthTracker();
    const value = extractFieldWithCascade(
      base,
      rule({ fieldName: "t1", selectors: [".missing", ".a", ".b"] }),
      tracker,
    );
    expect(value).toBe("A"); // .a 优先级高于 .b
    expect(tracker.getHealth("t1")?.tier).toBe(1);
    expect(tracker.getHealth("t1")?.hits).toBe(1);
  });

  it("Tier 2：next-sibling 配对行（HN tr+tr 场景）", () => {
    document.body.innerHTML =
      '<table><tbody><tr class="athing" id="r1"><td class="title"><a href="https://example.com/a">Title A</a></td></tr>' +
      "<tr><td class=\"subtext\">42 points by sam 3 hours ago</td></tr></tbody></table>";
    const base = document.querySelector("#r1")!;
    const tracker = new HealthTracker();
    const value = extractFieldWithCascade(
      base,
      rule({ fieldName: "sub", selectors: [".subtext"], relativeTo: "next-sibling" }),
      tracker,
    );
    expect(value).toBe("42 points by sam 3 hours ago");
    expect(tracker.getHealth("sub")?.tier).toBe(2);
  });

  it("Tier 3：regexExtract 捕获组提取", () => {
    document.body.innerHTML =
      '<table><tbody><tr class="athing"><td class="title">T</td></tr><tr><td class="subtext">42 points by sam</td></tr></tbody></table>';
    const base = document.querySelector(".athing")!;
    const value = extractFieldWithCascade(
      base,
      rule({ fieldName: "points", selectors: [".subtext"], relativeTo: "next-sibling", regexExtract: "(\\d+) points" }),
    );
    expect(value).toBe("42");
  });

  it("Tier 4：spatialLabelRegex 同行下一 <td> 空间邻近定位", () => {
    document.body.innerHTML =
      '<table><tbody><tr id="row"><td>学号</td><td><input id="sid" value="2021001"></td></tr></tbody></table>';
    const base = document.querySelector("#row")!;
    const tracker = new HealthTracker();
    const value = extractFieldWithCascade(
      base,
      rule({ fieldName: "sid", selectors: [".does-not-exist"], spatialLabelRegex: "^学号$", attribute: "value" }),
      tracker,
    );
    expect(value).toBe("2021001");
    expect(tracker.getHealth("sid")?.tier).toBe(4);
  });

  it("Tier 4 兜底：<label for> 直连控件", () => {
    document.body.innerHTML =
      '<div id="host"><label for="mail">电子邮箱</label><input id="mail" value="a@b.c"></div>';
    const base = document.querySelector("#host")!;
    const value = extractFieldWithCascade(
      base,
      rule({ fieldName: "mail", selectors: [".nope"], spatialLabelRegex: "电子邮箱", attribute: "value" }),
    );
    expect(value).toBe("a@b.c");
  });

  it("iframe 穿透：字段在子框架文档中也能命中；跨域 SecurityError 安全跳过", () => {
    const host = document.createElement("div");
    host.id = "frame-host";
    document.body.appendChild(host);

    const sameOriginFrame = document.createElement("iframe");
    document.body.appendChild(sameOriginFrame);
    const frameDoc = document.implementation.createHTMLDocument("frame");
    frameDoc.body.innerHTML = '<span id="in-frame">F</span>';
    Object.defineProperty(sameOriginFrame, "contentDocument", {
      configurable: true,
      get: () => frameDoc,
    });

    const crossFrame = document.createElement("iframe");
    document.body.appendChild(crossFrame);
    Object.defineProperty(crossFrame, "contentDocument", {
      configurable: true,
      get: () => {
        throw new DOMException("Blocked a frame with origin", "SecurityError");
      },
    });

    const value = extractFieldWithCascade(host, rule({ fieldName: "ff", selectors: ["#in-frame"] }));
    expect(value).toBe("F");
    expect(() => {
      extractFieldWithCascade(host, rule({ fieldName: "ff2", selectors: [".whatever"] }));
    }).not.toThrow();
  });

  it("全部失败返回 null 并记录 miss；HealthTracker.summary 汇总正确", () => {
    document.body.innerHTML = "<div id=\"host\">nothing</div>";
    const tracker = new HealthTracker();
    const value = extractFieldWithCascade(
      document.querySelector("#host")!,
      rule({ fieldName: "gone", selectors: [".nope"] }),
      tracker,
    );
    expect(value).toBeNull();
    expect(tracker.getHealth("gone")?.misses).toBe(1);
    tracker.recordHit("good", 3);
    const summary = tracker.summary();
    expect(summary.totalFields).toBe(2);
    expect(summary.healthyFields).toBe(1);
    expect(summary.tierBreakdown["3"]).toBe(1);
    expect(summary.hitRate).toBeGreaterThan(0);
  });
});

describe("circuitBreaker", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("达到阈值才熔断；onTrip 仅跃迁触发一次", () => {
    const trips: string[] = [];
    const breaker = new CircuitBreaker({ failureThreshold: 2, onTrip: (r) => trips.push(r) });
    breaker.recordFailure("a");
    expect(breaker.getState()).toBe("closed");
    expect(breaker.getFailureCount()).toBe(1);
    breaker.recordFailure("b");
    expect(breaker.isTripped()).toBe(true);
    expect(trips).toEqual(["b"]);
    breaker.recordFailure("c"); // open 态不再重复触发
    expect(trips).toEqual(["b"]);
    breaker.reset();
    expect(breaker.getState()).toBe("closed");
    expect(breaker.getFailureCount()).toBe(0);
  });

  it("resetTimeoutMs>0：open 超时进入 half-open，成功回 closed 并触发 onReset", () => {
    vi.useFakeTimers();
    const events: string[] = [];
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 100,
      onTrip: () => events.push("trip"),
      onReset: () => events.push("reset"),
    });
    breaker.recordFailure("x");
    expect(events).toEqual(["trip"]);
    vi.advanceTimersByTime(150);
    expect(breaker.getState()).toBe("half-open");
    breaker.recordSuccess();
    expect(breaker.getState()).toBe("closed");
    expect(events).toEqual(["trip", "reset"]);
  });
});

describe("reactiveStore", () => {
  beforeEach(() => {
    managers.length = 0;
  });

  afterEach(() => {
    for (const manager of managers.splice(0)) manager.dispose();
    document.body.innerHTML = "";
    clearInjectedStyles();
    vi.useRealTimers();
  });

  it("成功路径：创建即提取、订阅者收到通知、DOM 变化触发防抖刷新", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    let data = ["a"];
    const extractSpy = vi.fn(() => data);
    const listener = vi.fn();
    const store = createOriginStore({ originRoot: root, extract: extractSpy, debounceMs: 30 });
    expect(store.getSnapshot()).toEqual(["a"]);
    const unsubscribe = store.subscribe(listener);

    data = ["a", "b"];
    root.appendChild(document.createElement("span"));
    await sleep(140);

    expect(extractSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(listener).toHaveBeenCalled();
    expect(store.getSnapshot()).toEqual(["a", "b"]);
    unsubscribe();
    store.dispose();
  });

  it("性能优化：isEqual 返回 true 时跳过通知，避免无谓重渲染", async () => {
    const rootEl = document.createElement("div");
    document.body.appendChild(rootEl);
    let count = 1;
    const extractSpy = vi.fn(() => ({ count }));
    const listener = vi.fn();
    const store = createOriginStore({
      originRoot: rootEl,
      extract: extractSpy,
      debounceMs: 20,
      isEqual: (prev, next) => prev?.count === next.count,
    });
    store.subscribe(listener);

    // 触发 DOM 变动但数据内容未变
    rootEl.appendChild(document.createElement("div"));
    await sleep(60);
    expect(listener).not.toHaveBeenCalled();

    // 数据真实变化
    count = 2;
    rootEl.appendChild(document.createElement("div"));
    await sleep(60);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toEqual({ count: 2 });
    store.dispose();
  });

  it("验收③：extract 抛错时自动熔断切回 original 并弹提示", () => {
    const manager = createOriginManager({ hotkey: false });
    managers.push(manager);
    manager.captureAndHideOrigin();
    expect(getSharedOriginManager()).toBe(manager); // 本用例内 shared 即当前 manager

    const store = createOriginStore({
      originRoot: manager.wrapper!,
      extract: () => {
        throw new Error("boom");
      },
    });
    expect(store.getSnapshot()).toBeNull();
    expect(manager.getViewMode()).toBe("original");
    expect(document.querySelector("[data-wr-toast]")?.textContent).toContain("boom");
  });

  it("验收③：空数据（validate 失败）同样熔断，onTripCircuit 收到原因", () => {
    const manager = createOriginManager({ hotkey: false });
    managers.push(manager);
    manager.captureAndHideOrigin();
    const onTripCircuit = vi.fn();
    const store = createOriginStore({
      originRoot: manager.wrapper!,
      extract: () => [] as string[],
      onTripCircuit,
    });
    expect(store.getSnapshot()).toBeNull();
    expect(manager.getViewMode()).toBe("original");
    expect(onTripCircuit).toHaveBeenCalledTimes(1);
    expect(String(onTripCircuit.mock.calls[0][0])).toContain("空数据");
  });

  it("熔断后 refresh 不再提取（永不白屏），返回上次快照", () => {
    const manager = createOriginManager({ hotkey: false });
    managers.push(manager);
    manager.captureAndHideOrigin();
    let shouldThrow = true;
    const extractSpy = vi.fn(() => {
      if (shouldThrow) throw new Error("boom");
      return ["ok"];
    });
    const store = createOriginStore({ originRoot: manager.wrapper!, extract: extractSpy });
    expect(store.getSnapshot()).toBeNull();
    shouldThrow = false;
    const after = store.refresh();
    expect(after).toBeNull();
    expect(extractSpy.mock.calls.length).toBe(1); // 熔断后不再提取
  });
});

describe("turboNav", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  const root = (): HTMLElement => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    return el;
  };

  it("shouldHandle：同源 GET 接管，跨域/非法协议/排除规则/纯 hash 放行原生跳转", () => {
    const nav = new TurboNavigator(root(), vi.fn(), { excludePatterns: [/logout/] });
    expect(nav.shouldHandle(new URL("/item?id=1", window.location.href).href)).toBe(true);
    expect(nav.shouldHandle("https://news.ycombinator.com/")).toBe(false);
    expect(nav.shouldHandle("javascript:alert(1)")).toBe(false);
    expect(nav.shouldHandle(new URL("/logout", window.location.href).href)).toBe(false);
    expect(nav.shouldHandle(new URL("#top", window.location.href).href)).toBe(false);
    nav.dispose();
  });

  it("移动端触控优化：touchstart 触发即时静默预取", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => "<html><head><title>Touch</title></head><body>Touch Target</body></html>",
    }));
    vi.stubGlobal("fetch", fetchMock);
    const container = root();
    const link = document.createElement("a");
    link.href = "/touch-page";
    container.appendChild(link);

    const nav = new TurboNavigator(container, vi.fn());
    link.dispatchEvent(new Event("touchstart", { bubbles: true }));
    await sleep(20);

    expect(fetchMock).toHaveBeenCalled();
    expect(nav.getCached(new URL("/touch-page", window.location.href).href)).toContain("Touch Target");
    nav.dispose();
  });

  it("LRU 缓存上限与淘汰", async () => {
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      text: async () => `<html><head><title>${url}</title></head><body><p>${url}</p></body></html>`,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const nav = new TurboNavigator(root(), vi.fn(), { maxCache: 2 });
    const base = window.location.origin;
    await nav.prefetch(`${base}/a`);
    await nav.prefetch(`${base}/b`);
    await nav.prefetch(`${base}/c`); // 淘汰最旧的 a
    expect(nav.getCached(`${base}/a`)).toBeNull();
    expect(nav.getCached(`${base}/b`)).not.toBeNull();
    expect(nav.getCached(`${base}/c`)).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await nav.prefetch(`${base}/c`); // 缓存命中不重复请求
    expect(fetchMock).toHaveBeenCalledTimes(3);
    nav.dispose();
  });

  it("TTL 过期懒删除", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, text: async () => "<html><body>x</body></html>" })),
    );
    const nav = new TurboNavigator(root(), vi.fn(), { ttlMs: 40 });
    const url = new URL("/d", window.location.href).href;
    await nav.prefetch(url);
    expect(nav.getCached(url)).not.toBeNull();
    await sleep(90);
    expect(nav.getCached(url)).toBeNull();
    nav.dispose();
  });

  it("navigate：解析新页并原子替换 wrapper 内容 + pushState + 标题 + onRouteChanged", async () => {
    const wrapper = document.createElement("div");
    wrapper.id = "wr-origin-wrapper";
    wrapper.textContent = "old";
    document.body.appendChild(wrapper);
    const pushSpy = vi.spyOn(window.history, "pushState").mockImplementation(() => {});
    const onRouteChanged = vi.fn();
    const nav = new TurboNavigator(wrapper, onRouteChanged);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        text: async () =>
          "<html><head><title>P2</title><style>.a{color:red}</style></head><body><p id='newp'>new content</p></body></html>",
      })),
    );

    await nav.navigate(new URL("/page2", window.location.href).href);

    const newp = wrapper.querySelector("#newp");
    expect(newp?.textContent).toBe("new content"); // 内容已替换
    expect(wrapper.textContent).not.toContain("old");
    expect(document.title).toBe("P2");
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(onRouteChanged).toHaveBeenCalledTimes(1);
    expect(onRouteChanged.mock.calls[0][0]).toBe(new URL("/page2", window.location.href).href);
    expect(document.querySelector("style")).not.toBeNull(); // head 样式已克隆
    nav.dispose();
  });

  it("fetch 失败自动降级 window.location.assign", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, text: async () => "" })));
    const assignSpy = vi.fn();
    const nav = new TurboNavigator(root(), vi.fn(), { onFallbackAssign: assignSpy });
    await nav.navigate(new URL("/broken", window.location.href).href);
    expect(assignSpy).toHaveBeenCalledTimes(1);
    expect(assignSpy.mock.calls[0][0]).toBe(new URL("/broken", window.location.href).href);
    nav.dispose();
  });
});
