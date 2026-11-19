/**
 * CommandPalette PowerUp —— Cmd+K / Ctrl+K 呼出的毛玻璃命令面板。
 *
 * 运行在 Shadow DOM 内，全部样式内联（不依赖外部 CSS）；
 * fuzzyMatch 为纯函数，可独立单测；scrollIntoView 等能力做了 JSDOM 兼容降级。
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";

export interface PaletteCommand {
  id: string;
  label: string;
  hint?: string;
  keywords?: string;
  run: () => void;
}

/** 判断 target[index] 是否词首：字符串起点、前面是空格/横线/斜杠、或驼峰边界。 */
function isWordStart(target: string, index: number): boolean {
  if (index === 0) {
    return true;
  }
  const prev = target[index - 1];
  if (prev === " " || prev === "-" || prev === "/") {
    return true;
  }
  const current = target[index];
  // 驼峰边界：前一个小写字母 + 当前大写字母（如 CommandPalette 的 P）
  const prevIsLowerLetter = prev === prev.toLowerCase() && prev !== prev.toUpperCase();
  const currentIsUpperLetter = current !== current.toLowerCase() && current === current.toUpperCase();
  return prevIsLowerLetter && currentIsUpperLetter;
}

/**
 * 大小写不敏感子序列匹配打分：
 * 连续命中 +8、词首命中 +5、每跳过一个未匹配字符 -1；
 * 不能构成子序列时 { matched: false, score: -Infinity }；空 query 恒匹配且 0 分。
 */
export function fuzzyMatch(query: string, target: string): { matched: boolean; score: number } {
  if (query.length === 0) {
    return { matched: true, score: 0 };
  }
  let score = 0;
  let searchFrom = 0;
  let prevMatchIndex = -1;
  let hasPrevMatch = false;
  for (const rawChar of query) {
    const char = rawChar.toLowerCase();
    let foundIndex = -1;
    for (let i = searchFrom; i < target.length; i++) {
      if (target[i].toLowerCase() === char) {
        foundIndex = i;
        break;
      }
    }
    if (foundIndex === -1) {
      return { matched: false, score: -Infinity };
    }
    score -= foundIndex - searchFrom; // 跳过的未匹配字符每个 -1
    if (isWordStart(target, foundIndex)) {
      score += 5;
    }
    if (hasPrevMatch && foundIndex === prevMatchIndex + 1) {
      score += 8; // 连续命中
    }
    hasPrevMatch = true;
    prevMatchIndex = foundIndex;
    searchFrom = foundIndex + 1;
  }
  return { matched: true, score };
}

/** Cmd+K / Ctrl+K 唤起命令面板；onOpen 存 ref，避免回调变化导致全局监听反复重绑。 */
export function useCommandPaletteHotkey(onOpen: () => void): void {
  const onOpenRef = useRef(onOpen);

  useEffect(() => {
    onOpenRef.current = onOpen;
  });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpenRef.current();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);
}

/** 毛玻璃命令面板：open 为 false 时返回 null。 */
export function CommandPalette(props: {
  open: boolean;
  commands: PaletteCommand[];
  onClose: () => void;
  placeholder?: string;
}): ReactElement | null {
  const { open, commands, onClose, placeholder } = props;
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const activeItemRef = useRef<HTMLLIElement | null>(null);

  // open 变为 true：重置搜索词与高亮项，并自动聚焦输入框
  useEffect(() => {
    if (!open) {
      return;
    }
    setQuery("");
    setActiveIndex(0);
    inputRef.current?.focus();
  }, [open]);

  const filtered = useMemo(() => {
    const scored: Array<{ command: PaletteCommand; score: number }> = [];
    for (const command of commands) {
      const target = command.label + " " + (command.keywords ?? "");
      const result = fuzzyMatch(query, target);
      if (result.matched) {
        scored.push({ command, score: result.score });
      }
    }
    scored.sort((a, b) => b.score - a.score); // 稳定排序：同分保持原顺序
    return scored.map((entry) => entry.command);
  }, [commands, query]);

  // 过滤后列表变短时收敛高亮项，保证「当前项」始终有效
  useEffect(() => {
    if (activeIndex > filtered.length - 1) {
      setActiveIndex(Math.max(filtered.length - 1, 0));
    }
  }, [filtered.length, activeIndex]);

  // 高亮项变化时滚动进可见区域（JSDOM 等环境无 scrollIntoView，安全吞掉）
  useEffect(() => {
    try {
      activeItemRef.current?.scrollIntoView({ block: "nearest" });
    } catch {
      /* 环境不支持时忽略 */
    }
  }, [activeIndex]);

  if (!open) {
    return null;
  }

  const count = filtered.length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.35)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        zIndex: 2147483646,
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        style={{
          margin: "18vh auto 0",
          width: "min(560px, 90vw)",
          borderRadius: 14,
          background: "rgba(22,24,28,.92)",
          border: "1px solid rgba(255,255,255,.08)",
          boxShadow: "0 24px 64px rgba(0,0,0,.5)",
          overflow: "hidden",
        }}
      >
        <input
          ref={inputRef}
          value={query}
          placeholder={placeholder}
          aria-label={placeholder ?? "搜索命令"}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              if (count > 0) {
                setActiveIndex((i) => (i + 1) % count); // 越界循环
              }
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              if (count > 0) {
                setActiveIndex((i) => (i - 1 + count) % count); // 越界循环
              }
            } else if (event.key === "Enter") {
              const command = filtered[activeIndex];
              if (command) {
                event.preventDefault();
                command.run();
                onClose();
              }
            } else if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            }
          }}
          style={{
            display: "block",
            width: "100%",
            boxSizing: "border-box",
            background: "transparent",
            border: "none",
            outline: "none",
            color: "#fff",
            fontSize: 16,
            fontFamily: "inherit",
            padding: "14px 16px",
          }}
        />
        {count > 0 ? (
          <ul
            role="listbox"
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              maxHeight: 340,
              overflowY: "auto",
              borderTop: "1px solid rgba(255,255,255,.06)",
            }}
          >
            {filtered.map((command, index) => {
              const active = index === activeIndex;
              return (
                <li
                  key={command.id}
                  ref={active ? activeItemRef : undefined}
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    command.run();
                    onClose();
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: "10px 16px",
                    cursor: "pointer",
                    color: "#e8eaed",
                    fontSize: 14,
                    background: active ? "rgba(110,168,254,.22)" : "transparent",
                    boxShadow: active ? "inset 2px 0 0 #6ea8fe" : "none", // 左侧 2px 强调条
                  }}
                >
                  <span>{command.label}</span>
                  {command.hint ? (
                    <kbd
                      style={{
                        fontSize: 11,
                        lineHeight: "16px",
                        padding: "2px 6px",
                        borderRadius: 6,
                        color: "#9aa0a6",
                        background: "rgba(255,255,255,.08)",
                        border: "1px solid rgba(255,255,255,.12)",
                        fontFamily: "inherit",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {command.hint}
                    </kbd>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <div
            style={{
              padding: "28px 0",
              textAlign: "center",
              color: "#9aa0a6",
              fontSize: 14,
            }}
          >
            无匹配命令
          </div>
        )}
      </div>
    </div>
  );
}
