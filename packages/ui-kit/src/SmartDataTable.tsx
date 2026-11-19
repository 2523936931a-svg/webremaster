/**
 * SmartDataTable —— 数据门户（data-table-portal 原型）智能表格。
 *
 * 内置筛选（任意列包含匹配）、点击表头排序（升/降切换）、CSV / Markdown 一键导出
 * （复用 bridge PowerUps：UTF-8 BOM CSV，Excel 中文不乱码）。泛型行模型，
 * 排序 / 筛选 / 导出统一走 column.value 提供的原始值；render 仅负责展示。
 */
import { useMemo, useState, type ReactElement, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Download, FileText, Search } from "lucide-react";
import { exportToCSV, exportToMarkdownTable } from "@webremaster/bridge";
import { useThemeVars } from "./theme.js";

/** 单元格原始值类型（value 函数的返回值，排序 / 筛选 / 导出共用）。 */
export type CellValue = string | number | boolean | null | undefined;

export type SortDirection = "asc" | "desc";

export interface SmartDataTableColumn<T> {
  key: string;
  header: string;
  align?: "left" | "center" | "right";
  width?: string | number;
  /** 原始值取值函数：排序 / 筛选 / 导出的事实来源；缺省则该列不可排序且按空串展示。 */
  value?: (row: T) => CellValue;
  /** 自定义单元格渲染；缺省展示 value 的格式化文本。 */
  render?: (row: T, index: number) => ReactNode;
  /** 缺省规则：提供 value 即可排序，显式 false 关闭。 */
  sortable?: boolean;
}

export interface SmartDataTableProps<T> {
  columns: ReadonlyArray<SmartDataTableColumn<T>>;
  rows: ReadonlyArray<T>;
  rowKey: (row: T, index: number) => string;
  filterable?: boolean;
  filterPlaceholder?: string;
  exportable?: boolean;
  /** 导出文件名主干，缺省 webremaster-export（自动补 .csv / .md 后缀）。 */
  exportBaseName?: string;
  initialSort?: { key: string; direction: SortDirection };
  onRowClick?: (row: T, index: number) => void;
  emptyMessage?: string;
}

interface SortState {
  key: string | null;
  direction: SortDirection;
}

const ALIGN_CLASS: Record<"left" | "center" | "right", string> = {
  left: "px-3 py-2 text-left",
  center: "px-3 py-2 text-center",
  right: "px-3 py-2 text-right",
};

/** 展示文本：null/undefined → 空串，布尔 → ✓/✗，其余 String()。 */
function displayCell(value: CellValue): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "boolean") {
    return value ? "✓" : "✗";
  }
  return String(value);
}

/** 导出文本：null/undefined → 空串，其余 String()（转义交给 bridge 导出器）。 */
function exportCell(value: CellValue): string {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

/** 全空值排末尾；同为空视作相等；数字直接比较，可解析字符串按数值比较，否则 localeCompare。 */
function compareCellValues(a: CellValue, b: CellValue): number {
  const aEmpty = a === null || a === undefined;
  const bEmpty = b === null || b === undefined;
  if (aEmpty && bEmpty) {
    return 0;
  }
  if (aEmpty) {
    return 1;
  }
  if (bEmpty) {
    return -1;
  }
  if (typeof a === "number" && typeof b === "number") {
    return a - b;
  }
  const sa = String(a);
  const sb = String(b);
  if (sa !== "" && sb !== "") {
    const na = Number(sa);
    const nb = Number(sb);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) {
      return na - nb;
    }
  }
  return sa.localeCompare(sb);
}

