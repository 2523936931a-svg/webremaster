import { describe, expect, it } from "vitest";
import {
  SiteSnapshotSchema,
  SiteContractSchema,
  UXDesignSpecSchema,
  VerificationReportSchema,
  SkinManifestSchema,
  StoreIndexSchema,
} from "../src/index.js";

const validSnapshot = {
  siteId: "hacker-news",
  url: "https://news.ycombinator.com/",
  matchPatterns: ["https://news.ycombinator.com/*"],
  capturedAt: "2026-11-19T08:00:00.000Z",
  title: "Hacker News",
  viewport: { width: 1440, height: 900 },
  hasFramesetOrIframes: true,
  sameOriginFrames: [
    {
      frameId: "frame-login",
      src: "https://news.ycombinator.com/login",
      title: "login",
      skeletonHtml: "<form><input name='goto'></form>",
    },
  ],
  domSkeletonHtml: "<table><tbody><tr><td>story</td></tr></tbody></table>",
  repeatedGroups: [
    {
      groupId: "story-list",
      containerSelector: "table.itemlist",
      itemSelector: "tr.athing",
      pairingMode: "paired-next-sibling",
      companionSelector: "tr.athing + tr",
      totalCount: 30,
      sampleItemsHtml: [
        '<tr class="athing"><td>1</td></tr>',
        '<tr class="athing"><td>2</td></tr>',
        '<tr class="athing"><td>3</td></tr>',
      ],
    },
  ],
  interactiveElements: [
    {
      id: "login-link",
      tag: "a",
      label: "login",
      selectors: ["a[href='login']"],
      hasCsrfOrHiddenInputs: false,
      isCaptchaOrCanvas: false,
    },
    {
      id: "search-form",
      tag: "form",
      role: "search",
      type: "search",
      label: "search",
      selectors: ["form"],
      formAction: "https://hn.algolia.com/api/v1/search",
      formMethod: "get",
      hasCsrfOrHiddenInputs: true,
      isCaptchaOrCanvas: false,
      frameId: "frame-login",
      boundingBox: { x: 8, y: 16, width: 320, height: 40 },
    },
  ],
  originalItemCountHint: 30,
  beforeScreenshotPath: "screenshots/hacker-news/before.png",
};

const validContract = {
  siteId: "hacker-news",
  siteName: "Hacker News",
  matchPatterns: ["https://news.ycombinator.com/*"],
  routes: [
    {
      routeId: "feed",
      urlRegex: "^https://news\\.ycombinator\\.com/?$",
      domFingerprintSelector: "table.itemlist",
      archetype: "news-feed",
      primaryListContainer: "table.itemlist",
      primaryItemSelector: "tr.athing",
      pairingMode: "paired-next-sibling",
      itemFields: [
        {
          fieldName: "title",
          fieldType: "string",
          selectors: ["td.title > span.titleline > a"],
          attribute: "textContent",
          required: true,
        },
        {
          fieldName: "url",
          fieldType: "url",
          selectors: ["td.title > span.titleline > a"],
          attribute: "href",
          required: true,
        },
        {
          fieldName: "points",
          fieldType: "number",
          selectors: ["td.subtext > span.score"],
          relativeTo: "next-sibling",
          attribute: "textContent",
          regexExtract: "\\d+",
          required: false,
        },
        {
          fieldName: "comments",
          fieldType: "number",
          selectors: ["td.subtext > a:last-of-type"],
          relativeTo: "next-sibling",
          attribute: "textContent",
          regexExtract: "(\\d+)&nbsp;comments?",
          spatialLabelRegex: "comments?",
          required: false,
        },
      ],
      portalSlots: [
        {
          slotName: "vote-form",
          description: "每条新闻旁的投票箭头表单",
          selectors: ["td.votelinks > form"],
          kind: "widget",
        },
        {
          slotName: "login-captcha",
          description: "登录页验证码图片",
          selectors: ["img.captcha"],
          kind: "captcha",
        },
      ],
      actions: [
        {
          actionId: "open-thread",
          description: "打开帖子详情",
          kind: "navigate",
          targetSelectors: ["td.title > span.titleline > a"],
        },
        {
          actionId: "search",
          description: "提交搜索",
          kind: "fill_and_submit",
          targetSelectors: ["input[name='q']"],
          submitSelectors: ["form > button"],
          paramSchema: { q: "string", page: "number", restrictBool: "boolean" },
        },
      ],
    },
    {
      routeId: "login",
      urlRegex: "^https://news\\.ycombinator\\.com/login",
      domFingerprintSelector: "form[action='/login']",
      archetype: "auth-portal",
      itemFields: [
        {
          fieldName: "goto",
          fieldType: "string",
          selectors: ["input[name='goto']"],
          attribute: "value",
          required: false,
        },
      ],
    },
  ],
  enableTurboNav: true,
  recommendedPowerUps: ["cmd-k-search", "dark-light-theme", "turbo-nav"],
};

