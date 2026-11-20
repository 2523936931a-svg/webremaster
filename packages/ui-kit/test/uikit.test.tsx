import { describe, expect, it } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import {
  themeVarsFor,
  themeVars,
  THEME_CSS,
  THEME_MONO_FONT,
  THEME_PALETTES,
  FeedListCard,
  SmartDataTable,
  DiagnosticsDrawer,
  type DiagnosticsSnapshot,
} from "../src/index.js";


describe("@webremaster/ui-kit", () => {
  describe("theme", () => {
    it("themeVarsFor 返回符合预期的浅色与深色字面色板", () => {
      const dark = themeVarsFor("dark");
      expect(dark.bg).toBe("#0b0f17");
      expect(dark.accent).toBe("#6ea8fe");

      const light = themeVarsFor("light");
      expect(light.bg).toBe("#f5f6f8");
      expect(light.accent).toBe("#2f6cd8");
    });

    it("themeVars 返回带 var(--wr-*, fallback) 的 CSS 变量引用", () => {
      const vars = themeVars("dark");
      expect(vars.bg).toContain("var(--wr-bg,");
      expect(vars.text).toContain("var(--wr-text,");
      expect(vars.accent).toContain("var(--wr-accent,");
    });

    it("THEME_CSS 包含 :host 默认样式与 [data-wr-theme] 作用域", () => {
      expect(THEME_CSS).toContain(":host");
      expect(THEME_CSS).toContain('[data-wr-theme="light"]');
      expect(THEME_CSS).toContain('[data-wr-theme="dark"]');
      expect(THEME_CSS).toContain(".wr-prose");
    });

    it("THEME_MONO_FONT 包含常用等宽字体族", () => {
      expect(THEME_MONO_FONT).toContain("monospace");
    });

    it("THEME_PALETTES 包含高星社区预设（Catppuccin、Tokyo Night、Nord、羊皮纸）且注入 THEME_CSS", () => {
      expect(THEME_PALETTES["catppuccin-mocha"].bg).toBe("#1e1e2e");
      expect(THEME_PALETTES["tokyo-night"].accent).toBe("#7aa2f7");
      expect(THEME_PALETTES["nord"].bg).toBe("#2e3440");
      expect(THEME_PALETTES["sepia-book"].bg).toBe("#fbf0d9");

      expect(THEME_CSS).toContain('data-wr-palette="catppuccin-mocha"');
      expect(THEME_CSS).toContain('data-wr-palette="tokyo-night"');
      expect(THEME_CSS).toContain('data-wr-palette="nord"');
      expect(THEME_CSS).toContain('data-wr-palette="sepia-book"');
    });
  });


  describe("FeedListCard", () => {
    it("渲染条目标题、来源域名、得分与评论数", () => {
      const item = {
        id: "1",
        title: "WebRemaster 编译器正式发布",
        url: "https://news.ycombinator.com/item?id=1",
        domain: "ycombinator.com",
        author: "dang",
        publishedAt: "2小时前",
        score: 342,
        commentCount: 88,
        tags: ["Release", "React"],
      };

      const html = renderToString(
        <FeedListCard item={item} index={0} selected={true} />
      );

      expect(html).toContain("WebRemaster 编译器正式发布");
      expect(html).toContain("ycombinator.com");
      expect(html).toContain("dang");
      expect(html).toContain("342");
      expect(html).toContain("88");
      expect(html).toContain('data-wr-selected="true"');
      expect(html).toContain("Release");
    });

    it("紧凑模式下隐藏标签但保留核心元数据", () => {
      const item = {
        id: "2",
        title: "纯文本资讯",
        score: 10,
        tags: ["HiddenTag"],
      };

      const html = renderToString(
        <FeedListCard item={item} compact={true} />
      );

      expect(html).toContain("纯文本资讯");
      expect(html).not.toContain("HiddenTag");
    });
  });

  describe("SmartDataTable", () => {
    it("渲染表格列与数据行", () => {
      const columns = [
        { key: "id", header: "序号", value: (r: { id: number; title: string }) => r.id },
        { key: "title", header: "标题", value: (r: { id: number; title: string }) => r.title },
      ];
      const rows = [
        { id: 1, title: "文章 A" },
        { id: 2, title: "文章 B" },
      ];

      const html = renderToString(
        <SmartDataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => String(r.id)}
        />
      );

      expect(html).toContain("序号");
      expect(html).toContain("标题");
      expect(html).toContain("文章 A");
      expect(html).toContain("文章 B");
    });

    it("空数据时渲染优雅的兜底空状态", () => {
      const columns = [{ key: "name", header: "名称" }];
      const html = renderToString(
        <SmartDataTable
          columns={columns}
          rows={[]}
          rowKey={(_, idx) => String(idx)}
          emptyMessage="暂无匹配数据"
        />
      );

      expect(html).toContain("暂无匹配数据");
    });
  });

  describe("DiagnosticsDrawer", () => {
    it("渲染诊断抽屉字段遥测与命中率汇总", () => {
      const snapshot: DiagnosticsSnapshot = {
        siteId: "hackernews",
        fields: {
          title: { tier: 1, hits: 30, misses: 0 },
          score: { tier: 2, hits: 29, misses: 1 },
        },
        summary: {
          totalFields: 2,
          healthyFields: 2,
          hitRate: 0.98,
          tierBreakdown: { "1": 1, "2": 1, "3": 0, "4": 0 },
        },
      };

      const html = renderToString(
        <DiagnosticsDrawer
          open={true}
          onClose={() => {}}
          snapshot={snapshot}
        />
      );

      expect(html).toContain("字段命中率");
      expect(html).toContain("健康字段");
      expect(html).toContain("hackernews");
      expect(html).toContain("title");
      expect(html).toContain("score");
      expect(html).toContain("98%");
    });
  });
});
