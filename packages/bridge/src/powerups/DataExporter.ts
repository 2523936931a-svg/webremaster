/**
 * DataExporter PowerUp —— 把重制版界面中的结构化数据一键导出为 CSV / Markdown 表格。
 *
 * 纯函数组装文本 + 极简 DOM 下载触发器；bridge 包零依赖，且在 JSDOM 等
 * 无 Blob URL 能力的环境下安全降级（downloadTextFile 直接跳过）。
 */

/** CSV 单元格转义：null/undefined → 空串；含 , " \r \n 的字符串用双引号包裹并把内部 " 加倍。
 * 可选开启 preventFormulaInjection 防范 Excel 宏/公式注入。
 */
export function csvEscapeCell(value: unknown, preventFormulaInjection?: boolean): string {
  if (value === null || value === undefined) {
    return "";
  }
  let str = typeof value === "string" ? value : String(value);
  if (preventFormulaInjection && /^[=+\-@\t\r]/.test(str)) {
    str = "'" + str;
  }
  if (/["\r\n,]/.test(str)) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/** 组装 CSV 文本（不含 BOM）：单元格逗号连接，行之间 CRLF 连接。 */
export function buildCsvText(rows: unknown[][], preventFormulaInjection?: boolean): string {
  return rows.map((row) => row.map((c) => csvEscapeCell(c, preventFormulaInjection)).join(",")).join("\r\n");
}

/** 导出为 CSV 文件：前置 UTF-8 BOM（\uFEFF）防止 Windows Excel 打开中文乱码；返回导出文本。 */
export function exportToCSV(rows: unknown[][], filename?: string, preventFormulaInjection?: boolean): string {
  const text = "\uFEFF" + buildCsvText(rows, preventFormulaInjection);
  downloadTextFile(text, filename ?? "webremaster-export.csv", "text/csv;charset=utf-8");
  return text;
}

/** TSV 单元格转义：制表符与换行转为空格，null/undefined 转为空串。 */
export function tsvEscapeCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  const str = typeof value === "string" ? value : String(value);
  return str.replace(/[\t\r\n]/g, " ");
}

/** 组装 TSV 文本（不含 BOM）：单元格 Tab 分隔，行之间 CRLF 连接。 */
export function buildTsvText(rows: unknown[][]): string {
  return rows.map((row) => row.map(tsvEscapeCell).join("\t")).join("\r\n");
}

/** 导出为 TSV 文件：前置 UTF-8 BOM，方便直接粘贴或由 Excel 打开。 */
export function exportToTSV(rows: unknown[][], filename?: string): string {
  const text = "\uFEFF" + buildTsvText(rows);
  downloadTextFile(text, filename ?? "webremaster-export.tsv", "text/tab-separated-values;charset=utf-8");
  return text;
}

/** 导出为结构化 JSON 文件；返回格式化后的 JSON 字符串。 */
export function exportToJSON(data: unknown, filename?: string): string {
  const text = JSON.stringify(data, null, 2);
  downloadTextFile(text, filename ?? "webremaster-export.json", "application/json;charset=utf-8");
  return text;
}

/** Markdown 单元格：null/undefined 视为空串，| 转义为 \|，换行替换为 <br>。 */
function markdownEscapeCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return text.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

/** 组装 GFM 表格：首行为表头 + | --- | 分隔行；列数按最长行对齐，短行补空单元格；rows 为空返回 ""。 */
export function buildMarkdownTable(rows: unknown[][]): string {
  if (rows.length === 0) {
    return "";
  }
  let columnCount = 0;
  for (const row of rows) {
    if (row.length > columnCount) {
      columnCount = row.length;
    }
  }
  const renderRow = (row: unknown[]): string => {
    const cells: string[] = [];
    for (let i = 0; i < columnCount; i++) {
      cells.push(markdownEscapeCell(row[i]));
    }
    return "| " + cells.join(" | ") + " |";
  };
  const separatorCells: string[] = [];
  for (let i = 0; i < columnCount; i++) {
    separatorCells.push("---");
  }
  const lines: string[] = [renderRow(rows[0]), "| " + separatorCells.join(" | ") + " |"];
  for (let i = 1; i < rows.length; i++) {
    lines.push(renderRow(rows[i]));
  }
  return lines.join("\n");
}

/** 导出为 Markdown 表格文件；返回导出文本（无 BOM）。 */
export function exportToMarkdownTable(rows: unknown[][], filename?: string): string {
  const text = buildMarkdownTable(rows);
  downloadTextFile(text, filename ?? "webremaster-export.md", "text/markdown;charset=utf-8");
  return text;
}

/**
 * 触发浏览器下载：Blob + createObjectURL + <a download> 点击。
 * 无 document 或无 URL.createObjectURL（如 JSDOM）时直接返回，保证测试环境零副作用。
 */
export function downloadTextFile(text: string, filename: string, mime: string): void {
  if (typeof document === "undefined") {
    return;
  }
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    return;
  }
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body?.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* revoke 失败不影响已触发的下载 */
    }
  }, 1000);
}
