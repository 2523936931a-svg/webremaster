# GitHub 上线检查清单

> 目标：把一个"本地跑得通"的项目，变成一个"陌生人 30 秒内愿意 star"的公开仓库。
> 顺序按投入产出比排列，前 4 节合计约 40 分钟。

---

## 1. 十秒硬替换：把占位组织换成你的账号

仓库里所有链接目前指向占位的 `webremaster/webremaster`。上传前必须一次性替换，否则首屏 CI badge 会显示 **not found**，Release 链接会 404。

```powershell
# 在仓库根目录执行；把 owner 换成你的 GitHub 用户名
$owner = "你的GitHub用户名"

Get-ChildItem -Recurse -File -Include *.md,*.json,*.yml,*.yaml |
  Where-Object { $_.FullName -notmatch 'node_modules|\.git\\' } |
  ForEach-Object {
    $p = $_.FullName
    (Get-Content -Raw -Encoding UTF8 -LiteralPath $p) `
      -replace 'webremaster/webremaster', "$owner/WebRemaster" `
      -replace 'webremaster\.github\.io/webremaster', "$owner.github.io/WebRemaster" |
      Set-Content -Encoding UTF8 -NoNewline -LiteralPath $p
  }
```

注意两点：

- GitHub Pages 的项目页路径**区分大小写**，仓库叫 `WebRemaster` 就必须写 `/WebRemaster/`。
- 只替换 `webremaster/webremaster` 这种"组织/仓库"形式，不要动 npm 包名 `@webremaster/*`。

---

## 2. 分支、远端与首次推送

```powershell
git branch -M main                      # CI 同时监听 main/master，但 GitHub 默认分支用 main
git add -A
git commit -m "chore: add OSS governance files and align docs"
git remote add origin https://github.com/<owner>/WebRemaster.git
git push -u origin main
git tag v0.1.0
git push origin v0.1.0                  # 触发 release.yml，自动产出扩展 zip
```

---

## 3. 仓库设置（网页端 5 分钟）

| 设置项 | 位置 | 值 |
| :--- | :--- | :--- |
| Description | 右上 About | `Turn 1998-era websites into modern React UIs — Shadow DOM isolated, zero runtime tokens.` |
| Website | 右上 About | 你的 Pages 地址 |
| Topics | 右上 About | `userscript` `chrome-extension` `shadow-dom` `react` `tailwindcss` `playwright` `web-modernization` `dark-mode` |
| Pages | Settings → Pages | Source 选 **GitHub Actions**（`deploy-store.yml` 已就绪） |
| Discussions | Settings → General | 开启，承接"求重制某站"的需求 |
| Social preview | Settings → General | 上传 1280×640 的图（可直接用 `skins/hackernews/split.png` 裁切） |
| License | 仓库识别 | 已放 `LICENSE`（MIT），About 会自动显示 |

---

## 4. 三处"露馅点"必须先校准

陌生人点进仓库后最常做的三件事：看 badge、看 `skins/`、点进 `05_verification.json`。这三处目前都有硬伤。

### 4.1 测试数

当时真实数量是 **149**（schema 15 + bridge 69 + ui-kit 16 + store 2 + compiler 47）；补入 fixture 回放用例后为 **150**（compiler 48）。README badge 当时写 141、正文写 117，两个数字互相矛盾，而且都对不上。

已修正为该口径；后续数字会持续变化，建议最终把静态 badge 换成真实 CI badge，只在正文写"覆盖 6 个包"。

### 4.2 `vlmScore` 的来源已标注

`skins/hackernews/manifest.json` 写 `"vlmScore": 9.2`，而 `05_verification.json` 里是 `"vlmScore": 0`、`"vlmFeedback": "待终审"`。数字本身没错，错在没说明来源——一个来自人工终审，一个来自尚未运行的自动通道。

已处理：`SkinManifestSchema` 新增 `vlmScoreSource: "auto-vlm" | "human-review"`（默认 `auto-vlm`），Hacker News 的 manifest 标为 `human-review`，`sync-artifacts` 的输出改成"平均评分: 9.2分（自动 VLM 0 / 人工终审 1）"。

以后如果要让两个文件完全对齐，只需真跑一次自动通道：

```bash
pnpm wr verify-skin hackernews
```

这条命令会访问真实站点，网络不可达时会直接超时。无网环境改用离线回放（已在 CLI 落地）：

