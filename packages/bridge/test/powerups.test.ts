/**
 * Step 1 硬性验收④：CSV 导出带 UTF-8 BOM 且正确转义；Markdown 表格与模糊匹配。
 */
import { describe, expect, it } from "vitest";
import {
  buildCsvText,
  buildMarkdownTable,
  buildTsvText,
  csvEscapeCell,
  exportToCSV,
  exportToJSON,
  exportToMarkdownTable,
  exportToTSV,
} from "../src/powerups/DataExporter.js";
import { fuzzyMatch } from "../src/powerups/CommandPalette.js";
import {
  getBookmarks,
  saveBookmark,
  removeBookmark,
  isBookmarked,
  toggleBookmark,
  exportBookmarksToMarkdown,
} from "../src/powerups/BookmarkManager.js";
import {
  calculateReadingStats,
  extractArticle,
  getReaderSettings,
  saveReaderSettings,
} from "../src/powerups/ReaderMode.js";
import { cleanDistractions } from "../src/powerups/ContentCleaner.js";
import {
  heuristicSummarize,
  summarizeText,
  getAIConfig,
  saveAIConfig,
} from "../src/powerups/AISummarizer.js";
import { enhanceCodeBlocks } from "../src/powerups/CodeBlockEnhancer.js";
import {
  PluginHost,
  definePowerUp,
  getSharedPluginHost,
} from "../src/powerups/pluginHost.js";
import {
  computeResilientSelector,
  getZappedSelectors,
  saveZappedSelector,
  resetZappedSelectors,
  applyZappedSelectors,
  toggleElementZapper,
  stopElementZapper,
} from "../src/powerups/ElementZapper.js";



describe("DataExporter", () => {
  it("csvEscapeCell：逗号/引号/换行正确转义", () => {
    expect(csvEscapeCell("plain")).toBe("plain");
    expect(csvEscapeCell("a,b")).toBe('"a,b"');
    expect(csvEscapeCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscapeCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvEscapeCell("line1\r\nline2")).toBe('"line1\r\nline2"');
    expect(csvEscapeCell(42)).toBe("42");
    expect(csvEscapeCell(true)).toBe("true");
    expect(csvEscapeCell(null)).toBe("");
    expect(csvEscapeCell(undefined)).toBe("");
  });

  it("buildCsvText：单元格逗号连接、行间 CRLF", () => {
    const text = buildCsvText([
      ["名字", "分数"],
      ["小明", "42"],
      ["含,逗号", '含"引号"'],
    ]);
    expect(text).toBe('名字,分数\r\n小明,42\r\n"含,逗号","含""引号"""');
  });

  it("验收④：exportToCSV 带 UTF-8 BOM（\\uFEFF）防 Windows Excel 中文乱码", () => {
    const text = exportToCSV([["标题", "链接"], ["你好", "https://example.com"]], "test.csv");
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text.slice(1)).toBe(buildCsvText([["标题", "链接"], ["你好", "https://example.com"]]));
    // JSDOM 无 createObjectURL：downloadTextFile 安全跳过，无副作用
  });

  it("buildMarkdownTable：表头 + 分隔行 + 竖线转义 + 短行补齐 + 空表", () => {
    expect(
      buildMarkdownTable([
        ["A", "B"],
        ["x|y", "1"],
      ]),
    ).toBe("| A | B |\n| --- | --- |\n| x\\|y | 1 |");
    expect(buildMarkdownTable([["A", "B"], ["x"]])).toBe("| A | B |\n| --- | --- |\n| x |  |");
    expect(buildMarkdownTable([])).toBe("");
  });

  it("exportToMarkdownTable 返回文本且不带 BOM", () => {
    const text = exportToMarkdownTable([["h"], ["v"]], "out.md");
    expect(text).toBe("| h |\n| --- |\n| v |");
    expect(text.charCodeAt(0)).not.toBe(0xfeff);
  });

  it("防范公式注入（Formula Injection）：针对 = + - @ 等恶意前缀转义", () => {
    expect(csvEscapeCell("=cmd|' /C calc'!A0", true)).toBe("'=cmd|' /C calc'!A0");
    expect(csvEscapeCell("=1+1,eval", true)).toBe("\"'=1+1,eval\"");
    expect(csvEscapeCell("+1234", true)).toBe("'+1234");
    expect(csvEscapeCell("-5678", true)).toBe("'-5678");
    expect(csvEscapeCell("@admin", true)).toBe("'@admin");
  });

  it("exportToJSON：结构化数据正确序列化为格式化 JSON 字符串", () => {
    const data = { title: "WebRemaster", stars: 1200 };
    const json = exportToJSON(data, "test.json");
    expect(JSON.parse(json)).toEqual(data);
  });

  it("buildTsvText & exportToTSV：制表符分隔且带 UTF-8 BOM", () => {
    const rows = [
      ["标题", "分类\t含tab", "分数"],
      ["Hacker News", "开发者", 100],
    ];
    const tsv = buildTsvText(rows);
    expect(tsv).toBe("标题\t分类 含tab\t分数\r\nHacker News\t开发者\t100");
    const exported = exportToTSV(rows, "test.tsv");
    expect(exported.charCodeAt(0)).toBe(0xfeff);
    expect(exported.slice(1)).toBe(tsv);
  });
});

