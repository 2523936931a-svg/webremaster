/**
 * ReaderMode PowerUp —— 沉浸式阅读器与文章提取引擎（借鉴 Mozilla Readability / Safari Reader / Readwise）。
 *
 * 针对文档、博客、新闻、学术论文等古老页面（如 Linux Kernel Lore、SQLite Docs、RFC、PyPI）：
 * 1. 结构化抽取标题、正文段落、代码块与元数据；
 * 2. 计算阅读时间（WPM 算法，中英文混合支持）；
 * 3. 管理阅读器个性化排版配置（字号缩放、衬线/无衬线切换、护眼羊皮纸模式）。
 */

export interface ExtractedArticle {
  title: string;
  byline?: string;
  publishedAt?: string;
  wordCount: number;
  readingTimeMinutes: number;
  paragraphs: string[];
  excerpt: string;
}

export type ReaderTheme = "system" | "light" | "sepia" | "dark" | "oled";
export type ReaderFontFamily = "sans" | "serif" | "mono";

export interface ReaderSettings {
  fontSize: number; // 默认 16px (14 ~ 24)
  lineHeight: number; // 默认 1.7 (1.4 ~ 2.2)
  fontFamily: ReaderFontFamily;
  theme: ReaderTheme;
  maxWidth: number; // 默认 720px
}

const SETTINGS_STORAGE_KEY = "webremaster_reader_settings";

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  fontSize: 18,
  lineHeight: 1.8,
  fontFamily: "sans",
  theme: "system",
  maxWidth: 720,
};

/**
 * 计算文本字数与预估阅读时间（中文按单字计，西文按空格分词；平均 300 字/分钟）
 */
export function calculateReadingStats(text: string): { wordCount: number; readingTimeMinutes: number } {
  if (!text || text.trim().length === 0) {
    return { wordCount: 0, readingTimeMinutes: 0 };
  }
  const clean = text.trim();
  // 匹配所有中文字符
  const cjkMatches = clean.match(/[\u4e00-\u9fa5]/g);
  const cjkCount = cjkMatches ? cjkMatches.length : 0;

  // 匹配西文字词
  const nonCjk = clean.replace(/[\u4e00-\u9fa5]/g, " ");
  const latinWords = nonCjk.split(/\s+/).filter((w) => w.length > 0);
  const latinCount = latinWords.length;

  const wordCount = cjkCount + latinCount;
  const readingTimeMinutes = Math.max(1, Math.ceil(wordCount / 300));
  return { wordCount, readingTimeMinutes };
}

/**
 * 从指定 DOM 根容器或当前页面提取结构化文章内容
 */
export function extractArticle(container?: HTMLElement | null): ExtractedArticle {
  const root = container ?? (typeof document !== "undefined" ? document.body : null);
  if (!root) {
    return {
      title: "未命名文档",
      wordCount: 0,
      readingTimeMinutes: 0,
      paragraphs: [],
      excerpt: "",
    };
  }

  // 1. 尝试提取标题
  const headingEl = root.querySelector("h1, h2, .article-title, .entry-title");
  const title = headingEl?.textContent?.trim() || (typeof document !== "undefined" ? document.title : "未命名文档");

  // 2. 尝试提取作者/时间
  const authorEl = root.querySelector(".byline, .author, .author-name, rel[author]");
  const byline = authorEl?.textContent?.trim() || undefined;

  // 3. 提取所有段落与代码块文本
  const contentNodes = Array.from(root.querySelectorAll("p, blockquote, pre"));
  const paragraphs: string[] = [];

  for (const node of contentNodes) {
    // 过滤掉导航栏、侧边栏、版权脚标或隐藏元素
    if (node.closest("nav, header, footer, .sidebar, [aria-hidden='true']")) {
      continue;
    }
    const text = node.textContent?.trim();
    if (text && text.length > 15) {
      // 避免误收单个标点或导航小字
      paragraphs.push(text);
    }
  }

  const fullText = paragraphs.join("\n\n");
  const stats = calculateReadingStats(fullText);
  const excerpt = paragraphs.length > 0 ? paragraphs[0].slice(0, 160) + (paragraphs[0].length > 160 ? "..." : "") : "";

  return {
    title,
    byline,
    wordCount: stats.wordCount,
    readingTimeMinutes: stats.readingTimeMinutes,
    paragraphs,
    excerpt,
  };
}

/**
 * 读取用户本地阅读器排版配置
 */
export function getReaderSettings(): ReaderSettings {
  if (typeof window === "undefined" || !window.localStorage) {
    return { ...DEFAULT_READER_SETTINGS };
  }
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_READER_SETTINGS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_READER_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_READER_SETTINGS };
  }
}

/**
 * 保存用户本地阅读器排版配置
 */
export function saveReaderSettings(settings: Partial<ReaderSettings>): ReaderSettings {
  const current = getReaderSettings();
  const next: ReaderSettings = {
    ...current,
    ...settings,
    fontSize: Math.min(28, Math.max(12, settings.fontSize ?? current.fontSize)),
    lineHeight: Math.min(2.5, Math.max(1.2, settings.lineHeight ?? current.lineHeight)),
  };
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore storage failure */
    }
  }
  return next;
}
