/**
 * Vim 导航的输入上下文判定。
 *
 * 回归背景：Shadow DOM 把 event.target 重定向为宿主元素（web-remaster-root），
 * 原实现只看 target.tagName，导致命令面板里按 Enter 时 Vim 仍执行 onActivate，
 * 与面板自身命令形成双触发（TurboNav 导航并把页面滚动复位为 0）。
 * 这里锁定三条契约：真实起点是输入控件、面板开着（含焦点在 body）、普通页面按键。
 */
import { afterEach, describe, expect, it } from "vitest";
import { isTypingContext } from "../src/powerups/useVimNavigation.js";

const dispatch = (target: EventTarget, key = "Enter"): KeyboardEvent => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, composed: true });
  target.dispatchEvent(event);
  return event;
};

afterEach(() => {
  document.body.innerHTML = "";
  document.head.querySelectorAll("style").forEach((el) => el.remove());
});

describe("isTypingContext", () => {
  it("shadowRoot 内的 input 按键被识别为输入中（composedPath 起点优先）", () => {
    const host = document.createElement("web-remaster-root");
    const root = host.attachShadow({ mode: "open" });
    const input = document.createElement("input");
    root.appendChild(input);
    document.body.appendChild(host);

    const event = dispatch(input);
    // 让 composedPath 明确指向 shadow 内的 input（模拟真实 composed 事件）
    Object.defineProperty(event, "composedPath", { value: () => [input, root, host, document.body, document, window] });

    expect(event.target).toBe(host); // 宿主重定向证据
    expect(isTypingContext(event)).toBe(true);
  });

  it("命令面板打开时，焦点落在 body 也不把按键当成 Vim", () => {
    const host = document.createElement("web-remaster-root");
    const root = host.attachShadow({ mode: "open" });
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    root.appendChild(dialog);
    document.body.appendChild(host);

    const event = dispatch(document.body);
    expect(isTypingContext(event)).toBe(true);
  });

  it("普通页面按键不被拦截（Vim j/k/Enter 仍工作）", () => {
    const event = dispatch(document.body);
    expect(isTypingContext(event)).toBe(false);
  });
});
