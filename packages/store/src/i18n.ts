export type Language = "zh" | "en";

export interface Translations {
  heroTitle1: string;
  heroTitle2: string;
  heroSubtitle: string;
  installExtension: string;
  githubRepo: string;
  tokenStatsTitle: string;
  metricSites: string;
  metricRuntimeTokens: string;
  metricAvgVlm: string;
  metricCompiledTokens: string;
  metricRuntimeTokensDesc: string;
  searchPlaceholder: string;
  categoryAll: string;
  categoryDev: string;
  categoryAcademic: string;
  categoryCampus: string;
  categoryCommunity: string;
  categoryDocs: string;
  installUserscript: string;
  viewDetails: string;
  beforeBadge: string;
  afterBadge: string;
  splitPreset100Before: string;
  splitPreset50: string;
  splitPreset100After: string;
  gatePassed: string;
  dataParity: string;
  bundleSize: string;
  close: string;
  sourceCode: string;
  verificationReport: string;
  enhancedFeatures: string;
  escapeKeyHint: string;
  importSkin: string;
  importSkinDesc: string;
  architectureTitle: string;
  architectureSubtitle: string;
  viewModeSplit: string;
  viewModeSideBySide: string;
  viewModeFade: string;
  copiedToClipboard: string;
  customSkinBadge: string;
}

export const DICTIONARY: Record<Language, Translations> = {
  zh: {
    heroTitle1: "别再忍受",
    heroTitle2: "1998 年的丑陋老网站了。",
    heroSubtitle:
      "基于 Playwright 编译期逆向测绘 DOM 契约，自动编译出 Shadow DOM 样式隔离 + 现代 React/Tailwind 界面 + 双向原生状态桥接的次世代皮肤。0 Token 纯本地运行，原站 Cookie、CSRF 与功能 100% 存活。",
    installExtension: "📦 安装 Chrome 扩展",
    githubRepo: "⭐ GitHub 开源 (Star)",
    tokenStatsTitle: "1 亿 Token 编译护城河 · 真实透明账单",
    metricSites: "已重制经典网站",
    metricRuntimeTokens: "运行时消耗 Token",
    metricAvgVlm: "平均 VLM 视觉评分",
    metricCompiledTokens: "编译期已燃烧 Token",
    metricRuntimeTokensDesc: "100% 离线本地 JS · 零云端依赖",
    searchPlaceholder: "全局模糊检索 40+ 网站名称、功能或分类...",
    categoryAll: "全部",
    categoryDev: "开发者",
    categoryAcademic: "学术科研",
    categoryCampus: "高校教务",
    categoryCommunity: "社区论坛",
    categoryDocs: "文档工具",
    installUserscript: "⚡ 一键安装油猴脚本 (.user.js)",
    viewDetails: "🔍 全屏对比详情",
    beforeBadge: "BEFORE · 1998 原版",
    afterBadge: "AFTER · WebRemaster 2026",
    splitPreset100Before: "100% 原版",
    splitPreset50: "50% 对比",
    splitPreset100After: "100% 重制",
    gatePassed: "6 重门禁全绿",
    dataParity: "数据对齐率",
    bundleSize: "脚本体积",
    close: "关闭",
    sourceCode: "重制源码",
    verificationReport: "Playwright 验收报告",
    enhancedFeatures: "内置现代超级能力",
    escapeKeyHint: "按 Alt+Shift+R 随时在原版/新版/分屏间瞬切",
    importSkin: "➕ 导入社区皮肤",
    importSkinDesc: "输入 GitHub Gist、Raw URL 或粘贴皮肤清单 JSON，即刻在本地预览并安装",
    architectureTitle: "WebRemaster 拔尖架构与硬核壁垒",
    architectureSubtitle: "彻底超越传统油猴脚本与 Stylus CSS 的 5 项底层革命",
    viewModeSplit: "分屏滑动",
    viewModeSideBySide: "双栏并列",
    viewModeFade: "透明渐变",
    copiedToClipboard: "已复制到剪贴板",
    customSkinBadge: "社区自制",
  },
  en: {
    heroTitle1: "Stop tolerating",
    heroTitle2: "1998 websites.",
    heroSubtitle:
      "Compiler-driven AI reverse-engineers legacy DOM contracts into zero-token, Shadow-DOM isolated React + Tailwind UI. Seamless two-way native state bridging keeps original cookies, CSRF tokens, and state 100% functional.",
    installExtension: "📦 Get Chrome Extension",
    githubRepo: "⭐ Star on GitHub",
    tokenStatsTitle: "100M Token Compilation Factory · Transparent Metrics",
    metricSites: "Remastered Sites",
    metricRuntimeTokens: "Runtime Tokens",
    metricAvgVlm: "Average VLM Score",
    metricCompiledTokens: "Compilation Tokens Burned",
    metricRuntimeTokensDesc: "100% Offline Local JS · Zero Cloud Dependency",
    searchPlaceholder: "Search 40+ sites by name, archetype, or domain...",
    categoryAll: "All",
    categoryDev: "Developer",
    categoryAcademic: "Academic",
    categoryCampus: "Campus Portal",
    categoryCommunity: "Community",
    categoryDocs: "Docs & Utility",
    installUserscript: "⚡ Install Userscript (.user.js)",
    viewDetails: "🔍 Split Inspector",
    beforeBadge: "BEFORE · 1998 Legacy",
    afterBadge: "AFTER · WebRemaster 2026",
    splitPreset100Before: "100% Legacy",
    splitPreset50: "50% Split",
    splitPreset100After: "100% Remaster",
    gatePassed: "6 Gates Passed",
    dataParity: "Data Parity",
    bundleSize: "Bundle Size",
    close: "Close",
    sourceCode: "Skin Source",
    verificationReport: "Verification Report",
    enhancedFeatures: "Built-in Super Powers",
    escapeKeyHint: "Press Alt+Shift+R anytime to toggle Original / Remaster / Split",
    importSkin: "➕ Import Custom Skin",
    importSkinDesc: "Enter a GitHub Gist, Raw JSON URL, or manifest to preview and install",
    architectureTitle: "WebRemaster Architecture & Superpowers",
    architectureSubtitle: "5 Core Breakthroughs Beyond Traditional Tampermonkey & UserCSS",
    viewModeSplit: "Split Slider",
    viewModeSideBySide: "Side-by-Side",
    viewModeFade: "Fade Overlay",
    copiedToClipboard: "Copied to clipboard",
    customSkinBadge: "Community",
  },
};