const validDesignSpec = {
  siteId: "hacker-news",
  themeIdentity: {
    brandAccentHex: "#ff6600",
    darkBgHex: "#0a0a0a",
    lightBgHex: "#f6f6ef",
    aestheticStyle: "brutalist-terminal",
  },
  layoutStrategy: "主列表 + 右侧详情双栏，命令面板全局导航",
  keyEnhancements: ["零闪烁暗色主题", "vim 键盘导航", "评论线程折叠"],
  componentBlueprint: "<ReadingList /><ThreadPanel /><CommandPalette />",
};

const validVerificationReport = {
  siteId: "hacker-news",
  passed: true,
  repairRoundsUsed: 1,
  originalItemCount: 30,
  remasteredItemCount: 30,
  dataParityRatio: 1,
  vlmScore: 9.2,
  vlmFeedback: "布局逐项对齐，暗色主题对比度达标，全部交互可用。",
  gates: [
    { gateName: "data-parity", passed: true, score: 1, details: "30/30 条数据逐字段一致" },
    { gateName: "layout-fidelity", passed: true, score: 9.5, details: "VLM 布局评分达标" },
    { gateName: "interactive-parity", passed: true, score: 9, details: "登录 / 搜索 / 投票全部可用" },
    { gateName: "accessibility", passed: true, score: 8.7, details: "暗色主题文本对比度 ≥ 4.5:1" },
    { gateName: "performance", passed: true, score: 8.9, details: "首屏 < 1s，无长任务" },
    { gateName: "no-regression", passed: true, score: 9.1, details: "原站功能未受损" },
  ],
  extractorHealthSummary: {
    "tier1-css": { tier: 1, hits: 28, misses: 2 },
    "tier2-attr": { tier: 2, hits: 2, misses: 0 },
  },
  totalTokensUsed: 184320,
  verifiedAt: "2026-11-19T09:30:00.000+08:00",
};

const validSkinManifest = {
  id: "hn-terminal-dark",
  name: "HN Terminal Dark",
  category: "资讯阅读",
  targetUrl: "https://news.ycombinator.com/",
  matchPatterns: ["https://news.ycombinator.com/*"],
  archetype: "news-feed",
  tagline: { zh: "极客终端风暗色重制", en: "Brutalist terminal remake" },
  enhancements: ["零闪烁幕帘", "cmd-k 全局搜索", "vim 导航"],
  userscriptFile: "skins/hn-terminal-dark/index.user.js",
  beforeImage: "skins/hn-terminal-dark/before.png",
  afterImage: "skins/hn-terminal-dark/after.png",
  vlmScore: 9.1,
  dataParityRatio: 1,
  bundleSizeKb: 42.5,
  tokensUsedToCompile: 184320,
  version: "1.0.0",
};

const validStoreIndex = {
  version: "1.0.0",
  totalSkins: 1,
  totalTokensBurned: 184320,
  avgVlmScore: 9.1,
  skins: [validSkinManifest],
};

