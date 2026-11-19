/**
 * NestedThreadTree —— 论坛讨论（forum-thread 原型）嵌套回复树。
 *
 * 递归渲染 ThreadComment，节点可折叠（thread-collapse PowerUp）：
 * 深度 >= defaultCollapsedDepth 的节点初始折叠，折叠时显示后代总数。
 * 正文只接受纯文本或 renderBody 自定义渲染，严禁 HTML 注入。
 */
import { useState, type ReactElement, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Clock, ExternalLink, MessageSquare } from "lucide-react";
import { useThemeVars } from "./theme.js";

export interface ThreadComment {
  /** 唯一标识（全树内必须唯一，React key 用）。 */
  id: string;
  author?: string;
  /** 纯文本正文，按 pre-wrap 展示。 */
  body?: string;
  /** 已格式化的时间文案。 */
  postedAt?: string;
  score?: number;
  permalink?: string;
  children?: ThreadComment[];
}

export interface NestedThreadTreeProps {
  comments: ReadonlyArray<ThreadComment>;
  /** 深度 >= 该值的节点初始折叠，缺省 3。 */
  defaultCollapsedDepth?: number;
  /** 自定义正文渲染（如内嵌链接列表）；缺省用 body 纯文本。 */
  renderBody?: (comment: ThreadComment) => ReactNode;
  onReply?: (comment: ThreadComment) => void;
}

/** 统计 comment 的全部后代数（含任意深度）。 */
export function countThreadDescendants(comment: ThreadComment): number {
  let count = 0;
  const stack: ThreadComment[] = [...(comment.children ?? [])];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) {
      break;
    }
    count += 1;
    for (const child of current.children ?? []) {
      stack.push(child);
    }
  }
  return count;
}

interface ThreadNodeProps {
  comment: ThreadComment;
  depth: number;
  collapsedAtDepth: number;
  renderBody?: (comment: ThreadComment) => ReactNode;
  onReply?: (comment: ThreadComment) => void;
}

function ThreadNode(props: ThreadNodeProps): ReactElement {
  const { comment, depth, collapsedAtDepth, renderBody, onReply } = props;
  const vars = useThemeVars();
  const children = comment.children ?? [];
  const [expanded, setExpanded] = useState(depth < collapsedAtDepth);
  const descendantCount = countThreadDescendants(comment);

  const bodyNode: ReactNode =
    renderBody !== undefined
      ? renderBody(comment)
      : comment.body !== undefined && comment.body !== "" ? (
          <div className="whitespace-pre-wrap text-[13px] leading-relaxed" style={{ color: vars.text }}>
            {comment.body}
          </div>
        ) : null;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
        {children.length > 0 ? (
          <button
            type="button"
            className="wr-interactive inline-flex items-center justify-center rounded p-0.5"
            aria-expanded={expanded}
            aria-label={expanded ? "折叠回复" : "展开回复"}
            onClick={() => {
              setExpanded((prev) => !prev);
            }}
            style={{ color: vars.textMuted }}
          >
            {expanded ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />}
          </button>
        ) : (
          <span className="inline-block w-[19px] shrink-0" />
        )}
        {comment.author !== undefined ? (
          <span className="font-medium" style={{ color: vars.accent }}>
            {comment.author}
          </span>
        ) : null}
        {comment.score !== undefined ? <span style={{ color: vars.textMuted }}>{comment.score} 分</span> : null}
        {comment.postedAt !== undefined ? (
          <span className="inline-flex items-center gap-1" style={{ color: vars.textMuted }}>
            <Clock size={11} aria-hidden />
            {comment.postedAt}
          </span>
        ) : null}
        {comment.permalink !== undefined ? (
          <a
            href={comment.permalink}
            target="_blank"
            rel="noreferrer noopener"
            className="wr-link wr-interactive inline-flex items-center gap-1"
            style={{ color: vars.textMuted }}
          >
            <ExternalLink size={11} aria-hidden />
            链接
          </a>
        ) : null}
        {onReply !== undefined ? (
          <button
            type="button"
            className="wr-interactive inline-flex items-center gap-1 rounded px-1"
            onClick={() => {
              onReply(comment);
            }}
            style={{ color: vars.textMuted }}
          >
            <MessageSquare size={11} aria-hidden />
            回复
          </button>
        ) : null}
      </div>

      {expanded ? (
        <>
          {bodyNode}
          {children.length > 0 ? (
            <div
              className="mt-2 flex flex-col gap-2"
              style={{
                marginLeft: 10,
                paddingLeft: 12,
                borderLeftWidth: 2,
                borderLeftStyle: "solid",
                borderColor: vars.accentSoft,
              }}
            >
              {children.map((child) => (
                <ThreadNode
                  key={child.id}
                  comment={child}
                  depth={depth + 1}
                  collapsedAtDepth={collapsedAtDepth}
                  renderBody={renderBody}
                  onReply={onReply}
                />
              ))}
            </div>
          ) : null}
        </>
      ) : children.length > 0 ? (
        <button
          type="button"
          className="wr-interactive mt-1 inline-flex items-center gap-1 text-[12px]"
          onClick={() => {
            setExpanded(true);
          }}
          style={{ color: vars.accent }}
        >
          <ChevronRight size={12} aria-hidden />
          展开 {descendantCount} 条折叠回复
        </button>
      ) : null}
    </div>
  );
}

export function NestedThreadTree(props: NestedThreadTreeProps): ReactElement {
  const vars = useThemeVars();
  const collapsedAtDepth = props.defaultCollapsedDepth ?? 3;
  return (
    <div className="flex flex-col gap-3" style={{ color: vars.text }}>
      {props.comments.length === 0 ? (
        <div className="px-4 py-8 text-center text-[13px]" style={{ color: vars.textMuted }}>
          暂无讨论
        </div>
      ) : (
        props.comments.map((comment) => (
          <ThreadNode
            key={comment.id}
            comment={comment}
            depth={0}
            collapsedAtDepth={collapsedAtDepth}
            renderBody={props.renderBody}
            onReply={props.onReply}
          />
        ))
      )}
    </div>
  );
}
