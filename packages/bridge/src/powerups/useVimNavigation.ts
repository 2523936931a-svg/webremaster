/**
 * useVimNavigation PowerUp —— 极客 Vim 键盘导航。
 *
 * j/k 上下移动选中项、Enter 激活当前项、/ 聚焦搜索框；
 * 焦点在输入控件（INPUT/TEXTAREA/SELECT/contentEditable）或组合键时自动让位。
 * options 存 ref 每渲染刷新，全局 keydown 只绑定一次，不随 props 变化重绑。
 */
import { useEffect, useRef, useState } from "react";

export interface VimNavigationOptions {
  itemCount: number;
  onActivate: (index: number) => void;
  onFocusSearch?: () => void;
  enabled?: boolean;
}

/**
 * 判断这次按键是否发生在「正在输入」的上下文里。
 *
 * Shadow DOM 会把 event.target 重定向成宿主元素（web-remaster-root），
 * 只看 target.tagName 会漏掉 shadow 里的 input —— 命令面板里按 Enter 会被
 * 误当成「激活当前列表项」，同时触发 TurboNav 导航并把页面滚动复位。
 * 因此优先读 composedPath()[0]（事件真实起点），再用可见的 role=dialog 兜底。
 */
export function isTypingContext(event: KeyboardEvent): boolean {
  const path = typeof event.composedPath === "function" ? event.composedPath() : [];
  const origin = path[0];
  const candidate = origin instanceof HTMLElement ? origin : event.target;
  if (candidate instanceof HTMLElement) {
    const tag = candidate.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || candidate.isContentEditable) {
      return true;
    }
  }
  const host = document.querySelector("web-remaster-root");
  const dialog = host?.shadowRoot?.querySelector('[role="dialog"]');
  if (dialog instanceof HTMLElement) {
    const style = getComputedStyle(dialog);
    if (style.display !== "none" && style.visibility !== "hidden") return true;
  }
  return false;
}

export function useVimNavigation(options: VimNavigationOptions): {
  selectedIndex: number;
  setSelectedIndex: (index: number) => void;
} {
  const [selectedIndex, setSelectedIndexState] = useState<number>(0);
  const optionsRef = useRef(options);
  const selectedIndexRef = useRef(0);

  // 每次渲染后刷新 ref：keydown 读取最新 options，而监听本身不重绑
  useEffect(() => {
    optionsRef.current = options;
  });

  useEffect(() => {
    selectedIndexRef.current = selectedIndex;
  });

  // itemCount 变小时把选中项收敛回 [0, itemCount - 1]
  useEffect(() => {
    const maxIndex = Math.max(options.itemCount - 1, 0);
    setSelectedIndexState((current) => Math.min(current, maxIndex));
  }, [options.itemCount]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      // 组合键（如 Ctrl+K 唤起命令面板）不当作 Vim 按键
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (isTypingContext(event)) {
        return;
      }
      const current = optionsRef.current;
      if (current.enabled === false) {
        return;
      }
      if (event.key === "j" || event.key === "ArrowDown") {
        if (current.itemCount > 0) {
          setSelectedIndexState((i) => Math.min(i + 1, current.itemCount - 1));
        }
      } else if (event.key === "k" || event.key === "ArrowUp") {
        if (current.itemCount > 0) {
          setSelectedIndexState((i) => Math.max(i - 1, 0));
        }
      } else if (event.key === "G" || event.key === "End") {
        // Vim G / End：快速跳转至末尾
        if (current.itemCount > 0) {
          setSelectedIndexState(current.itemCount - 1);
        }
      } else if (event.key === "g" || event.key === "Home") {
        // Vim g / Home：快速跳转至首项
        if (current.itemCount > 0) {
          setSelectedIndexState(0);
        }
      } else if (event.key === "Enter") {
        current.onActivate(selectedIndexRef.current);
      } else if (event.key === "/") {
        event.preventDefault();
        current.onFocusSearch?.();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  /** 设置选中项（同步刷新 ref，Enter 立即可读到最新值）。 */
  const setSelectedIndex = (index: number): void => {
    selectedIndexRef.current = index;
    setSelectedIndexState(index);
  };

  return { selectedIndex, setSelectedIndex };
}