describe("fuzzyMatch", () => {
  it("空 query 恒匹配且 score 为 0", () => {
    expect(fuzzyMatch("", "anything")).toEqual({ matched: true, score: 0 });
  });

  it("子序列匹配与不匹配", () => {
    expect(fuzzyMatch("hn", "Hacker News").matched).toBe(true);
    expect(fuzzyMatch("hnews", "Hacker News").matched).toBe(true);
    expect(fuzzyMatch("xyz", "Hacker News").matched).toBe(false);
    expect(fuzzyMatch("CSV", "导出 CSV 数据").matched).toBe(true);
  });

  it("连续命中得分高于跳跃命中", () => {
    const tight = fuzzyMatch("data", "data-export");
    const loose = fuzzyMatch("data", "d_a_t_a-export");
    expect(tight.matched).toBe(true);
    expect(loose.matched).toBe(true);
    expect(tight.score).toBeGreaterThan(loose.score);
  });
});

describe("BookmarkManager", () => {
  it("本地书签增删查与切换：零依赖且按保存时间倒序排列", () => {
    localStorage.clear();
    expect(getBookmarks()).toEqual([]);
    expect(isBookmarked("item-1")).toBe(false);

    // 保存第 1 个
    saveBookmark({ id: "item-1", title: "Hacker News 首发", url: "https://news.ycombinator.com" });
    expect(isBookmarked("item-1")).toBe(true);
    expect(getBookmarks().length).toBe(1);

    // 保存第 2 个
    saveBookmark({ id: "item-2", title: "SQLite 文档重制", category: "文档" });
    const list = getBookmarks();
    expect(list.length).toBe(2);
    expect(list[0].id).toBe("item-2"); // 最新置前

    // 切换 toggle
    const toggledOff = toggleBookmark({ id: "item-1", title: "Hacker News 首发" });
    expect(toggledOff).toBe(false);
    expect(isBookmarked("item-1")).toBe(false);

    const toggledOn = toggleBookmark({ id: "item-1", title: "Hacker News 首发" });
    expect(toggledOn).toBe(true);
    expect(isBookmarked("item-1")).toBe(true);

    // 移除单个
    removeBookmark("item-2");
    expect(getBookmarks().length).toBe(1);
    expect(getBookmarks()[0].id).toBe("item-1");
  });

  it("exportBookmarksToMarkdown：空列表与非空列表生成标准 Markdown 稍后阅读文档", () => {
    localStorage.clear();
    expect(exportBookmarksToMarkdown()).toContain("暂无收藏内容");

    saveBookmark({
      id: "item-1",
      title: "Antigravity 架构解析",
      url: "https://example.com/arch",
      domain: "example.com",
      category: "架构",
    });

    const md = exportBookmarksToMarkdown();
    expect(md).toContain("# 我的 WebRemaster 收藏夹");
    expect(md).toContain("[Antigravity 架构解析](https://example.com/arch)");
    expect(md).toContain("example.com");
  });
});

