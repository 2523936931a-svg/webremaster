/**
 * HackerNews 双路由重制皮肤 —— Agent-Native 手工精作。
 * 列表路由：FeedListCard 高密度信息流；详情路由：NestedThreadTree 彩虹折叠评论树；
 * TurboNav 0ms SPA 切换；HealthTracker 遥测上报诊断抽屉；CSV/Markdown 导出；Vim 导航。
 */
import "./skin.css";
import { useSyncExternalStore, useMemo, useState, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import {
  HealthTracker,
  TurboNavigator,
  createOriginStore,
  exportToCSV,
  exportToMarkdownTable,
  extractFieldWithCascade,
  nativeTriggerClick,
  useVimNavigation,
  type FieldRule,
  type OriginManager,
  type OriginStore,
  type PaletteCommand,
} from "@webremaster/bridge";
import {
  FeedListCard,
  NestedThreadTree,
  RemasterShell,
  collectDiagnostics,
  type FeedItem,
  type ThreadComment,
} from "@webremaster/ui-kit";

/** wrapper 传入挂载上下文的皮肤子集视图（其余字段忽略）。 */
export interface SkinMountContext {
  shadowRoot: ShadowRoot;
  originManager: OriginManager;
  originWrapper: HTMLElement;
  diagnostics: {
    healthSummary?: () => unknown;
    features?: { commandPalette?: boolean; diagnosticsDrawer?: boolean };
  };
}

interface SkinSnapshot {
  route: "feed" | "thread";
  stories: FeedItem[];
  comments: ThreadComment[];
}

const fieldRule = (
  fieldName: string,
  selectors: string[],
  attribute: FieldRule["attribute"],
  overrides?: Partial<Omit<FieldRule, "fieldName" | "selectors" | "attribute">>,
): FieldRule => ({
  fieldName,
  fieldType: "string",
  selectors,
  attribute,
  required: false,
  ...overrides,
});

const TITLE_RULE = fieldRule("title", ["td.title > span.titleline > a", "td.title > a"], "textContent", { required: true });
const URL_RULE = fieldRule("url", ["td.title > span.titleline > a", "td.title > a"], "href");
const POINTS_RULE = fieldRule(
  "points",
  ["td.subtext span.score", "td.subtext span.subline > span.score"],
  "textContent",
  { relativeTo: "next-sibling", regexExtract: "(\\d+)", required: true },
);
const AUTHOR_RULE = fieldRule("author", ["td.subtext a[href^='user?id=']", "td.subtext a.hnuser"], "textContent", { relativeTo: "next-sibling" });
const AGE_RULE = fieldRule("age", ["td.subtext span.age"], "textContent", { relativeTo: "next-sibling" });
const COMMENTS_RULE = fieldRule(
  "comments",
  ["td.subtext span.subline a:last-child"],
  "textContent",
  { relativeTo: "next-sibling", regexExtract: "(\\d+)" },
);

const domainOf = (rawUrl: string | undefined): string | undefined => {
  if (rawUrl === undefined || rawUrl.length === 0) return undefined;
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
};

/** URL 命中 `/item?id=` 走详情路由；URL 结构变化（或离线快照）时用 DOM 指纹兜底。 */
const isThreadRoute = (): boolean =>
  /\/item\?id=/.test(window.location.href) || Boolean(document.querySelector("tr.athing.comtr"));

function extractStories(originRoot: HTMLElement, tracker: HealthTracker): FeedItem[] {
  const rows = Array.from(originRoot.querySelectorAll("tr.athing")).filter((row) => !row.classList.contains("comtr"));
  const stories: FeedItem[] = [];
  rows.forEach((row, index) => {
    const title = extractFieldWithCascade(row, TITLE_RULE, tracker);
    if (title === null || title.length === 0) return;
    const url = extractFieldWithCascade(row, URL_RULE, tracker) ?? undefined;
    const points = extractFieldWithCascade(row, POINTS_RULE, tracker);
    const author = extractFieldWithCascade(row, AUTHOR_RULE, tracker);
    const age = extractFieldWithCascade(row, AGE_RULE, tracker);
    const comments = extractFieldWithCascade(row, COMMENTS_RULE, tracker);
    const domain = domainOf(url);
    stories.push({
      id: row.getAttribute("id") ?? `story-${index}`,
      title,
      ...(url !== undefined && url.length > 0 ? { url } : {}),
      ...(domain !== undefined ? { domain } : {}),
      ...(author !== null && author.length > 0 ? { author } : {}),
      ...(age !== null && age.length > 0 ? { publishedAt: age } : {}),
      ...(points !== null && points.length > 0 ? { score: Number(points) } : {}),
      ...(comments !== null && comments.length > 0 ? { commentCount: Number(comments) } : {}),
    });
  });
  return stories;
}

function extractComments(originRoot: HTMLElement, tracker: HealthTracker): ThreadComment[] {
  const rows = Array.from(originRoot.querySelectorAll("tr.athing.comtr"));
  const authorRule = fieldRule("comment-author", ["a.hnuser", "a[href^='user?id=']"], "textContent");
  const bodyRule = fieldRule("comment-body", ["div.commtext", "span.commtext", ".commtext"], "textContent");
  const ageRule = fieldRule("comment-age", ["span.age"], "textContent");
  const flat: Array<ThreadComment & { depth: number }> = rows.map((row, index) => {
    const author = extractFieldWithCascade(row, authorRule, tracker);
    const body = extractFieldWithCascade(row, bodyRule, tracker);
    const age = extractFieldWithCascade(row, ageRule, tracker);
    const indentAttr = row.querySelector("div.ind")?.getAttribute("indent");
    const spacerWidth = row.querySelector("img[src='s.gif']")?.getAttribute("width");
    const rawDepth =
      indentAttr !== null && indentAttr !== undefined && indentAttr.length > 0
        ? Number(indentAttr) / 40
        : spacerWidth !== null && spacerWidth !== undefined
          ? Number(spacerWidth) / 40
          : 0;
    const depth = Number.isFinite(rawDepth) ? Math.max(0, Math.floor(rawDepth)) : 0;
    return {
      id: row.getAttribute("id") ?? `comment-${index}`,
      ...(author !== null && author.length > 0 ? { author } : {}),
      ...(body !== null && body.length > 0 ? { body } : {}),
      ...(age !== null && age.length > 0 ? { postedAt: age } : {}),
      children: [],
      depth,
    };
  });
  // 缩进层级 → 归并成树（栈式配对；缩进回退即回弹到父级）
  const roots: ThreadComment[] = [];
  const stack: Array<ThreadComment & { depth: number }> = [];
  for (const node of flat) {
    while (stack.length > 0 && stack[stack.length - 1].depth >= node.depth) stack.pop();
    if (stack.length === 0) roots.push(node);
    else stack[stack.length - 1]?.children?.push(node);
    stack.push(node);
  }
  return roots;
}

function extractSnapshot(originRoot: HTMLElement, tracker: HealthTracker): SkinSnapshot {
  if (isThreadRoute()) {
    return { route: "thread", stories: [], comments: extractComments(originRoot, tracker) };
  }
  return { route: "feed", stories: extractStories(originRoot, tracker), comments: [] };
}

interface SkinAppProps {
  context: SkinMountContext;
  store: OriginStore<SkinSnapshot>;
  tracker: HealthTracker;
  turbo: TurboNavigator;
}

function SkinApp(props: SkinAppProps): ReactElement {
  const { context, store, tracker, turbo } = props;
  const snapshot = useSyncExternalStore(store.subscribe, () => store.getSnapshot());
  const route = snapshot?.route ?? "feed";
  const stories = useMemo(() => snapshot?.stories ?? [], [snapshot]);
  const comments = snapshot?.comments ?? [];
  const vim = useVimNavigation({
    itemCount: stories.length,
    onActivate: (index) => {
      const story = stories[Math.min(index, Math.max(0, stories.length - 1))];
      if (story?.url !== undefined) void turbo.navigate(story.url);
    },
    onFocusSearch: () => {
      // "/" 聚焦搜索：经 Ctrl+K 合成事件唤起 RemasterShell 内置命令面板
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true, cancelable: true }),
      );
    },
  });
  const selectedIndex = Math.min(vim.selectedIndex, Math.max(0, stories.length - 1));
  const diagnostics = useMemo(
    () => collectDiagnostics(tracker, { siteId: "hackernews", routeId: route }),
    [tracker, route, snapshot],
  );
  const commands = useMemo<PaletteCommand[]>(() => {
    const rows: unknown[][] = [
      ["rank", "title", "url", "points", "author", "when", "comments"],
      ...stories.map((story, index) => [
        index + 1,
        story.title,
        story.url ?? "",
        story.score ?? "",
        story.author ?? "",
        story.publishedAt ?? "",
        story.commentCount ?? 0,
      ]),
    ];
    const selectedStory = stories[selectedIndex];
    const upvoteArrow =
      selectedStory !== undefined
        ? context.originWrapper.querySelector(`tr.athing[id="${CSS.escape(selectedStory.id)}"] a[href^="vote"]`)
        : null;
    return [
      {
        id: "export-csv",
        label: "导出当前列表为 CSV（UTF-8 BOM，Excel 无乱码）",
        run: () => {
          // 标题可由用户提交，开启公式注入防护，避免 Excel 打开时执行 =/+/-/@ 开头的单元格
          exportToCSV(rows, "hackernews.csv", true);
        },
      },
      {
        id: "export-md",
        label: "导出当前列表为 Markdown 表格",
        run: () => {
          exportToMarkdownTable(rows, "hackernews.md");
        },
      },
      // 条目检索：Cmd+K 里输入标题/作者即可定位到对应卡片（这才是 tagline 里 cmd-k-search 的实际能力）
      ...(route === "feed"
        ? stories.map((story, index) => ({
            id: `jump-${story.id}`,
            label: `第 ${index + 1} 条 · ${story.title}`,
            keywords: `跳转 定位 goto jump ${story.author ?? ""}`,
            run: () => {
              const host = document.querySelector("web-remaster-root");
              const items = host instanceof HTMLElement ? host.shadowRoot?.querySelectorAll('[data-wr-item="true"]') : undefined;
              const item = items?.[index];
              if (!(item instanceof HTMLElement)) return;
              // Shadow DOM 内的 scrollIntoView 在 overlay 关闭前调用不会滚动外层文档，
              // 推迟到面板卸载后用显式 window.scrollTo 定位，并给目标卡片一次高亮。
              window.setTimeout(() => {
                const rect = item.getBoundingClientRect();
                window.scrollTo({ top: Math.max(0, window.scrollY + rect.top - 260) });
                item.animate?.(
                  [{ boxShadow: "0 0 0 2px rgba(249,115,22,.9)" }, { boxShadow: "0 0 0 0 rgba(249,115,22,0)" }],
                  { duration: 900, easing: "ease-out" },
                );
              }, 0);
            },
          }))
        : []),
      ...(upvoteArrow !== null
        ? [
            {
              id: "upvote",
              label: "点赞当前选中条目（原生 Bridge 点击，保住 HN 会话）",
              run: () => {
                nativeTriggerClick(upvoteArrow);
              },
            },
          ]
        : []),
      {
        id: "goto-original",
        label: "切回原版界面（Alt+Shift+R 循环三态）",
        run: () => {
          context.originManager.setViewMode("original");
        },
      },
    ];
  }, [stories, selectedIndex, context.originWrapper, context.originManager, context.shadowRoot, route]);

  return (
    <RemasterShell
      title="Hacker News"
      subtitle={route === "feed" ? `WebRemaster 重制信息流 · ${stories.length} 条` : "讨论树 · WebRemaster 重制版"}
      manager={context.originManager}
      diagnostics={diagnostics}
      commands={commands}
    >
      {route === "feed" ? (
        <div className="flex flex-col gap-2 px-1 pb-10">
          {stories.map((item, index) => (
            <FeedListCard
              key={item.id}
              item={item}
              index={index}
              compact
              selected={index === selectedIndex}
              onSelect={() => {
                if (item.url !== undefined) void turbo.navigate(item.url);
              }}
            />
          ))}
        </div>
      ) : (
        <div className="px-1 pb-10">
          {comments.length > 0 ? (
            <NestedThreadTree comments={comments} />
          ) : (
            <div className="p-6 text-sm opacity-70">本页暂无可折叠的评论树节点。</div>
          )}
        </div>
      )}
    </RemasterShell>
  );
}

export default function mountSkin(context: SkinMountContext): void {
  const tracker = new HealthTracker();
  context.diagnostics.features = { commandPalette: true, diagnosticsDrawer: true };
  context.diagnostics.healthSummary = () => tracker.getAllHealth();
  const store = createOriginStore<SkinSnapshot>({
    originRoot: context.originWrapper,
    extract: () => extractSnapshot(context.originWrapper, tracker),
    validate: (snapshot) => (snapshot.route === "feed" ? snapshot.stories.length > 0 : true),
    debounceMs: 150,
  });
  const turbo = new TurboNavigator(
    context.originWrapper,
    () => {
      store.refresh(); // TurboNav 换页后按新路由重提取
    },
    {},
  );
  const container = document.createElement("div");
  container.className = "wr-hn-root";
  context.shadowRoot.appendChild(container);
  createRoot(container).render(<SkinApp context={context} store={store} tracker={tracker} turbo={turbo} />);
}