```bash
pnpm wr verify-skin hackernews --no-vlm --fixture configs/hn-recon/front.html
```

回放会以 200 空响应兜住同源静态资源，避免 `net::ERR_FAILED` 污染 `zero-runtime-errors`；报告 Gate 1 的 details 会写明「离线 fixture 回放」，且不落盘 `after.png` / `split.png`，不会用回放截图覆盖真机图。本次已用它跑出 6/6 全绿、数据对齐 100%、健康度 0 miss 的报告。

### 4.3 Top 40 的进度口径

`configs/top40_sites.yaml` 里 40 个站只有 **1 个** `status: ready`，其余 39 个是 `pending`。README 用"Top 40 待重制网站矩阵"这种表述，会让人以为是已交付能力。

建议改成"路线图"口径，并把缺口变成招募点：

```markdown
## 🎯 皮肤路线图（1 / 40 已上架）

已上架：Hacker News（`skins/hackernews`，含 before/after 与门禁报告）
规划中：Lobsters、arXiv、V2EX、阮一峰博客……（见 `configs/top40_sites.yaml`）

> 想要某个站点被重制？开一个 `Site remaster request` Issue，我们按 👍 排序。
```

"1/40 + 求共建"比"40 站矩阵"可信得多，也更容易收到第一个外部 PR。

### 4.4 `split.png` 曾是坏图（已修复）

现象：左半是原站，右半只有工具栏和几条深色横条，重制界面的文字全部消失。

真机定位（Playwright + `configs/hn-recon/front.html` 本地 fixture）：

| 模式 | host 尺寸 | clip-path | 首个卡片位置 |
| :--- | :--- | :--- | :--- |
| remastered | 1424 × 2419 | none | left 12，标题 left 64 |
| split（修复前） | 1424 × 2419 | `inset(0 0 0 50%)` | left 12，标题 left 64（全在裁切线左侧） |

根因不是高度塌缩，而是**裁错了对象**：重制 UI 是左对齐排版，标题、作者、分数都在每一行的左半部分，把 host 从 50% 处裁掉左半，等于把所有文字裁掉，只剩卡片的半透明背景。

修法（`packages/bridge/src/originManager.ts` 的 `applySplit`）：不再裁剪 host，改为把 host 整体挪到右半屏并独立滚动——

```ts
host.style.position = "fixed";
host.style.left = `${p}%`;
host.style.width = `${100 - p}vw`;
host.style.height = "100vh";
host.style.overflow = "auto";
host.style.clipPath = "none";
```

离开 split 时把这 8 个 inline 属性一起清掉，避免污染 remastered 状态。

第二轮修的是另一半：左半原站原本 `width: 100vw` + `clip-path: inset(0 50% 0 0)`，等于把 1224px 宽的 HN 表格从 720px 处切断，右对齐的 `points / comments` 全部消失。现在改成收窄重排——

```ts
wrapper.style.width = `${p}vw`;   // 原站按 p 重新流式排版，而不是被裁
wrapper.style.overflow = "auto";
```

真机复测：`#wr-origin-wrapper` 从 1280×800 变为 720×900，host 为 left 720 / width 720 / clip none；左半每条都完整显示「标题 + 646 points by yigitdemirag 8 hours ago | hide | 557 comments」。

效果：两侧都是重新排版后的完整内容，不再是一边残缺；`split.png`、`docs/demo.gif`、`packages/store/public/og.png` 都已按新布局重新生成。三态切换现在是真正可演示的卖点。

### 4.5 在线试用（`#live-demo`）的三个前提

商店页现在能在浏览器里直接跑一遍运行时，但要知道它为什么能跑、边界在哪：

1. **同源**：iframe 加载 `packages/store/public/data/demo/*.html`（本地快照），页面与站点同源，父窗口才能 `contentDocument` 注入脚本；换成跨域 URL 会直接失效。
2. **快照要干净**：`front.html` / `item1.html` 原本引了原站的 `hn.js`，复制到 `data/demo/` 后会 404 并污染控制台；已从两份快照里删掉该 `<script>`。
3. **窄屏分屏会挤**：split 下原站被收窄重排，`< 640px` 时 HN 顶栏的 float 链接会重叠——这是原站本身不支持窄视口，不是皮肤问题；宽屏（≥ 1280px）下左半是 720px，与原站桌面宽度一致。

