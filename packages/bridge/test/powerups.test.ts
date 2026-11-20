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
