/**
 * FeedListCard —— 资讯流（news-feed 原型）单条卡片。
 *
 * 数据由 4 级提取器产出后以纯结构 FeedItem 传入；标题为真实 <a> 链接
 * （可被 bridge TurboNavigator 全局接管），悬停/斑马纹由 THEME_CSS 的
 * .wr-row 提供，颜色全部走主题变量。
 */
import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from "react";
import { ArrowUp, Clock, ExternalLink, MessageSquare } from "lucide-react";
import { THEME_MONO_FONT, useThemeVars } from "./theme.js";

export interface FeedItem {
  /** 唯一标识（React key 用）。 */
  id: string;
  title: string;
  /** 条目原始链接；缺省时标题不可点击。 */
  url?: string;
  /** 来源域名（如 example.com）。 */
  domain?: string;
  author?: string;
  /** 已格式化的时间文案，展示层不再二次处理。 */
  publishedAt?: string;
  score?: number;
  commentCount?: number;
  excerpt?: string;
  tags?: ReadonlyArray<string>;
}

export interface FeedListCardProps {
  item: FeedItem;
  /** 序号（从 0 计，展示 +1），缺省不渲染序号列。 */
  index?: number;
  selected?: boolean;
  onSelect?: (item: FeedItem) => void;
  /** 紧凑模式：隐藏摘要与标签，保留元信息行。 */
  compact?: boolean;
}

export function FeedListCard(props: FeedListCardProps): ReactElement {
  const { item, index, selected = false, compact = false } = props;
  const vars = useThemeVars();

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (props.onSelect !== undefined && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      props.onSelect(item);
    }
  };

  return (
    <div
      className="wr-row wr-interactive flex items-start gap-3 px-4 py-3"
      data-wr-item="true"
      data-wr-selected={selected ? "true" : undefined}
      role={props.onSelect !== undefined ? "button" : undefined}
      tabIndex={props.onSelect !== undefined ? 0 : undefined}
      onClick={() => {
        props.onSelect?.(item);
      }}
      onKeyDown={props.onSelect !== undefined ? handleKeyDown : undefined}
      style={{
        background: selected ? vars.accentSoft : undefined,
        cursor: props.onSelect !== undefined ? "pointer" : undefined,
      }}
    >
      {index !== undefined ? (
        <span
          className="w-6 shrink-0 pt-0.5 text-right text-[13px]"
          style={{ color: vars.textMuted, fontFamily: THEME_MONO_FONT }}
        >
          {index + 1}
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          {item.url !== undefined ? (
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer noopener"
              className="wr-link wr-interactive line-clamp-2 sm:line-clamp-1 text-[14px] font-medium leading-snug"
              style={{ color: selected ? vars.accent : vars.text }}
              onClick={(event) => {
                event.stopPropagation();
              }}
            >
              {item.title}
            </a>
          ) : (
            <span className="line-clamp-2 sm:line-clamp-1 text-[14px] font-medium leading-snug" style={{ color: vars.text }}>
              {item.title}
            </span>
          )}
          {item.domain !== undefined ? (
            // 域名标签始终显示：THEME_CSS 里的 .wr-chip 自带 display，Tailwind 的 hidden 会被它盖掉，
            // 与其写一条不生效的响应式规则，不如老实保留（窄屏靠标题两行 clamp 承载信息）
            <span className="wr-chip shrink-0">
              <ExternalLink size={11} aria-hidden />
              {item.domain}
            </span>
          ) : null}
        </div>
        {!compact && item.excerpt !== undefined && item.excerpt !== "" ? (
          <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed" style={{ color: vars.textSecondary }}>
            {item.excerpt}
          </p>
        ) : null}
        {!compact && item.tags !== undefined && item.tags.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {item.tags.map((tag) => (
              <span key={tag} className="wr-chip" style={{ color: vars.textSecondary }}>
                {tag}
              </span>
            ))}
          </div>
        ) : null}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]" style={{ color: vars.textMuted }}>
          {item.author !== undefined ? <span>{item.author}</span> : null}
          {item.publishedAt !== undefined ? (
            <span className="inline-flex items-center gap-1">
              <Clock size={11} aria-hidden />
              {item.publishedAt}
            </span>
          ) : null}
          {item.score !== undefined ? (
            <span className="inline-flex items-center gap-1" style={{ color: item.score >= 100 ? vars.accent : vars.textMuted }}>
              <ArrowUp size={11} aria-hidden />
              {item.score}
            </span>
          ) : null}
          {item.commentCount !== undefined ? (
            <span className="inline-flex items-center gap-1">
              <MessageSquare size={11} aria-hidden />
              {item.commentCount}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
