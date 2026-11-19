<div align="center">

# 🏛️ WebRemaster

**Stop tolerating 1998 websites. Zero-token, Shadow-DOM isolated React remasters for classic websites.**

[![CI Status](https://github.com/webremaster/webremaster/actions/workflows/ci.yml/badge.svg)](https://github.com/webremaster/webremaster/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![React 19](https://img.shields.io/badge/React-19.0-61dafb.svg)](https://react.dev/)
[![Tailwind CSS v4](https://img.shields.io/badge/Tailwind-v4.0-38bdf8.svg)](https://tailwindcss.com/)
[![Playwright](https://img.shields.io/badge/Verified%20with-Playwright-2EAD33.svg)](https://playwright.dev/)

[**🌐 皮肤商店与 Before/After 演示站**](https://webremaster.github.io/webremaster/) · [**📦 下载 Chrome 扩展 (.zip)**](https://github.com/webremaster/webremaster/releases) · [**📖 架构设计白皮书**](#-核心架构巧思)

---

</div>

## 💡 什么是 WebRemaster？

**WebRemaster 不是简单的改改 CSS 配色！**

它是一个编译期 AI 驱动的**「老旧网站前端重制编译器」**：
1. **编译期（Playwright DOM X-Ray）**：逆向测绘目标站点的 DOM 结构、表单交互契约与数据字段；
2. **生成期（Multi-Agent + AutoClaw）**：自动编写现代 React 19 + Tailwind v4 界面与 4 级抗改版数据提取器；
3. **运行期（0 Token · 纯本地 JS）**：
   - **隐身原站（Hidden Origin）**：原站 DOM 完整保留在不可见层，原站 Cookie、CSRF Token、ASP.NET ViewState 与原生 jQuery/Vue 事件 **100% 存活**！
   - **Shadow DOM 样式完全隔离**：新界面挂载于独立 Shadow Root，彻底杜绝老站样式污染；
   - **原生属性 Setter 事件桥**：在新界面填表/搜索/点击时，无缝穿透触发原站原生监听器；
   - **`Alt+Shift+R` 0ms 逃生开关**：随时瞬切「原版 / 新版 / 左右分屏对比」；一旦提取异常自动安全回退，**永不白屏**；
   - **自带超能力（PowerUps）**：每个重制站点免费获赠 `Cmd+K` 全局模糊搜索、表格一键导出 CSV/Markdown、暗黑/浅色主题、Vim 键盘导航（`j`/`k`/`Enter`）。

---

## 📸 Before / After 震撼对比 (Hacker News)

| 1998 原版 (Original) | 2026 WebRemaster 重制版 |
| :---: | :---: |
| <img src="skins/hackernews/before.png" width="400" alt="Hacker News Before" /> | <img src="skins/hackernews/after.png" width="400" alt="Hacker News After" /> |
| 古老 Table 布局 · 刺眼白底 · 缺乏移动端适配 | 高密度暗黑微光 · 等宽数字排版 · TurboNav 0ms 预取 · 折叠评论树 |

---

## 🏗️ Monorepo 架构与模块接线

```text
WebRemaster/
├── packages/
│   ├── schema/        # @webremaster/schema (唯一 Zod 共享契约)
│   ├── bridge/        # @webremaster/bridge (零依赖浏览器运行时 SDK + PowerUps)
│   ├── ui-kit/        # @webremaster/ui-kit (Linear 级重制界面组件库)
│   ├── compiler/      # @webremaster/compiler (Playwright 测绘 + Vite 打包 + 6 重验证 CLI)
│   ├── extension/     # @webremaster/extension (Chrome Manifest V3 一键皮肤管理器)
│   └── store/         # @webremaster/store (GitHub Pages 皮肤商店 + Before/After 滑块)
├── skins/             # 编译产物库 (包含 hackernews 等站点的 .user.js、截图与报告)
├── configs/           # Top 40 待重制高频老旧网站清单 (configs/top40_sites.yaml)
└── skills/            # OpenClaw / AutoClaw 专属 Agent-Native 技能定义
```

---

## ⚡ 快速开始

### 1. 环境准备
- Node.js >= 22
- pnpm >= 10

```bash
# 克隆仓库并安装依赖
git clone https://github.com/webremaster/webremaster.git
cd webremaster
pnpm install
```

### 2. 全量类型检查与单元测试
```bash
# 全仓类型校验（0 报错）
pnpm typecheck

# 运行全套单元测试（43+ 核心运行时单测全绿）
pnpm test

# 一键打包全栈（Core + Extension + Store）
pnpm build:all
```

### 3. 本地启动皮肤商店 (Store WebUI)
```bash
pnpm --filter @webremaster/store dev
# 打开浏览器访问 http://localhost:5173 体验 Before/After 拖拽对比滑块！
```

### 4. 加载 Chrome 扩展
1. 打开 Chrome 浏览器，访问 `chrome://extensions/`；
2. 开启右上角 **「开发者模式」**；
3. 点击 **「加载已解压的扩展程序」**，选择目录 `packages/extension/dist/`；
4. 打开 [Hacker News](https://news.ycombinator.com/)，界面自动秒变暗黑高密度现代版！

---

## 🦞 AutoClaw / OpenClaw 零 Key 驱动

你的 1 亿 Token 位于 AutoClaw（智谱澳龙）本地客户端中，**无需配置任何外部 API Key**！

我们在 `packages/compiler` CLI 中暴露了 4 个确定性本地原子命令：

```bash
# 1. 测绘站点 DOM X-Ray，产出 01_snapshot.json 与 before.png
pnpm wr inspect https://news.ycombinator.com/ --id hackernews

# 2. 本地 TypeScript + Vite IIFE 打包，产出 hackernews.user.js
pnpm wr build-skin hackernews

# 3. 启动 Playwright 真浏览器执行 5 重硬门禁回归测试并拍摄 after.png
pnpm wr verify-skin hackernews --no-vlm

# 4. 上架终审（写入 manifest.json 并同步至 Chrome 扩展与商店）
pnpm wr finalize-skin hackernews --vlm-score 9.2 --category "开发者" --tagline-zh "Hacker News 暗黑重制" --tagline-en "Hacker News Remastered"
pnpm sync:artifacts
```

---

## 🎯 Top 40 重制网站矩阵 (`configs/top40_sites.yaml`)

涵盖 6 大高频刚需矩阵：
1. **全球开发者生态（10 站）**：HackerNews, Lobsters, PyPI, Go Dev Docs, GNU, Kernel Lore, SQLite, curl, man7, GCC.
2. **学术科研与论文（8 站）**：arXiv CS.AI, arXiv Abs, DBLP, PubMed, OEIS, Wolfram MathWorld, Stanford Plato, Project Gutenberg.
3. **协议与技术标准（6 站）**：RFC 9110, W3C HTML5, Python PEPs, cppreference, PostgreSQL Docs, Git SCM.
4. **经典社区与百科（6 站）**：Wikipedia, Old Reddit, Slashdot, Craigslist, YC Jobs, Internet Archive.
5. **中文极客与高校刚需（6 站）**：V2EX, 阮一峰博客, OI Wiki, 廖雪峰教程, 知网公开检索, 高校正方教务系统靶场.
6. **硬核数据与工具门户（4 站）**：IANA Ports, NIST NVD, Unicode Charts, FFmpeg Docs.

---

## 📜 开源协议

本项目采用 [MIT License](LICENSE) 协议开源。
