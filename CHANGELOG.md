# Changelog

本文件记录 WebRemaster 的对外变更，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Planned

- 扩充皮肤矩阵：Lobsters、arXiv、V2EX、阮一峰博客
- `compiler` 去除 `better-sqlite3` 原生依赖，降低 Windows 贡献者门槛
- ESLint + Prettier 统一代码风格

## [0.1.0] - 2026-11-26

### Added

- **6 个 workspace 包**：`schema`、`bridge`、`ui-kit`、`compiler`、`extension`、`store`
- **零闪烁运行时**：`Zero-Flash Curtain`、`Shadow DOM` 物理隔离、`OriginManager` 隐身原站
- **抗改版提取**：4 级级联选择器 + 字段健康度遥测（`HealthTracker`）
- **TurboNav**：MPA 无刷新导航、悬停预取、View Transitions
- **PowerUps**：ReaderMode、BookmarkManager、ContentCleaner、ElementZapper、CommandPalette、Vim 导航、CSV / Markdown 导出
- **编译器流水线**：`wr inspect / scaffold / dev / build-skin / verify-skin / finalize-skin / sync-artifacts`
- **6 重门禁校验**：运行时错误、幕帘揭起、数据对齐、渲染破损、桥接与控制台、传送门与 TurboNav
- **首个上架皮肤**：Hacker News（含 before/after/split 截图、门禁报告与 `manifest.json`）
- **Chrome MV3 扩展**与 GitHub Pages 皮肤大厅
- **社交分享卡片**：`packages/store/public/og.png`（1200×630，取自真实 split 截图）+ Open Graph / Twitter Card meta
- **`vlmScoreSource` 字段**：`SkinManifest` 区分 `auto-vlm` 与 `human-review`，避免"9.2 分"与验证报告里"0 分"看起来互相矛盾；`sync-artifacts` 输出改为"平均评分（自动 / 人工）"
- **English README**（`README.en.md`）与首屏语言切换
- **皮肤模板文档**（`skins/hackernews/README.md`）：字段级联写法、两条路由、复用清单、已知约束
- 仓库治理：`LICENSE`、`SECURITY.md`、`CODE_OF_CONDUCT.md`、`CHANGELOG.md`、`.editorconfig`、`.nvmrc`、`dependabot.yml`、`release.yml`
- 5 个 workspace 包补齐 `license` 与 `repository.directory` 元数据
- 首屏动图 `docs/demo.gif`（before → after → split 三态）
- 测试：154 项（6 个包）
- 文档：README、CONTRIBUTING、PROJECT_SHOWCASE、安全策略、行为准则
- **离线回放验证** `wr verify-skin --fixture <html>`：主文档由本地快照响应，同源静态资源缺失时返回 200 空响应（不触发 `net::ERR_FAILED` 污染 Gate 1），站点不可达/CI 无外网时仍可跑六门禁；报告标注「离线 fixture 回放」且不覆盖真机截图
- **在线试用 Playground（免安装）**：`packages/store` 新增 `#live-demo`：iframe 加载 `configs/hn-recon` 的离线快照（列表页 + 详情页各一份），把打包好的 userscript 文本注入进去真实跑一遍；工具栏可切「重制版 / 左右分屏 / 1998 原版」，分屏下分割线仍可拖动。配图 `docs/playground.png`，README 新增对应章节。
- **Cmd+K 条目检索**：命令面板现在合并每条列表项（标题 + 作者），输入关键词即可过滤定位，回车滚动到目标卡片并高亮——补齐 tagline 中 `cmd-k-search` 的实际能力
- **主题预设可从 UI 切换**：`THEME_PALETTES` 里的 Catppuccin Mocha / Tokyo Night / Nord / Sepia Book 此前只有 CSS 规则、没有任何入口；命令面板新增「切换配色预设」，循环切换并写入 `localStorage`；深浅切换会回到标准色板，避免被 palette 变量覆盖而看起来没反应
- **`pnpm set-owner <用户名>`**：仓库里 30+ 处指向占位组织 `webremaster`（badge、在线试用、Release、Pages、`repository` 字段、og:image 绝对地址）本来只能手工搜索替换。新增脚本扫描 `.md / .json / .html / .yml / .ts`，把 `owner/repo` 与 `owner.github.io/repo` 一次性替换，幂等、可带仓库名参数；README 中英双语补「部署到你自己的 GitHub」三步。
- **README 补「Agent-Native」章节**：`skills/webremaster/SKILL.md` 一直躺在仓库里却没有任何入口，访客只能偶然翻到。新章节说明它是六步可执行规程、只列 `bridge` 里真实存在的导出、命令与 `wr --help` 一致；`SKILL.md` 自身补上「先 `wr scaffold` 再改」的起点建议，并把 archetype 写成 schema 真值（`data-table-portal` / `doc-reader`，原文里的 `data-table` / `article-reader` 只是别名）
- **`examples/local-1998` 端到端示例**：一个 1998 风格的本地静态页，`inspect → scaffold → build-skin → verify-skin` 全链路不写一行业务代码即产出皮肤，六重门禁 6/6 全绿、数据对齐 100%（`title` / `url` 各 `tier=1 hits=40 misses=0`）。报告 `05_verification.json` 与「3 分钟复现」说明一并入库，用来证明编译器对新站点可用，而不只是能跑仓库里那个手作皮肤

