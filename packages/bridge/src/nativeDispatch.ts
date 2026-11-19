/**
 * NativeDispatch —— 跨框架原生事件桥。
 *
 * 输入赋值走原型链原生 value setter（绕过 React/Vue/jQuery 的属性劫持），
 * 并派发 input/change；含 React 16~19 受控组件 _valueTracker 破壁补丁；
 * 点击派发 pointerdown → mousedown → mouseup → click 完整序列；
 * 表单提交优先点真实提交按钮（保住原站 CSRF / __doPostBack），其次 requestSubmit()/submit()。
 */

type InputLike = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/** React 16~19 在受控输入上挂的内部值追踪器 */
interface ValueTracker {
  setValue(v: string): void;
}

/** 单次派发失败绝不阻断后续事件序列 */
const safeDispatch = (el: Element, event: Event): void => {
  try {
    el.dispatchEvent(event);
  } catch {
    /* 忽略单次派发异常 */
  }
};

export function nativeSetInputValue(el: InputLike, value: string): void {
  // SSR 安全：无 document 时优雅返回
  if (typeof document === "undefined" || !el) return;

  // 按真实构造器选原型，用原生 setter 写值，绕过框架对 .value 的劫持
  let proto: object | null = null;
  if (typeof HTMLTextAreaElement !== "undefined" && el instanceof HTMLTextAreaElement) {
    proto = HTMLTextAreaElement.prototype;
  } else if (typeof HTMLSelectElement !== "undefined" && el instanceof HTMLSelectElement) {
    proto = HTMLSelectElement.prototype;
  } else if (typeof HTMLInputElement !== "undefined" && el instanceof HTMLInputElement) {
    proto = HTMLInputElement.prototype;
  }

  let setterApplied = false;
  if (proto) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    if (descriptor && typeof descriptor.set === "function") {
      descriptor.set.call(el, value);
      setterApplied = true;
    }
  }
  if (!setterApplied) {
    // 拿不到原生 setter（如跨 realm 元素）：回退直接赋值
    (el as HTMLInputElement).value = value;
  }

  // React 16~19 破壁：重置 _valueTracker，否则受控组件会吞掉合成 onChange
  const tracker = (el as unknown as { _valueTracker?: ValueTracker })._valueTracker;
  if (tracker && typeof tracker.setValue === "function") {
    tracker.setValue("__wr_dirty__");
  }

  // 先 input 后 change；InputEvent 不存在时降级为普通 Event
  if (typeof InputEvent !== "undefined") {
    safeDispatch(
      el,
      new InputEvent("input", {
        bubbles: true,
        cancelable: true,
        data: value,
        inputType: "insertText",
      }),
    );
  } else {
    safeDispatch(el, new Event("input", { bubbles: true, cancelable: true }));
  }
  safeDispatch(el, new Event("change", { bubbles: true }));
}

export function nativeTriggerClick(el: Element): void {
  // SSR 安全：无 document 时优雅返回
  if (typeof document === "undefined" || !el) return;

  // 滚动到可见区域；JSDOM / 旧浏览器未实现 scrollIntoView 时静默跳过
  try {
    el.scrollIntoView?.({ block: "nearest" });
  } catch {
    /* not implemented —— 忽略 */
  }

  const mouseInit: MouseEventInit = { bubbles: true, cancelable: true, button: 0, buttons: 1 };
  const hasPointerEvent = typeof PointerEvent !== "undefined";

  if (hasPointerEvent) {
    safeDispatch(el, new PointerEvent("pointerdown", mouseInit));
  } else {
    // PointerEvent 不存在：pointer 系列降级为 MouseEvent
    safeDispatch(el, new MouseEvent("pointerdown", mouseInit));
  }
  safeDispatch(el, new MouseEvent("mousedown", mouseInit));
  safeDispatch(el, new MouseEvent("mouseup", mouseInit));
  safeDispatch(el, new MouseEvent("click", mouseInit));
}

export function nativeSubmitForm(el: Element, submitBtnSelectors?: string[]): void {
  // SSR 安全：无 document 时优雅返回
  if (typeof document === "undefined" || !el) return;

  // 优先点击真实提交按钮（携带原站隐藏 CSRF / __doPostBack 逻辑）
  if (submitBtnSelectors && submitBtnSelectors.length > 0) {
    const scope: ParentNode = el.closest("form") ?? document;
    for (const selector of submitBtnSelectors) {
      if (typeof selector !== "string" || selector.length === 0) continue;
      let button: Element | null = null;
      try {
        button = scope.querySelector(selector);
      } catch {
        button = null; // 非法选择器：跳过继续降级
      }
      if (button) {
        nativeTriggerClick(button);
        return;
      }
    }
  }

  const form = el.closest<HTMLFormElement>("form");
  if (!form) return; // 不在表单内：静默返回

  if (typeof form.requestSubmit === "function") {
    try {
      form.requestSubmit();
      return;
    } catch {
      // requestSubmit 异常时降级 submit()
    }
  }
  try {
    form.submit();
  } catch {
    /* submit 不可用（如 JSDOM 未实现导航）时静默忽略 */
  }
}