describe("ReaderMode", () => {
  it("calculateReadingStats：准确统计中英文混合字数与预估阅读分钟数", () => {
    expect(calculateReadingStats("").wordCount).toBe(0);
    expect(calculateReadingStats("   ").wordCount).toBe(0);

    const enStats = calculateReadingStats("WebRemaster modernizes ancient web pages with shadow DOM.");
    expect(enStats.wordCount).toBe(8);
    expect(enStats.readingTimeMinutes).toBe(1);

    const zhStats = calculateReadingStats("把老旧古董网站重制为现代化响应式页面。");
    expect(zhStats.wordCount).toBe(19);
    expect(zhStats.readingTimeMinutes).toBe(1);

    // 较长篇幅 (600 字约 2 分钟)
    const longText = "测试文本".repeat(150);
    expect(calculateReadingStats(longText).readingTimeMinutes).toBe(2);
  });

  it("extractArticle：从混乱 DOM 中提取结构化文章、排除导航噪点", () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <header><nav>Home About Contact</nav></header>
      <h1 class="article-title">SQLite Architecture Guide</h1>
      <div class="byline">Dr. Richard Hipp</div>
      <div class="sidebar">Ads and promotions</div>
      <p>SQLite is a C-language library that implements a small, fast, self-contained, high-reliability SQL database engine.</p>
      <p>The code for SQLite is in the public domain and is free to everyone to use for any purpose.</p>
      <footer>Copyright 2026</footer>
    `;

    const article = extractArticle(container);
    expect(article.title).toBe("SQLite Architecture Guide");
    expect(article.byline).toBe("Dr. Richard Hipp");
    expect(article.paragraphs.length).toBe(2);
    expect(article.paragraphs[0]).toContain("SQLite is a C-language library");
    expect(article.wordCount).toBeGreaterThan(20);
    expect(article.excerpt).toContain("SQLite is a C-language library");
  });

  it("ReaderSettings：配置存取与字号行高安全限幅（12~28px / 1.2~2.5）", () => {
    localStorage.clear();
    const initial = getReaderSettings();
    expect(initial.fontSize).toBe(18);
    expect(initial.theme).toBe("system");

    // 保存安全范围内设置
    const saved = saveReaderSettings({ fontSize: 22, theme: "sepia", fontFamily: "serif" });
    expect(saved.fontSize).toBe(22);
    expect(saved.theme).toBe("sepia");
    expect(saved.fontFamily).toBe("serif");

    // 超限安全夹紧
    const clampedMax = saveReaderSettings({ fontSize: 999, lineHeight: 99 });
    expect(clampedMax.fontSize).toBe(28);
    expect(clampedMax.lineHeight).toBe(2.5);

    const clampedMin = saveReaderSettings({ fontSize: 2, lineHeight: 0.1 });
    expect(clampedMin.fontSize).toBe(12);
    expect(clampedMin.lineHeight).toBe(1.2);
  });
});

describe("ContentCleaner", () => {
  it("cleanDistractions：移除 Cookie 授权横幅、恢复被锁死的页面滚动", () => {
    document.body.innerHTML = `
      <div id="onetrust-consent-sdk">Cookie Consent Required</div>
      <div class="cookie-banner">Accept all cookies</div>
      <div class="modal-backdrop">Modal overlay</div>
      <div class="main-content">Real article content</div>
    `;

    document.body.style.overflow = "hidden";
    expect(document.querySelector("#onetrust-consent-sdk")).not.toBeNull();
    expect(document.querySelector(".cookie-banner")).not.toBeNull();

    const result = cleanDistractions(document);
    expect(result.removedCount).toBe(3);
    expect(result.overflowRestored).toBe(true);

    // 验证已被移除
    expect(document.querySelector("#onetrust-consent-sdk")).toBeNull();
    expect(document.querySelector(".cookie-banner")).toBeNull();
    expect(document.querySelector(".modal-backdrop")).toBeNull();
    expect(document.querySelector(".main-content")).not.toBeNull();
  });
});

describe("AISummarizer", () => {
  it("heuristicSummarize：空文本与有效长文均可稳定提取结构化摘要且不抛错", () => {
    const empty = heuristicSummarize("");
    expect(empty.tldr[0]).toContain("无法提取概要");
    expect(empty.modelUsed).toBe("heuristic-offline");

    const articleText =
      "WebRemaster 是一套革命性的全网老旧丑网站现代化重制引擎。采用 Shadow DOM 与 React 19 构建纯净沙箱。" +
      "通过活体传送门机制将原站复杂控件原样嵌入新界面。支持零闪烁揭幕和多模式双路由无缝切换。";
    const result = heuristicSummarize(articleText, 2);
    expect(result.tldr.length).toBeGreaterThanOrEqual(1);
    expect(result.keyTakeaways.length).toBeGreaterThan(0);
    expect(result.modelUsed).toBe("heuristic-offline");
  });

  it("AI 配置存取与离线降级", async () => {
    localStorage.clear();
    const config = getAIConfig();
    expect(config.provider).toBe("openai");

    saveAIConfig({ provider: "deepseek", apiKey: "sk-test" });
    const updated = getAIConfig();
    expect(updated.provider).toBe("deepseek");
    expect(updated.apiKey).toBe("sk-test");

    // 未能请求外部网络时优雅自动降级到离线算法
    const res = await summarizeText("较短内容");
    expect(res.modelUsed).toBe("heuristic-offline");
  });
});

describe("CodeBlockEnhancer", () => {
  it("enhanceCodeBlocks：自动为页面代码块挂载现代化复制按钮且幂等运行", () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <pre><code>SELECT * FROM users WHERE active = 1;</code></pre>
      <pre><code>git rebase -i HEAD~3</code></pre>
    `;

    const res1 = enhanceCodeBlocks(container);
    expect(res1.enhancedCount).toBe(2);
    expect(container.querySelectorAll(".wr-code-copy-btn").length).toBe(2);

    // 二次运行幂等
    const res2 = enhanceCodeBlocks(container);
    expect(res2.enhancedCount).toBe(0);
    expect(container.querySelectorAll(".wr-code-copy-btn").length).toBe(2);
  });
});