describe("SiteSnapshotSchema", () => {
  it("接受完整合法快照（sampleItemsHtml 3 条）", () => {
    const result = SiteSnapshotSchema.safeParse(validSnapshot);
    expect(result.success).toBe(true);
  });

  it("拒绝超过 16KB UTF-8 的 domSkeletonHtml", () => {
    const result = SiteSnapshotSchema.safeParse({
      ...validSnapshot,
      domSkeletonHtml: "x".repeat(16900),
    });
    expect(result.success).toBe(false);
  });

  it("拒绝 4 条 sampleItemsHtml", () => {
    const result = SiteSnapshotSchema.safeParse({
      ...validSnapshot,
      repeatedGroups: [
        {
          ...validSnapshot.repeatedGroups[0],
          sampleItemsHtml: ["<li>1</li>", "<li>2</li>", "<li>3</li>", "<li>4</li>"],
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe("SiteContractSchema", () => {
  it("接受含 2 条 route（其一带 portalSlots + actions + paramSchema）的完整合法合同", () => {
    const result = SiteContractSchema.safeParse(validContract);
    expect(result.success).toBe(true);
  });

  it("省略默认字段时填充 enableTurboNav=true 与 recommendedPowerUps=[]", () => {
    const minimal = {
      siteId: validContract.siteId,
      siteName: validContract.siteName,
      matchPatterns: validContract.matchPatterns,
      routes: validContract.routes,
    };
    const result = SiteContractSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enableTurboNav).toBe(true);
      expect(result.data.recommendedPowerUps).toEqual([]);
    }
  });

  it("拒绝含大写字母的 siteId", () => {
    const result = SiteContractSchema.safeParse({
      ...validContract,
      siteId: "HackerNews",
    });
    expect(result.success).toBe(false);
  });
});

describe("UXDesignSpecSchema", () => {
  it("接受完整合法设计规格", () => {
    const result = UXDesignSpecSchema.safeParse(validDesignSpec);
    expect(result.success).toBe(true);
  });

  it("拒绝非法 brandAccentHex #xyz123", () => {
    const result = UXDesignSpecSchema.safeParse({
      ...validDesignSpec,
      themeIdentity: { ...validDesignSpec.themeIdentity, brandAccentHex: "#xyz123" },
    });
    expect(result.success).toBe(false);
  });
});

describe("VerificationReportSchema", () => {
  it("接受完整合法验证报告", () => {
    const result = VerificationReportSchema.safeParse(validVerificationReport);
    expect(result.success).toBe(true);
  });

  it("拒绝只有 5 条 gates", () => {
    const result = VerificationReportSchema.safeParse({
      ...validVerificationReport,
      gates: validVerificationReport.gates.slice(0, 5),
    });
    expect(result.success).toBe(false);
  });

  it("拒绝 vlmScore=11", () => {
    const result = VerificationReportSchema.safeParse({
      ...validVerificationReport,
      vlmScore: 11,
    });
    expect(result.success).toBe(false);
  });
});

describe("SkinManifestSchema", () => {
  it("接受完整合法皮肤清单", () => {
    const result = SkinManifestSchema.safeParse(validSkinManifest);
    expect(result.success).toBe(true);
  });

  it("拒绝缺少 en 的 tagline", () => {
    const result = SkinManifestSchema.safeParse({
      ...validSkinManifest,
      tagline: { zh: "只有中文" },
    });
    expect(result.success).toBe(false);
  });
});

describe("StoreIndexSchema", () => {
  it("接受完整合法商店索引", () => {
    const result = StoreIndexSchema.safeParse(validStoreIndex);
    expect(result.success).toBe(true);
  });

  it("拒绝 version=1.2", () => {
    const result = StoreIndexSchema.safeParse({
      ...validStoreIndex,
      version: "1.2",
    });
    expect(result.success).toBe(false);
  });
});
