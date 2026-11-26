/**
 * Step 1 硬性验收：运行时核心行为。
 * ① 原址移动后原站 addEventListener 依然触发；② 幕帘 failsafe；③ Shadow DOM 挂载与 @property 剥离；
 * ④ 三态视图与分屏；⑤ nativeSetInputValue 派发 input+change；⑥ 传送门搬运与归还。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installZeroFlashCurtain } from "../src/curtain.js";
import { createOriginManager, getSharedOriginManager, type OriginManager } from "../src/originManager.js";
import { extractCssAtPropertyRules, mountWebRemasterRoot, getRemasterPortalRoot } from "../src/shadowMount.js";

import { nativeSetInputValue, nativeSubmitForm, nativeTriggerClick } from "../src/nativeDispatch.js";
import { createPortalSlotController } from "../src/portalSlot.js";

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

describe("originManager", () => {
  beforeEach(() => {
    managers.length = 0;
  });

  afterEach(() => {
    for (const manager of managers.splice(0)) manager.dispose();
    document.body.innerHTML = "";
    clearInjectedStyles();
    vi.useRealTimers();
  });

  it("原址移动节点后，原站 addEventListener 回调依然触发（验收①）", () => {
    const manager = createOriginManager({ hotkey: false });
    managers.push(manager);
    const button = document.createElement("button");
    button.id = "legacy-btn";
    document.body.appendChild(button);
    let clicks = 0;
    button.addEventListener("click", () => {
      clicks += 1;
    });

    const wrapper = manager.captureAndHideOrigin();
    expect(wrapper.id).toBe("wr-origin-wrapper");
    expect(wrapper.getAttribute("data-wr-origin")).toBe("true");
    expect(wrapper.querySelector("#legacy-btn")).not.toBeNull();
    expect(wrapper.getAttribute("data-wr-mode")).toBe("remastered");

    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(clicks).toBe(1); // 移动不破坏监听器
  });

  it("captureAndHideOrigin 幂等且跳过 script/style/link/web-remaster-root", () => {
    const manager = createOriginManager({ hotkey: false });
    managers.push(manager);
    const keep = document.createElement("web-remaster-root");
    document.body.appendChild(keep);
    const script = document.createElement("script");
    document.body.appendChild(script);

    const first = manager.captureAndHideOrigin();
    const second = manager.captureAndHideOrigin();
    expect(second).toBe(first);
    expect(keep.parentNode).toBe(document.body); // 自定义宿主不被包裹
    expect(script.parentNode).toBe(document.body);
    const style = document.createElement("style");
    document.body.appendChild(style);
    expect(style.parentNode).toBe(document.body);
  });

  it("借鉴 uBlock：原站隐身后自动静音背景音视频与停止跑马灯，杜绝幽灵播放与 CPU 浪费", () => {
    const manager = createOriginManager({ hotkey: false });
    managers.push(manager);
    const audio = document.createElement("audio");
    audio.src = "background-music.mp3";
    audio.muted = false;
    document.body.appendChild(audio);

    const marquee = document.createElement("marquee") as unknown as HTMLElement & { stop: () => void };
    marquee.stop = vi.fn();
    document.body.appendChild(marquee);

    manager.captureAndHideOrigin();
    expect(audio.muted).toBe(true);
    expect(marquee.stop).toHaveBeenCalled();
  });

  it("Alt+Shift+R 循环切换 remastered → original → split → remastered", () => {
    const manager = createOriginManager();
    managers.push(manager);
    manager.captureAndHideOrigin();
    const press = (): void => {
      window.dispatchEvent(new KeyboardEvent("keydown", { altKey: true, shiftKey: true, key: "R" }));
    };
    press();
    expect(manager.getViewMode()).toBe("original");
    expect(document.documentElement.getAttribute("data-wr-view")).toBe("original");
    press();
    expect(manager.getViewMode()).toBe("split");
    expect(document.getElementById("wr-split-handle")).not.toBeNull();
    press();
    expect(manager.getViewMode()).toBe("remastered");
    expect(document.documentElement.hasAttribute("data-wr-view")).toBe(false);
    expect(document.getElementById("wr-split-handle")).toBeNull();
  });

  it("onViewModeChange 订阅在模式切换时收到通知，退订后不再收到", () => {
    const manager = createOriginManager({ hotkey: false });
    managers.push(manager);
    manager.captureAndHideOrigin();
    const seen: string[] = [];
    const unsubscribe = manager.onViewModeChange((mode) => seen.push(mode));
    manager.setViewMode("original");
    unsubscribe();
    manager.setViewMode("remastered");
    expect(seen).toEqual(["original"]);
  });

  it("split 模式：两侧各自重排（原站收窄 + 重制占右半）+ 分割手柄 + setSplitPercent 实时生效", () => {
    const hostElement = document.createElement("web-remaster-root");
    document.body.appendChild(hostElement);
    const manager = createOriginManager({ hotkey: false, splitPercent: 50 });
    managers.push(manager);
    const wrapper = manager.captureAndHideOrigin();
    manager.setViewMode("split");
    // 左半是收窄后的原站（不是 clip）：窄屏下流式布局会重排，右对齐的分数/评论数不被切掉
    expect(wrapper.style.width).toBe("50vw");
    expect(wrapper.style.clipPath).toBe("");
    expect(wrapper.style.pointerEvents).toBe("auto");
    expect(wrapper.style.overflow).toBe("auto");
    // 右半是重制界面，整体定位而不是裁右半
    const host = document.querySelector("web-remaster-root") as HTMLElement | null;
    expect(host).not.toBeNull();
    expect(host!.style.left).toBe("50%");
    expect(host!.style.width).toBe("50vw");
    expect(host!.style.position).toBe("fixed");
    expect(host!.style.clipPath).toBe("none");
    expect(document.getElementById("wr-split-handle")).not.toBeNull();
    manager.setSplitPercent(30);
    expect(wrapper.style.width).toBe("30vw");
    expect(host!.style.left).toBe("30%");
    expect(host!.style.width).toBe("70vw");
    const handle = document.getElementById("wr-split-handle");
    expect(handle?.style.left).toBe("calc(30% - 4px)");
    manager.setViewMode("original");
    expect(wrapper.style.cssText).toBe("");
    expect(host!.style.position).toBe("");
    expect(host!.style.left).toBe("");
    expect(host!.style.width).toBe("");
    expect(document.getElementById("wr-split-handle")).toBeNull();
  });

  it("showFallbackToast 弹出并在 2600ms 后自动移除", () => {
    vi.useFakeTimers();
    const manager = createOriginManager({ hotkey: false });
    managers.push(manager);
    manager.captureAndHideOrigin();
    manager.showFallbackToast("boom");
    const toast = document.querySelector("[data-wr-toast]");
    expect(toast?.textContent).toContain("boom");
    vi.advanceTimersByTime(2700);
    expect(document.querySelector("[data-wr-toast]")).toBeNull();
  });

  it("dispose 完整还原现场：节点回到 body、注入样式被移除", () => {
    const manager = createOriginManager({ hotkey: false });
    const button = document.createElement("button");
    document.body.appendChild(button);
    manager.captureAndHideOrigin();
    expect(button.closest("#wr-origin-wrapper")).not.toBeNull();
    manager.dispose();
    expect(button.parentNode).toBe(document.body);
    expect(document.querySelector("style[data-wr-origin-style]")).toBeNull();
  });
});

describe("curtain", () => {
  afterEach(() => {
    vi.useRealTimers();
    clearInjectedStyles();
  });

  it("安装即注入幕帘样式，body 进入隐藏态；lift 幂等揭幕", () => {
    const lift = installZeroFlashCurtain({ failsafeMs: 10_000 });
    const styleEl = document.querySelector("style[data-wr-curtain]");
    expect(styleEl).not.toBeNull();
    expect(styleEl?.textContent).toContain("visibility:hidden!important");
    expect(document.documentElement.getAttribute("data-wr-ready")).toBeNull(); // 未揭幕前不得就绪
    lift();
    expect(document.documentElement.getAttribute("data-wr-ready")).toBe("true");
    expect(() => lift()).not.toThrow(); // 幂等
  });

  it("liftCurtain 幂等：重复调用不报错、不重复定时", () => {
    vi.useFakeTimers();
    const lift = installZeroFlashCurtain({ failsafeMs: 5000 });
    lift();
    expect(() => lift()).not.toThrow();
    vi.advanceTimersByTime(200);
    expect(document.querySelector("style[data-wr-curtain]")).toBeNull(); // 120ms 淡出后移除
  });

  it("failsafe 超时无论任何情况自动揭幕（验收：数学上杜绝永久白屏）", () => {
    vi.useFakeTimers();
    installZeroFlashCurtain({ failsafeMs: 80 });
    expect(document.documentElement.getAttribute("data-wr-ready")).toBeNull();
    // failsafe 80ms 后必然揭幕：即使上层从不调用 lift
    vi.advanceTimersByTime(120);
    expect(document.documentElement.getAttribute("data-wr-ready")).toBe("true");
    vi.advanceTimersByTime(300);
    expect(document.querySelector("style[data-wr-curtain]")).toBeNull();
  });
});

describe("shadowMount", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    clearInjectedStyles();
  });

  it("extractCssAtPropertyRules 精准提取全部 @property 块", () => {
    const css = "@property --a{syntax:'<length>';inherits:false;initial-value:0px;}\n.x{color:red}\n@property --b{syntax:'<color>';inherits:true;initial-value:#fff;}";
    const rules = extractCssAtPropertyRules(css);
    expect(rules).toHaveLength(2);
    expect(rules[0]).toContain("@property --a");
    expect(rules[1]).toContain("@property --b");
    expect(extractCssAtPropertyRules(".plain{color:red}")).toHaveLength(0);
  });

  it("挂载 web-remaster-root：open ShadowRoot + @property 提升主文档 + JSDOM 降级 Shadow 内 <style>", () => {
    const cssText = "@property --wr-x{syntax:'<color>';inherits:false;initial-value:#fff;}\n.card{box-shadow:var(--wr-x);}";
    const { host, shadowRoot } = mountWebRemasterRoot("test-app", cssText);
    expect(host.getAttribute("data-wr-app")).toBe("test-app");
    expect(shadowRoot.mode).toBe("open");
    const props = document.querySelector("style[data-wr-tw-props]");
    expect(props?.textContent).toContain("@property --wr-x");
    // JSDOM 未实现 CSSStyleSheet.replaceSync → 走降级分支
    const fallback = shadowRoot.querySelector("style");
    expect(fallback?.textContent).toContain(".card");
    expect(document.querySelector("style[data-wr-host-style]")).not.toBeNull();
  });

  it("mountWebRemasterRoot 重复挂载同 appId 时先清理旧 host，防止多根堆叠内存泄漏", () => {
    const res1 = mountWebRemasterRoot("duplicate-app", "");
    expect(document.querySelectorAll('web-remaster-root[data-wr-app="duplicate-app"]').length).toBe(1);

    const res2 = mountWebRemasterRoot("duplicate-app", "");
    expect(document.querySelectorAll('web-remaster-root[data-wr-app="duplicate-app"]').length).toBe(1);
    expect(res2.host).not.toBe(res1.host);
  });

  it("Shadow DOM 专属 Portal 节点与 destroy() 生命周期清理", () => {
    const { host, portalRoot, destroy } = mountWebRemasterRoot("portal-app", "");
    expect(portalRoot.id).toBe("wr-portal-root");
    expect(getRemasterPortalRoot("portal-app")).toBe(portalRoot);

    destroy();
    expect(document.querySelector('web-remaster-root[data-wr-app="portal-app"]')).toBeNull();
  });
});



describe("nativeDispatch", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("nativeSetInputValue 写值并派发 input+change（验收②），且重置 _valueTracker", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const input = document.createElement("input");
    parent.appendChild(input);
    const events: string[] = [];
    parent.addEventListener("input", () => events.push("input"));
    parent.addEventListener("change", () => events.push("change"));
    const tracker = { setValue: vi.fn() };
    (input as unknown as { _valueTracker?: unknown })._valueTracker = tracker;

    nativeSetInputValue(input, "hello");
    expect(input.value).toBe("hello");
    expect(events).toEqual(["input", "change"]); // bubbles 到达父级
    expect(tracker.setValue).toHaveBeenCalledWith("__wr_dirty__");
  });

  it("nativeTriggerClick 派发完整点击序列", () => {
    const button = document.createElement("button");
    document.body.appendChild(button);
    const events: string[] = [];
    for (const type of ["pointerdown", "mousedown", "mouseup", "click"]) {
      button.addEventListener(type, () => events.push(type));
    }
    nativeTriggerClick(button);
    expect(events).toEqual(expect.arrayContaining(["mousedown", "mouseup", "click"]));
    expect(events.indexOf("mousedown")).toBeLessThan(events.indexOf("mouseup"));
    expect(events.indexOf("mouseup")).toBeLessThan(events.indexOf("click"));
  });

  it("nativeSubmitForm 优先点击提交按钮（保住 CSRF 隐藏域）", () => {
    const form = document.createElement("form");
    const hidden = document.createElement("input");
    hidden.type = "hidden";
    hidden.name = "__VIEWSTATE";
    hidden.value = "csrf_token_9981";
    const button = document.createElement("button");
    button.id = "submit-btn";
    button.type = "button";
    form.append(hidden, button);
    document.body.appendChild(form);
    let clicks = 0;
    button.addEventListener("click", () => {
      clicks += 1;
    });
    nativeSubmitForm(form, ["#submit-btn"]);
    expect(clicks).toBe(1);
    expect(hidden.parentNode).toBe(form); // 隐藏域原位保留
  });
});

describe("portalSlot", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("project 物理搬移活体节点进 host Light DOM 并留下 Comment 锚点；restore 精确归还", () => {
    const host = document.createElement("web-remaster-root");
    document.body.appendChild(host);
    const wrap = document.createElement("div");
    document.body.appendChild(wrap);
    const img = document.createElement("img");
    img.id = "captcha";
    wrap.appendChild(img);

    const controller = createPortalSlotController(document.body, ["#captcha"], "captcha", host);
    expect(controller.project()).toBe(img);
    expect(controller.isProjected()).toBe(true);
    const container = host.querySelector('[data-wr-portal-slot="captcha"]');
    expect(container?.contains(img)).toBe(true); // 物理搬移（同一节点）
    const anchorInWrap = Array.from(wrap.childNodes).some(
      (node) => node.nodeType === 8 && (node.nodeValue ?? "").startsWith("wr-portal-anchor:captcha"),
    );
    expect(anchorInWrap).toBe(true);

    controller.restore();
    expect(controller.isProjected()).toBe(false);
    expect(wrap.contains(img)).toBe(true); // 归还原位
    expect(host.querySelector('[data-wr-portal-slot="captcha"]')).toBeNull();
    const anchorsLeft = Array.from(wrap.childNodes).filter(
      (node) => node.nodeType === 8 && (node.nodeValue ?? "").startsWith("wr-portal-anchor"),
    );
    expect(anchorsLeft).toHaveLength(0);
  });

  it("project 幂等；restore 未投影时安全 no-op", () => {
    const host = document.createElement("web-remaster-root");
    document.body.appendChild(host);
    const wrap = document.createElement("div");
    const span = document.createElement("span");
    span.id = "live";
    wrap.appendChild(span);
    document.body.appendChild(wrap);
    const controller = createPortalSlotController(document.body, ["#live"], "live", host);
    expect(controller.project()).toBe(span);
    expect(controller.project()).toBe(span);
    expect(() => controller.restore()).not.toThrow();
    expect(() => controller.restore()).not.toThrow();
    expect(wrap.contains(span)).toBe(true);
  });
});