describe("PluginHost", () => {
  it("注册插件、触发生命周期并执行优雅清理", () => {
    const host = new PluginHost({ url: "https://news.ycombinator.com/" });
    let initCalled = false;
    let cleanupCalled = false;
    let mountRootReceived: ShadowRoot | null = null;
    let navigatedUrl = "";

    const testPlugin = definePowerUp({
      id: "test-plugin",
      name: "Test Plugin",
      onInit: () => {
        initCalled = true;
        return () => {
          cleanupCalled = true;
        };
      },
      onMount: (root) => {
        mountRootReceived = root;
      },
      onNavigate: (url) => {
        navigatedUrl = url;
      },
    });

    host.register(testPlugin);
    expect(initCalled).toBe(true);
    expect(host.getPlugin("test-plugin")).toBe(testPlugin);

    // Mock ShadowRoot
    const mockHost = document.createElement("div");
    const shadowRoot = mockHost.attachShadow({ mode: "open" });
    host.triggerMount(shadowRoot);
    expect(mountRootReceived).toBe(shadowRoot);

    host.triggerNavigate("https://news.ycombinator.com/item?id=123");
    expect(navigatedUrl).toBe("https://news.ycombinator.com/item?id=123");

    host.unregister("test-plugin");
    expect(cleanupCalled).toBe(true);
    expect(host.getPlugin("test-plugin")).toBeUndefined();
  });

  it("teardown 全量卸载清理所有已注册插件", () => {
    const host = new PluginHost();
    let unmountedCount = 0;

    host.register({
      id: "p1",
      name: "P1",
      onUnmount: () => {
        unmountedCount++;
      },
    });
    host.register({
      id: "p2",
      name: "P2",
      onUnmount: () => {
        unmountedCount++;
      },
    });

    expect(host.listPlugins().length).toBe(2);
    host.teardown();
    expect(unmountedCount).toBe(2);
    expect(host.listPlugins().length).toBe(0);
  });

  it("getSharedPluginHost 返回全局单例", () => {
    const instance1 = getSharedPluginHost();
    const instance2 = getSharedPluginHost();
    expect(instance1).toBe(instance2);
  });
});

describe("ElementZapper (Arc Boosts Zap 元素粉碎枪)", () => {
  it("computeResilientSelector：优先推导 id 选择器、类选择器或层级选择器", () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <div id="banner-ad">Ad 1</div>
      <div class="sidebar-promo">Promo 1</div>
      <section>
        <p>Paragraph 1</p>
        <p>Paragraph 2</p>
      </section>
    `;
    document.body.appendChild(container);

    const banner = container.querySelector("#banner-ad")!;
    expect(computeResilientSelector(banner)).toBe("#banner-ad");

    const promo = container.querySelector(".sidebar-promo")!;
    expect(computeResilientSelector(promo)).toContain("sidebar-promo");

    const p2 = container.querySelectorAll("p")[1]!;
    expect(computeResilientSelector(p2)).toContain("nth-child(2)");
  });

  it("saveZappedSelector 与 getZappedSelectors：持久化存储并去重", () => {
    resetZappedSelectors();
    expect(getZappedSelectors()).toEqual([]);

    saveZappedSelector("#annoying-popup");
    saveZappedSelector("#annoying-popup"); // 重复
    saveZappedSelector(".floating-widget");

    const list = getZappedSelectors();
    expect(list.length).toBe(2);
    expect(list).toContain("#annoying-popup");
    expect(list).toContain(".floating-widget");
  });

  it("applyZappedSelectors 与 resetZappedSelectors：注入隐藏样式与一键复原", () => {
    resetZappedSelectors();
    saveZappedSelector("#bad-element");
    applyZappedSelectors();

    const styleEl = document.getElementById("wr-zapper-styles");
    expect(styleEl).not.toBeNull();
    expect(styleEl?.textContent).toContain("#bad-element { display: none !important; }");

    resetZappedSelectors();
    expect(document.getElementById("wr-zapper-styles")).toBeNull();
    expect(getZappedSelectors()).toEqual([]);
  });

  it("toggleElementZapper：启停粉碎模式状态", () => {
    const started = toggleElementZapper();
    expect(started).toBe(true);

    const stopped = toggleElementZapper();
    expect(stopped).toBe(false);
    stopElementZapper();
  });
});





