# 贡献指南 (Contributing to WebRemaster)

感谢你关注 WebRemaster！我们致力于消灭互联网上所有丑陋、刺眼、缺乏排版的古典老旧网站，让全球开发者、学者和用户都能以极简优雅的现代界面浏览经典内容。

---

## 🛠️ 本地开发环境准备

- **Node.js**：>= 22.0.0
- **pnpm**：>= 10.0.0
- **浏览器环境**：已安装 Chrome 或通过 Playwright 驱动

```bash
# 1. 克隆代码库
git clone https://github.com/webremaster/webremaster.git
cd webremaster

# 2. 安装全部 workspace 依赖
pnpm install

# 3. 运行环境诊断
pnpm wr doctor

# 4. 运行全仓类型检查与测试
pnpm typecheck
pnpm test
```

---

## 🚀 如何为新网站贡献一套 Remaster 皮肤？

每一套皮肤存放在 `skins/<siteId>/` 目录下，遵循标准 5 步编译流水线：

### 第一步：测绘原站 (DOM X-Ray)
```bash
pnpm wr inspect https://example.com/list --id example-site
```
产出：
- `skins/<siteId>/01_snapshot.json`：DOM 骨架、视口元数据与重复行样例；
- `skins/<siteId>/before.png`：原站高保真视口截图。

### 第二步：定义数据契约与设计规范
- 编写 `02_contract.json`：遵循 `@webremaster/schema` 的 `SiteContractSchema`，声明列表容器选择器、主条目选择器与提取字段降级链（`selectors`、`relativeTo`、`regexExtract`）；
- 编写 `03_design.json`：指定设计原型（`news-feed` / `data-table-portal` / `nested-thread` / `doc-reader`）与强调色。

### 第三步：编写 React 19 + Tailwind v4 界面
在 `skins/<siteId>/src/` 目录下编写：
- `entry.tsx`：默认导出一个符合挂载协议的函数 `mount({ host, shadowRoot, contract })`；
- `skin.css`：Tailwind v4 样式或自定义微调样式。

推荐优先复用 `@webremaster/ui-kit` 提供的开箱即用现代组件：
- `RemasterShell`：顶部导航栏与容器骨架；
- `FeedListCard`：资讯流条目卡片；
- `SmartDataTable`：可排序、可过滤、可导出 CSV/Markdown 的智能表格；
- `NestedThreadTree`：可折叠高亮的多级评论树；
- `ReaderProseLayout`：带阅读进度指示与目录锚点的极简排版。

### 第四步：本地打包与 6 重硬门禁活体验证
```bash
# 打包为单文件 .user.js
pnpm wr build-skin <siteId>

# 启动 Playwright 真浏览器执行回归门禁（无报错、数据对齐率 ≥ 90%、无白屏）
pnpm wr verify-skin <siteId> --no-vlm
```

### 第五步：上架终审与同步
```bash
# 门禁全绿后上架
pnpm wr finalize-skin <siteId> --vlm-score 9.2 --category "开发者" --tagline-zh "一句话亮点" --tagline-en "One-line highlight"

# 同步产物至 Chrome 扩展注册表与皮肤商店
pnpm sync:artifacts
```

---

## 🛡️ 六重硬门禁验收标准

提交 Pull Request 之前，请确保目标站点能够 100% 通过 6 扇门禁：
1. **Gate 1 (Zero-Blank)**：无白屏闪烁，视口非空白像素占比 > 15%；
2. **Gate 2 (Zero-Console-Errors)**：控制台 0 运行时 uncaught 异常；
3. **Gate 3 (Data-Parity)**：数据对齐率 ≥ 90%（重制条目数 / 原站条目数）；
4. **Gate 4 (Native-Event-Alive)**：原生事件存活（点击、翻页、展开至少触发一项原生交互）；
5. **Gate 5 (Bundle-Budget)**：单文件 `.user.js` 体积预算 ≤ 350 KB；
6. **Gate 6 (VLM-Vision-Review)**：大模型视觉评审分 ≥ 8.5（自动化流水线评审）。

---

## 📦 Pull Request 提交准则

- 分支命名：`feature/skin-<siteId>` 或 `fix/<issue-name>`；
- Commit Message：遵循 Conventional Commits（如 `feat(skin): add arXiv CS.AI remaster skin`）；
- 提交前务必本地执行：
  ```bash
  pnpm typecheck
  pnpm test
  pnpm build:all
  ```