### Fixed

- **全新克隆后 `pnpm check:all` 首跑必失败**：6 个 workspace 包通过 `dist/` 互相引用类型，而 `dist/` 被 gitignore，原顺序 `typecheck → test → build` 在没有产物时会报 `Cannot find module '@webremaster/schema'`。改为 `build → typecheck → test → build:all`，并新增 `pnpm bootstrap`；README / CONTRIBUTING 同步注明"先 build"。
- **CI 用 `npx playwright` 安装浏览器**：根 `node_modules` 没有 playwright（它只装在 `compiler` 包内），`npx` 会临时拉取任意版本，与 `compiler` 依赖的 1.49 不匹配。改为 `pnpm --filter @webremaster/compiler exec playwright install --with-deps chromium`。
- **split 三态模式两侧都是残缺的**：`OriginManager.applySplit` 之前对整个 `web-remaster-root` 做 `clip-path: inset(0 0 0 50%)`，把左对齐排版的标题/作者/分数全部裁掉，只剩卡片背景；同时左半的原站被裁到 50% 宽，右对齐的 `points / comments` 也一起被切。改为两侧各自重排：原站收窄到 `p vw` 并独立滚动（流式布局重新排版，分数与评论数完整可见），重制界面整体定位到右半屏（`fixed + left: p% + width: (100-p)vw + overflow:auto`）；离开 split 时清除全部 inline 覆盖。`split.png`、`docs/demo.gif`、`packages/store/public/og.png` 均已按新布局重新生成。
- **皮肤 Skill 教了不存在的 API**：`skills/webremaster/SKILL.md` 让 agent 写 `src/adapter.ts`/`SkinApp.tsx` 并 import `queryWithFallback`——该导出并不存在，实际入口是 `src/entry.tsx` 的默认 `mountSkin`。已改为真实文件结构与真实导出名，门禁数量也从 5 修正为 6。
- **Hacker News CSV 导出默认不防公式注入**：标题可由用户提交，`exportToCSV` 第三参数默认关闭转义。皮肤侧改为显式开启，避免 `= / + / - / @` 开头的单元格在 Excel 里被当公式执行。
- **扩展版本与包版本不一致**：`public/manifest.json` 写 `1.0.0`，`package.json` 是 `0.1.0`，统一为 `0.1.0`。
- **CONTRIBUTING 的验证命令带不存在的开关**：`verify-skin <siteId> --headed` 会被 commander 直接判为 unknown option，照着文档做的人第一步就报错。因验收器固定 headless（保证 CI 可复现），已改为 `--no-vlm` / 默认 VLM 两行，并补上离线回放命令。
- **Shadow DOM 事件重定向导致 Vim 抢键**：`useVimNavigation` 只用 `event.target.tagName` 判断输入框，但 shadow 内按键的 target 会被重定向为宿主 `web-remaster-root`。于是命令面板里按 Enter 会同时触发 Vim 的 `onActivate` → TurboNav 导航，并把页面滚动复位为 0，表现为「回车跳转没反应」。改为优先读 `event.composedPath()[0]`，并以可见的 `role=dialog` 兜底；新增 3 个回归用例。
- **商店首屏对比图左右颠倒**：`BeforeAfterSlider` 的裁剪是 `inset(0 ${100 - percent}% 0 0)`，把重制版裁在左半边，而角标写的是「BEFORE 左上 / AFTER 右上」。默认 50% 时右半边永远是 1998 原版的白底表格，看起来像图片没加载。改为 `inset(0 0 0 ${percent}%)`，并让 Hero 首屏直接以 100% 显示重制版成品（fade 模式），点「100% BEFORE」才回到原版。
- **商店统计卡在缺数据时凭空造数**：`TokenStatsBar` 在索引字段缺失或为 0 时回退成硬编码 `9.2` 与 `54.8M`。改为显示 `—`，并新增「人工终审 N 站 / 自动 VLM M 站」来源拆分与「未纳入索引统计（运行时恒为 0）」的说明。
- **商店卡片把人工终审分标成 VLM 分**：`SkinCard` 一律显示 `VLM 9.2`，但该分实际来自 `vlmScoreSource: "human-review"`。改为按来源渲染「人工终审 9.2 / VLM 9.2」；详情页评分说明同步改为「人工终审评分（未跑自动 VLM）」，并注明 hackernews 的六门禁报告由本地快照回放产出。
- **`bundleSizeKb` 长期显示旧体积**：该字段只在 `finalize-skin` 时计算一次，之后任何改动重新打包都不会回写。实测 manifest 写 316.04 KB、产物已是 319.20 KB——商店卡片与 README 会一直引用错数字。现在 `build-skin` 成功后比对实际体积并就地更新 manifest（仅变化时打印一行）。
- **详情路由只认 URL**：`isThreadRoute()` 原本只测 `/item?id=`，URL 变体或离线存档都会退化成列表视图。改为 URL 命中或 DOM 指纹（`tr.athing.comtr`）兜底，离线快照也能进入讨论树。
- **评论正文选择器写死**：`bodyRule` 只有 `span.commtext`，而 2006 年的 HN（以及多数存档）用 `div.commtext`，折叠树只剩作者没有正文。改为 `div.commtext → span.commtext → .commtext` 级联，`02_contract.json` 同步。
- **皮肤的品牌橙从未生效**：`skin.css` 把 `--wr-accent: #f97316` 定义在 `.wr-hn-root`，而 `THEME_CSS` 在更近的祖先 `[data-wr-theme]` 上定义了同名变量，子元素继承时永远拿到主题蓝。改为 `.wr-hn-root [data-wr-theme]` 这一层覆盖（同时覆盖 `--wr-accent-soft`）；顺带删掉两条死规则：`:root` 在 Shadow DOM 里不匹配任何节点、`.wr-hn-skin` 无任何使用者。`after.png`、`split.png`、`docs/demo.gif`、`og.png` 已按品牌橙重新生成。
- **README 模块表的测试数过期**：模块树写 `bridge (62) / ui-kit (14) / compiler (43)`，实际是 72 / 17 / 48，和顶部 badge 的 154 也对不上。已按真实数字重写，并澄清 `release/*.zip` 不随仓库提交、只经 GitHub Release 发布。
- **`wr scaffold` 生成的模板根本打不出包**：四个缺陷叠加——`--skins-dir` 传绝对路径时被拼成 `./C:/…`（TS2307）；`entry.tsx` import 了 `bridge` 里不存在的 `mountShadowApp` / `createReactiveStore`（TS2305）；模板没有 `export default mountSkin`，wrapper 的产物自检必失败（TS1192）；提取选择器带 `html > body` 前缀，而 `body` 会被 `OriginManager` 搬进 `#wr-origin-wrapper`，必然匹配 0 项（渲染 0×0、对齐率 0.00）。另外 `skin.css` 漏了 `@source` 扫描 ui-kit，Tailwind 类不生成、布局塌陷。契约改为取快照里 `totalCount` 最大的重合组作主列表并剥离根前缀，模板重写为真实协议（`mountSkin` + `createOriginStore` + `TurboNavigator` + `HealthTracker` 挂 `diagnostics`），`cssCode` 补两条 `@source` 与容器底色。新增断言防回归：必须含 `export default function mountSkin` / `createOriginStore` / `TurboNavigator`，不得含两个虚构 API，`skin.css` 必须含 `packages/ui-kit/src`。`skins-tmp/` 加入 `.gitignore`。
- **文档与快照里残留本机绝对路径**：`docs/PROJECT_SHOWCASE.md` 有 4 处 `file:///D:/黑科技/…` 链接，推送到 GitHub 后全是 404；`skins/hackernews/01_snapshot.json` 把 `beforeScreenshotPath` 记成 `D:\…`，换台机器 clone 后 VLM 终审直接读不到原图。前者改为仓库相对路径 / Release 页，后者改为只存文件名——`wr inspect` 落盘时自动 `basename` 化，`liveVerifier` 用 `resolve(outDir, …)` 同时兼容旧快照的绝对路径。新增 `pnpm check:docs`（21 处相对链接与图片必须存在，`file://` 直接判错），接入 `check:all` 与 CI。
- `better-sqlite3` 在 Node 22.23 / Windows 下的 ABI 不匹配（NODE_MODULE_VERSION 137 vs 127），`pnpm rebuild better-sqlite3` 后 154 项测试全绿。

### Changed

- **扩展不再申请全站权限**：`host_permissions` 从 `<all_urls>` 收窄为已上架皮肤的 `matchPatterns`（当前仅 `https://news.ycombinator.com/*`）。注入本来只发生在 `SKIN_REGISTRY` 命中的页面上，全站声明会让 Chrome / Firefox 安装页显示"读取和更改您在所有网站上的数据"，也过不了认真的安全审查。现在由 `wr sync-artifacts` 在写注册表时一并派生并回写，新增皮肤自动带上对应域名；`syncArtifacts.test.ts` 断言 `<all_urls>` 会被替换、其它 manifest 字段保持原样。
- CI 增加 `concurrency`（同分支新推送取消旧运行）；Release 在打包前先跑 `pnpm test`。
- Pages 部署加 `paths` 过滤，只在 `skins/`、`packages/`、`configs/`、lockfile 变化时触发，README 改动不再触发重建。
- `configs/top40_sites.yaml` 移除无代码引用的 `budget_tokens: 55000000`；`zhengfang-edu` 标注为本地 Mock 靶场，避免被当成公开可访问站点。

[Unreleased]: https://github.com/webremaster/webremaster/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/webremaster/webremaster/releases/tag/v0.1.0
