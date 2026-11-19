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
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) {
          return;
        }
      }
      const current = optionsRef.current;
      if (current.enabled === false) {
        return;
      }
      if (event.key === "j") {
        if (current.itemCount > 0) {
          setSelectedIndexState((i) => Math.min(i + 1, current.itemCount - 1));
        }
      } else if (event.key === "k") {
        if (current.itemCount > 0) {
          setSelectedIndexState((i) => Math.max(i - 1, 0));
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
