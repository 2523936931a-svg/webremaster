## 📝 PR 概述 (Pull Request Overview)

- **修改类型**: `feat` | `fix` | `refactor` | `docs` | `chore`
- **关联 Issue**: Fixes #

---

## 🔍 修改内容详细说明 (Detailed Changes)

- 

---

## ✅ 严格工程自检清单 (Pre-flight Checklist)

- [ ] **严格类型检查**: 本地运行 `pnpm typecheck` 全部通过 (0 error)。
- [ ] **自动化测试全绿**: 本地运行 `pnpm test` (141+ tests 全通过)。
- [ ] **全栈构建无误**: 本地运行 `pnpm build:all` 无报错且正常输出。
- [ ] **若新增皮肤**:
  - [ ] 皮肤代码严格挂载在 `ShadowRoot` 内部，无全局 CSS 泄露。
  - [ ] 经过 `wr verify-skin <siteId>` 6 重门禁回归测试。
  - [ ] VLM 视觉评分达到 `≥ 8.5` 准入标准。
  - [ ] 运行 `pnpm sync:artifacts` 已同步扩展注册表与皮肤商店索引。
- [ ] **代码规范**: 遵循项目现有 TypeScript / React 19 / Tailwind 架构规范。
