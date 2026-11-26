# Hacker News 皮肤

> 这是 WebRemaster 第一个上架皮肤，也是编写新皮肤的参照模板。

## 产物清单

| 文件 | 说明 |
| :--- | :--- |
| `01_snapshot.json` | Playwright DOM X-Ray 测绘结果：骨架、选择器、配对组、截图元信息 |
| `02_contract.json` | 数据合同：两条路由（信息流 / 讨论树）、字段提取级联、PowerUps |
| `03_design.json` | 视觉规格：色板、密度、组件映射 |
| `src/entry.tsx` | 皮肤源码：提取 → 渲染 → TurboNav → 导出 |
| `src/skin.css` | Tailwind v4 入口与少量定制变量 |
| `hackernews.user.js` | 单文件生产产物（自包含 React + Bridge + CSS） |
| `before.png` / `after.png` / `split.png` | 三态截图 |
| `05_verification.json` | 六重门禁报告（数据对齐、幕帘、渲染、桥接、传送门） |
| `manifest.json` | 上架清单，供扩展与皮肤大厅消费 |

## 两条路由

| 路由 | 判定 | 提取 | 渲染 |
| :--- | :--- | :--- | :--- |
| `feed` | URL 不含 `item?id=` | `tr.athing` 逐行，按 DOM 顺序保留原始排名 | `FeedListCard` 高密度列表 |
| `thread` | URL 含 `item?id=` | `tr.athing.comtr` + `div.ind[indent]` 缩进 | `NestedThreadTree` 折叠评论树 |

排序刻意不做任何 `sort`：Hacker News 的排名本身就是信息，重制版必须原样保留 DOM 顺序。

## 字段级联

每个字段都声明 2~3 级选择器，命中率由 `HealthTracker` 逐字段统计，写进 `05_verification.json` 的 `extractorHealthSummary`：

```ts
// 标题：新结构 titleline > a，旧结构直接 td > a
["td.title > span.titleline > a", "td.title > a"]

// 分数：优先 span.score，退化到 subline 内的 score
["td.subtext span.score", "td.subtext span.subline > span.score"]
```

新增站点时照抄这个结构：**第一级写当前 DOM，第二级写历史结构，第三级用 `relativeTo` + `regexExtract` 兜底**。原站改版时，健康度报表会先于用户发现。

## 本地验证

```bash
pnpm wr build-skin hackernews
pnpm wr verify-skin hackernews        # 需要能访问 news.ycombinator.com
```

无网络环境可以用 `configs/hn-recon/front.html` 作为 fixture：拦截 `https://news.ycombinator.com/*` 的主文档请求返回该文件，再注入 `hackernews.user.js`，即可离线复现信息流与 split 三态。

## 已知约束

- Hacker News 的 `vote` 链接依赖会话与 `goto` 参数，点赞走 `nativeTriggerClick` 交给原站处理，不在重制层重建请求。
- 折叠评论树的层级来自 `div.ind[ indent ]`（每级 40px），若 HN 改成 CSS 缩进需要同步调整。
- 分页 `More` 链接由 TurboNav 接管；若目标页返回非 200，TurboNav 会回退整页跳转。

## 复用清单

1. 复制本目录并改 `siteId`；
2. 重跑 `wr inspect` 覆盖 `01_snapshot.json`；
3. 改 `02_contract.json` 的 `urlRegex` / `itemFields` / `archetype`；
4. 改 `src/entry.tsx` 的提取规则与渲染组件（`ui-kit` 里已有 news-feed / data-table / doc-reader 三套）；
5. `build-skin` → `verify-skin` → `finalize-skin` → `sync:artifacts`。