`pnpm test` 从 153 涨到 **154**（ui-kit 新增 `nextPalette` 循环用例）。

---

## 5. 首屏素材：一张图决定 80% 的 star

已在 `docs/demo.gif` 生成 **7.9 秒 / 377 KB** 的 before → after → split 三态循环，README 首屏直接引用。它既证明"重制后确实好看"，也证明 split 对比是可交互演示的。

GitHub 上做得最好的项目（refined-github、Dark Reader）都用**真实操作动图**在第一屏证明"它真的能用"。已在 `docs/palette.gif` 补录一段 **4.9 秒 / 634 KB** 的真实交互：`Cmd+K` → 输入 `daisy` → 列表过滤出「第 9 条 · DaisyRose-27B」→ 回车滚动定位并高亮该卡片，放在 README 的 PowerUps 段落。

还剩两个值得录的动作：

1. 打开 `news.ycombinator.com`，旧版白页 → 0.3 秒内变成暗色重制版（证明零闪烁，`demo.gif` 的 before→after 帧已部分覆盖）
2. 按 `Alt + Shift + R`，三态切换 remastered → original → split（证明"可随时退回原站"，`demo.gif` 已覆盖静态三态）

Windows 下用 ScreenToGif 或 OBS 录 mp4，或用 Playwright `recordVideo` 直接录制再转 GIF：

```bash
ffmpeg -ss 2.0 -to 6.9 -i page.webm -vf "fps=9,scale=720:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer" -loop 0 docs/palette.gif
```

控制在 **5 MB 以内**、宽度 ≤ 1000px，否则 README 加载会卡。`palette.gif` 的录制脚本思路：Playwright 拦截主文档回放本地 fixture + `addInitScript` 注入 `.user.js` + `recordVideo`，再按时间点剪掉加载前的空白帧。

---

## 6. 工程体验：两个会劝退贡献者的坑

### 6.1 `better-sqlite3` 原生编译

本机 `pnpm test` 目前有 4 个用例挂在：

```
NODE_MODULE_VERSION 137. This version of Node.js requires NODE_MODULE_VERSION 127.
```

这是 `better-sqlite3` 的预编译二进制与本地 Node ABI 不匹配。对 Linux CI 通常无感，但 Windows 贡献者第一次 `pnpm install` 就可能踩坑。可选方案：

- 短期：在 README 故障排查里加一行 `pnpm rebuild better-sqlite3`；
- 中期：`compiler` 改用 Node 22 内置的 `node:sqlite`，彻底去掉原生依赖；
- 或者把 `better-sqlite3` 降为 `optionalDependencies`，缓存不可用时自动退化为内存 Map。

### 6.2 没有 lint

仓库有 `typecheck` 和 `test`，但没有 ESLint / Prettier 配置，6 个包的代码风格只能靠人肉维持。外部 PR 一多，diff 会非常脏。建议加 `eslint` + `prettier` + `lint-staged`，并在 CI 里加一个 `pnpm lint` job。

---

## 7. 首发 Release 与冷启动

发布后 24 小时是 star 曲线的分水岭，准备好三段素材再发：

1. **GitHub Release**（tag 已触发 workflow）：标题写 `v0.1.0 — Hacker News, remastered`，正文放 GIF + 一张 before/after 对比 + 安装三步。
2. **Hacker News / Reddit r/webdev**：标题别写"我做了个编译器"，写"Show HN: I remastered Hacker News with Shadow DOM and zero runtime LLM calls"，附在线 demo 链接。
3. **V2EX / 掘金 / 少数派**：中文侧重"为什么老网站不该长这样"，用 V2EX、阮一峰博客做下一批皮肤的投票，把读者转成 Issue。

冷启动时最忌一次性承诺 40 个站。只承诺"本周再上 2 个"，然后真的上，比路线图更有说服力。

---

## 8. 上线后第一周建议做的事

- 把 `release/webremaster-chrome-ext.zip` 从 git 跟踪中移除（`git rm --cached`），改由 Release Assets 分发，避免每次构建产生二进制 diff
- 用 `pnpm wr list` 的真实输出替换 README 里手写的进度表
- 给 `skins/hackernews` 补一个 `README.md`，写清选择器契约与改版风险点——这是外部贡献者最需要抄的模板
- 开一个 `good first issue`：`Add a skin for Lobsters`，把 SOP 里的 6 步拆成 checklist
