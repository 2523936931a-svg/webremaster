/**
 * ReaderProseLayout —— 文档阅读（doc-reader 原型）版式。
 *
 * 顶部阅读进度条（按文章相对视口的滚动进度，capture 阶段监听任意滚动容器）、
 * 可选目录（TOC，滚动时联动高亮，点击平滑滚动到对应标题——标题需由调用方
 * 在 children 中设置与 toc.id 一致的 id 属性）、依据正文文本自动估算阅读时长。
 * 正文排版由 THEME_CSS 的 .wr-prose 提供（零 HTML 注入，children 为 React 节点）。
 */
import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { Clock } from "lucide-react";
import { useThemeVars } from "./theme.js";

export interface ReaderTocItem {
  /** 对应正文中标题元素的 id（调用方负责在 children 上设置）。 */
  id: string;
  title: string;
  level?: 1 | 2 | 3;
}

export interface ReaderProseLayoutProps {
  title: string;
  /** 署名 / 来源 / 日期等元信息文案。 */
  meta?: string;
  toc?: ReadonlyArray<ReaderTocItem>;
  children: ReactNode;
  onTocSelect?: (item: ReaderTocItem) => void;
  /** 显式阅读时长（分钟）；缺省按正文文本自动估算。 */
  readingMinutes?: number;
}

const TOC_CLASS: Record<1 | 2 | 3, { active: string; inactive: string }> = {
  1: { active: "block w-full py-1 text-left text-[12px] font-medium", inactive: "block w-full py-1 text-left text-[12px]" },
  2: { active: "block w-full py-1 pl-4 text-left text-[12px] font-medium", inactive: "block w-full py-1 pl-4 text-left text-[12px]" },
  3: { active: "block w-full py-1 pl-8 text-left text-[12px] font-medium", inactive: "block w-full py-1 pl-8 text-left text-[12px]" },
};

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** CJK 每 400 字 / 拉丁每 220 词 ≈ 1 分钟。 */
function estimateReadingMinutes(text: string): number {
  const cjkMatches = text.match(/[\u3400-\u9fff]/g);
  const cjkCount = cjkMatches === null ? 0 : cjkMatches.length;
  const latinWords = text
    .replace(/[\u3400-\u9fff]/g, " ")
    .split(/\s+/)
    .filter((word) => /[A-Za-z0-9]/.test(word)).length;
  return Math.max(1, Math.ceil(cjkCount / 400 + latinWords / 220));
}

/** 属性选择器安全转义后按 id 查找标题元素；选择器异常时返回 null。 */
function queryHeading(article: HTMLElement, id: string): Element | null {
  const escaped = id.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  try {
    return article.querySelector(`[id="${escaped}"]`);
  } catch {
    return null;
  }
}

export function ReaderProseLayout(props: ReaderProseLayoutProps): ReactElement {
  const { title, meta, toc, children, onTocSelect, readingMinutes } = props;
  const vars = useThemeVars();
  const articleRef = useRef<HTMLElement | null>(null);
  const [progress, setProgress] = useState(0);
  const [activeTocId, setActiveTocId] = useState<string | null>(null);
  const [estimatedMinutes, setEstimatedMinutes] = useState<number | null>(null);

  const updateReadingProgress = useCallback(() => {
    const article = articleRef.current;
    if (article === null) {
      return;
    }
    // 与滚动容器无关的进度：文章顶端越过视口顶为 0，底端贴住视口底为 1
    const rect = article.getBoundingClientRect();
    const viewportHeight = typeof window === "undefined" ? 800 : window.innerHeight;
    const travel = rect.height - viewportHeight;
    setProgress(travel > 0 ? clamp01(-rect.top / travel) : 1);
    if (toc !== undefined && toc.length > 0) {
      let current: string | null = toc[0]?.id ?? null;
      for (const item of toc) {
        const heading = queryHeading(article, item.id);
        if (heading !== null && heading.getBoundingClientRect().top <= 120) {
          current = item.id;
        }
      }
      setActiveTocId(current);
    }
  }, [toc]);

  // capture:true 使内部任意滚动容器的 scroll 事件也会到达 window
  useEffect(() => {
    updateReadingProgress();
    if (typeof window === "undefined") {
      return;
    }
    const onScroll = (): void => {
      updateReadingProgress();
    };
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onScroll);
    };
  }, [updateReadingProgress]);

  useEffect(() => {
    const article = articleRef.current;
    if (article === null) {
      return;
    }
    setEstimatedMinutes(estimateReadingMinutes(article.textContent ?? ""));
  }, [children]);

  const handleTocClick = (item: ReaderTocItem): void => {
    onTocSelect?.(item);
    const article = articleRef.current;
    if (article === null) {
      return;
    }
    const heading = queryHeading(article, item.id);
    if (heading === null) {
      return;
    }
    try {
      heading.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch {
      /* 环境不支持 scrollIntoView 时忽略 */
    }
  };

  const minutes = readingMinutes ?? estimatedMinutes;
  const showMetaRow = meta !== undefined || minutes !== null;

  return (
    <div className="relative flex min-h-screen flex-col" style={{ background: vars.bg, color: vars.text }}>
      <div className="sticky top-0 z-10 h-1 w-full shrink-0" style={{ background: vars.surfaceAlt }} aria-hidden={true}>
        <div
          className="h-full w-full"
          style={{ background: vars.accent, transform: `scaleX(${progress})`, transformOrigin: "0 50%", transition: "transform .08s linear" }}
        />
      </div>
      <div className="mx-auto flex w-full max-w-6xl flex-1 items-start gap-8 px-6 py-8">
        <article ref={articleRef} className="wr-prose min-w-0 flex-1">
          <h1>{title}</h1>
          {showMetaRow ? (
            <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]" style={{ color: vars.textMuted }}>
              {meta !== undefined ? <span>{meta}</span> : null}
              {minutes !== null ? (
                <span className="inline-flex items-center gap-1">
                  <Clock size={11} aria-hidden />
                  约 {minutes} 分钟读完
                </span>
              ) : null}
            </div>
          ) : null}
          {children}
        </article>
        {toc !== undefined && toc.length > 0 ? (
          <aside className="sticky top-8 hidden w-56 shrink-0 lg:block">
            <div className="text-[11px] font-medium uppercase tracking-wide" style={{ color: vars.textMuted }}>
              目录
            </div>
            <nav className="mt-2 flex flex-col">
              {toc.map((item) => {
                const level = item.level ?? 1;
                const active = item.id === activeTocId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={TOC_CLASS[level][active ? "active" : "inactive"]}
                    onClick={() => {
                      handleTocClick(item);
                    }}
                    style={{ color: active ? vars.accent : vars.textSecondary }}
                  >
                    {item.title}
                  </button>
                );
              })}
            </nav>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
