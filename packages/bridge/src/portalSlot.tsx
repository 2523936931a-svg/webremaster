/**
 * NativePortalSlot —— 活体传送门。
 *
 * 把原站活体节点（验证码 <img>、Canvas、视频等）用 appendChild 物理搬移进
 * <web-remaster-root> 的 Light DOM 中带 slot 属性的容器，Shadow DOM 内对应的
 * <slot name> 原位渲染。物理搬移（而非克隆）不会触发任何 HTTP 请求，
 * 验证码 Session 100% 存活。切回 original 模式或组件卸载时，
 * 节点精确归还到原位置留下的 Comment 锚点处。
 */
import { useEffect, type ReactElement } from "react";
import { queryAcrossFrames } from "./iframeBridge.js";
import { getSharedOriginManager } from "./originManager.js";

/** 活体传送门控制器：project 投影 / restore 归还 / isProjected 状态查询。 */
export interface PortalSlotController {
  project(): Element | null;
  restore(): void;
  isProjected(): boolean;
}

export interface NativePortalSlotProps {
  originRoot: HTMLElement;
  selectors: string[];
  slotName: string;
  className?: string;
}

interface ProjectionState {
  element: Element;
  anchor: Comment;
  container: HTMLDivElement;
}

/** 创建传送门控制器；host 省略时默认挂到 document 中的 <web-remaster-root>。 */
export function createPortalSlotController(
  originRoot: HTMLElement,
  selectors: string[],
  slotName: string,
  host?: HTMLElement
): PortalSlotController {
  let state: ProjectionState | null = null;

  const resolveHost = (): HTMLElement | null => {
    if (host) {
      return host;
    }
    const found = document.querySelector("web-remaster-root");
    return found instanceof HTMLElement ? found : null;
  };

  return {
    project(): Element | null {
      if (state) {
        return state.element; // 已投影：幂等返回原节点
      }
      const element = queryAcrossFrames(originRoot, selectors);
      if (!element) {
        return null;
      }
      const parent = element.parentNode;
      if (!parent) {
        return null; // 脱离文档的节点无原位可锚定
      }
      // 先在活体节点原位置留下 Comment 锚点，restore() 时可精确归还
      const anchor = document.createComment("wr-portal-anchor:" + slotName);
      parent.insertBefore(anchor, element);
      const hostElement = resolveHost();
      if (!hostElement) {
        anchor.remove(); // 无宿主可挂载：撤销锚点，原站保持原样
        return null;
      }
      const container = document.createElement("div");
      container.setAttribute("data-wr-portal-slot", slotName);
      container.setAttribute("slot", slotName);
      hostElement.appendChild(container); // 容器进宿主 Light DOM
      container.appendChild(element); // 物理搬移活体节点（移动，不是复制）
      state = { element, anchor, container };
      return element;
    },

    restore(): void {
      if (!state) {
        return; // 未投影：安全 no-op
      }
      const { element, anchor, container } = state;
      state = null;
      try {
        if (anchor.parentNode) {
          anchor.parentNode.insertBefore(element, anchor);
        } else {
          // 锚点被外部移除时兜底：至少把活体节点留在原站根内，绝不丢弃
          originRoot.appendChild(element);
        }
      } catch {
        originRoot.appendChild(element);
      }
      anchor.remove();
      container.remove();
    },

    isProjected(): boolean {
      return state !== null;
    },
  };
}

/** 活体传送门组件：Shadow DOM 内渲染 <slot>，并把活体节点投影到宿主 Light DOM 容器。 */
export function NativePortalSlot(props: NativePortalSlotProps): ReactElement {
  const { originRoot, selectors, slotName, className } = props;

  useEffect(() => {
    const controller = createPortalSlotController(originRoot, selectors, slotName);
    controller.project();

    // 切回 original 时归还活体节点；切到其他模式且尚未投影时重新投影
    const handleViewModeChange = (mode: string): void => {
      if (mode === "original") {
        controller.restore();
      } else if (!controller.isProjected()) {
        controller.project();
      }
    };

    const manager = getSharedOriginManager();
    let unsubscribe: (() => void) | undefined;
    const subscription = manager.onViewModeChange(handleViewModeChange);
    if (typeof subscription === "function") {
      unsubscribe = subscription;
    }

    return () => {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
      controller.restore();
    };
  }, [originRoot, slotName, selectors.join("|")]);

  return <slot name={slotName} className={className} />;
}
