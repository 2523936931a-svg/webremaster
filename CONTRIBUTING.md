# 🤝 贡献者指南 (Contributing to WebRemaster)

感谢你关注并愿意为 WebRemaster 做出贡献！WebRemaster 是一个致力于让全网老旧、粗糙、无排版的经典网站焕发次世代新生的开源项目。

---

## 🏛️ Monorepo 项目结构与分层架构

```
packages/
  ├── schema/      # Zod 强类型数据契约与规范定义 (Contract, DesignSpec, Manifest)
  ├── bridge/      # 零依赖浏览器运行时 SDK + PowerUps 微内核 (ShadowRoot, TurboNav, PortalSlot)
  ├── ui-kit/      # 现代暗黑响应式组件库与调色板 (Linear/Dub 级质感, Shell, Card, Table)
  ├── compiler/    # Playwright 测绘引擎 + 6 重门禁回归校验器 + wr CLI 编译器
  ├── extension/   # Chrome MV3 跨浏览器扩展
  └── store/       # Web 皮肤展示大厅与 Before/After 拖拽对比检视器
skins/             # 各站点重制皮肤源码与打包产物 (entry.tsx, .user.js, manifest.json)
```

---

## 💻 本地开发环境就绪 (Getting Started)

### 前置要求
- **Node.js**: `>= 22.0.0`
- **pnpm**: `>= 9.0.0`
- **Playwright 浏览器**: 运行 `npx playwright install chromium`

### 1. 克隆与安装依赖
```bash
git clone https://github.com/webremaster/webremaster.git
cd webremaster
pnpm install
```

### 2. 运行环境诊断
```bash
pnpm doctor
# 或运行：pnpm wr doctor
```

### 3. 本地启动皮肤大厅
```bash
pnpm dev
# 访问 http://localhost:5173
```

---

## 🎨 开发一个新网站重制皮肤 (SOP 流水线)

### 步骤 1：脚手架初始化模板
```bash
pnpm wr scaffold <siteId> --url "https://target-website.com" --category "开发者" --archetype "doc-reader"
```
这将在 `skins/<siteId>/` 下生成：
- `02_contract.json`: 数据与选择器契约
- `03_design.json`: 视觉规范与原型蓝图
- `src/entry.tsx`: React 19 挂载入口
- `src/skin.css`: Tailwind v4 局部样式

### 步骤 2：启动极速实时热重载开发桥 (HMR)
```bash
pnpm wr dev <siteId>
```
1. 打开浏览器并在 Tampermonkey / ScriptCat 中安装生成的 `skins/<siteId>/<siteId>.dev.user.js`。
2. 打开目标站点页面。
3. 在本地编辑 `skins/<siteId>/src/entry.tsx`，浏览器内原网页将实现**毫秒级热重载（HMR）**！

### 步骤 3：单文件零闪烁打包
```bash
pnpm wr build-skin <siteId>
```
产出经过打包自检的单文件生产脚本 `skins/<siteId>/<siteId>.user.js`。

### 步骤 4：运行 Playwright 六重硬性门禁与 VLM 视觉评审
```bash
pnpm wr verify-skin <siteId> --no-vlm        # 只跑六门禁，不需要 OPENAI_API_KEY
pnpm wr verify-skin <siteId>                # 六门禁 + VLM 视觉评审（需要 Key）
```
站点不可达（地域封锁、原站改版、CI 无外网）时，用本地快照回放：
```bash
pnpm wr verify-skin <siteId> --no-vlm --fixture configs/<siteId>-recon/front.html
```
回放只响应主文档与同目录同名静态资源，报告里会标注「离线 fixture 回放」，不会覆盖真机截图。
验收器固定 headless 运行（保证 CI 可复现），没有 `--headed` 开关；要看过程请用 `wr dev`。
门禁将严格检验：
1. `zero-runtime-errors`: 0 页面报错
2. `zero-flash-curtain-lifted`: 0 闪烁幕帘平滑揭起
3. `data-parity-and-health`: 数据对齐率 $\ge 90\%$
4. `no-broken-render`: 无样式溢出、无 undefined 破损
5. `bridge-and-split-smoke`: `Alt+Shift+R` 瞬切与原生状态保全
6. `portal-and-turbonav-integrity`: 虫洞插槽与 0ms SPA 导航完整性

### 步骤 5：终审上架与产物同步
```bash
pnpm wr finalize-skin <siteId> --vlm-score 9.2
pnpm sync:artifacts
```

`sync:artifacts` 除了写扩展注册表与商店索引，还会把 `packages/extension/public/manifest.json` 的 `host_permissions` 重新派生成"所有上架皮肤的 `matchPatterns`"。**不要手改它加 `<all_urls>`**：扩展的安装权限提示应当恰好等于已上架站点，这也是 SECURITY.md 里承诺的边界。

> 想验证编译器对新站点的可用性，`examples/local-1998/` 有一条不用写代码的完整链路（inspect → scaffold → build → verify）。

---

## 🧪 提交前验证 (Check All)

在发起 Pull Request 之前，请务必执行全量自动化验收检查：

```bash
pnpm check:all
```

此命令将按顺序执行：
1. `pnpm build`（先产出各 workspace 包的 `dist`，后续类型检查与测试都依赖它）
2. `pnpm typecheck`（6 个包严苛类型检查）
3. `pnpm test`（154 项单元测试）
4. `pnpm build:all`（全栈各端完整打包编译）
5. `pnpm check:docs`（README / docs 里 21 处相对链接与图片必须真实存在，`file:///D:/…` 这类本机路径直接判错）

---

## 📜 提交规范 (Commit Convention)

我们遵循标准 Conventional Commits：
- `feat(skin)`: 新增某站点重制皮肤
- `feat(powerup)`: 新增超级能力插件
- `fix(bridge)`: 修复运行时或 DOM 提取 Bug
- `docs`: 文档、介绍书或样例更新
- `refactor`: 重构且不改变外部行为