export function SmartDataTable<T>(props: SmartDataTableProps<T>): ReactElement {
  const { columns, rows, rowKey, onRowClick, emptyMessage } = props;
  const vars = useThemeVars();
  const filterable = props.filterable ?? true;
  const exportable = props.exportable ?? true;
  const exportBaseName = props.exportBaseName ?? "webremaster-export";
  const [filterText, setFilterText] = useState("");
  const [sort, setSort] = useState<SortState>(() =>
    props.initialSort !== undefined
      ? { key: props.initialSort.key, direction: props.initialSort.direction }
      : { key: null, direction: "asc" },
  );

  const isSortable = (column: SmartDataTableColumn<T>): boolean =>
    column.sortable === true || (column.sortable !== false && typeof column.value === "function");

  const visibleRows = useMemo<Array<T>>(() => {
    const needle = filterText.trim().toLowerCase();
    let result: Array<T> =
      needle.length === 0
        ? [...rows]
        : rows.filter((row) =>
            columns.some((column) => displayCell(column.value?.(row) ?? null).toLowerCase().includes(needle)),
          );
    const sortKey = sort.key;
    if (sortKey !== null) {
      const column = columns.find((candidate) => candidate.key === sortKey);
      const valueOf = column?.value;
      if (column !== undefined && valueOf !== undefined) {
        const dir = sort.direction === "asc" ? 1 : -1;
        result = [...result].sort((a, b) => compareCellValues(valueOf(a), valueOf(b)) * dir);
      }
    }
    return result;
  }, [rows, columns, filterText, sort]);

  const toggleSort = (column: SmartDataTableColumn<T>): void => {
    if (!isSortable(column)) {
      return;
    }
    setSort((prev) =>
      prev.key === column.key
        ? { key: column.key, direction: prev.direction === "asc" ? "desc" : "asc" }
        : { key: column.key, direction: "asc" },
    );
  };

  const buildExportRows = (): string[][] => [
    columns.map((column) => column.header),
    ...rows.map((row) => columns.map((column) => exportCell(column.value?.(row) ?? null))),
  ];

  const sortedColumn = sort.key !== null ? columns.find((candidate) => candidate.key === sort.key) : undefined;

  return (
    <div
      className="flex flex-col overflow-hidden rounded-lg"
      style={{ background: vars.surface, borderWidth: 1, borderStyle: "solid", borderColor: vars.border }}
    >
      <div
        className="flex flex-wrap items-center gap-2 px-3 py-2"
        style={{ borderBottomWidth: 1, borderBottomStyle: "solid", borderColor: vars.border }}
      >
        {filterable ? (
          <label className="relative inline-flex items-center">
            <Search size={13} aria-hidden className="absolute left-2.5" style={{ color: vars.textMuted }} />
            <input
              type="text"
              value={filterText}
              onChange={(event) => {
                setFilterText(event.target.value);
              }}
              placeholder={props.filterPlaceholder ?? "筛选…"}
              aria-label="筛选表格行"
              className="wr-input text-[12px]"
              style={{ width: 200, paddingLeft: 26 }}
            />
          </label>
        ) : null}
        <span className="flex-1" />
        {exportable ? (
          <>
            <button
              type="button"
              className="wr-btn wr-interactive"
              onClick={() => {
                exportToCSV(buildExportRows(), `${exportBaseName}.csv`);
              }}
              title="导出 CSV（UTF-8 BOM，Excel 中文不乱码）"
            >
              <Download size={13} aria-hidden />
              CSV
            </button>
            <button
              type="button"
              className="wr-btn wr-interactive"
              onClick={() => {
                exportToMarkdownTable(buildExportRows(), `${exportBaseName}.md`);
              }}
              title="导出 Markdown 表格"
            >
              <FileText size={13} aria-hidden />
              MD
            </button>
          </>
        ) : null}
      </div>

      <div className="overflow-x-auto">
        {visibleRows.length === 0 ? (
          <div className="px-4 py-8 text-center text-[13px]" style={{ color: vars.textMuted }}>
            {emptyMessage ?? "暂无数据"}
          </div>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr>
                {columns.map((column) => {
                  const sorted = sort.key === column.key;
                  return (
                    <th
                      key={column.key}
                      scope="col"
                      className={ALIGN_CLASS[column.align ?? "left"]}
                      aria-sort={sorted ? (sort.direction === "asc" ? "ascending" : "descending") : undefined}
                      style={{
                        width: column.width,
                        color: vars.textSecondary,
                        borderBottomWidth: 1,
                        borderBottomStyle: "solid",
                        borderColor: vars.borderStrong,
                      }}
                    >
                      {isSortable(column) ? (
                        <button
                          type="button"
                          className="wr-interactive inline-flex items-center gap-1"
                          onClick={() => {
                            toggleSort(column);
                          }}
                          style={{ color: sorted ? vars.accent : vars.textSecondary }}
                        >
                          {column.header}
                          {sorted ? (
                            sort.direction === "asc" ? (
                              <ArrowUp size={12} aria-hidden />
                            ) : (
                              <ArrowDown size={12} aria-hidden />
                            )
                          ) : (
                            <ArrowUpDown size={12} aria-hidden />
                          )}
                        </button>
                      ) : (
                        column.header
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row, index) => (
                <tr
                  key={rowKey(row, index)}
                  className={onRowClick !== undefined ? "wr-row wr-interactive cursor-pointer" : "wr-row"}
                  onClick={
                    onRowClick !== undefined
                      ? () => {
                          onRowClick(row, index);
                        }
                      : undefined
                  }
                  style={{ color: vars.text }}
                >
                  {columns.map((column) => (
                    <td key={column.key} className={ALIGN_CLASS[column.align ?? "left"]}>
                      {column.render !== undefined ? column.render(row, index) : displayCell(column.value?.(row) ?? null)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div
        className="flex items-center justify-between gap-3 px-3 py-2 text-[11px]"
        style={{ color: vars.textMuted, borderTopWidth: 1, borderTopStyle: "solid", borderColor: vars.border }}
      >
        <span>
          {visibleRows.length === rows.length ? `共 ${rows.length} 行` : `显示 ${visibleRows.length} / 共 ${rows.length} 行`}
        </span>
        {sortedColumn !== undefined ? (
          <span>
            按「{sortedColumn.header}」{sort.direction === "asc" ? "升序" : "降序"}
          </span>
        ) : null}
      </div>
    </div>
  );
}
