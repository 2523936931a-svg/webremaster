/**
 * DiagnosticsDrawer —— 提取器健康度诊断抽屉。
 *
 * 数据为纯快照（字段遥测 + 汇总），由宿主从 HealthTracker.getAllHealth()/summary()
 * 取值后传入（或直接用 collectDiagnostics(tracker) 生成），抽屉本身不订阅可变对象。
 * 运行在 Shadow DOM 内，颜色走主题变量，布局用静态 Tailwind 字面量。
 */
import { useEffect, type ReactElement } from "react";
import { Activity, X } from "lucide-react";
import type { HealthTracker } from "@webremaster/bridge";
import { THEME_MONO_FONT, useThemeVars, type ThemeVars } from "./theme.js";

/** 单字段的提取遥测（与 bridge 的 FieldHealth 结构完全一致，可直接传 getAllHealth() 结果）。 */
export interface DiagnosticsFieldHealth {
  tier: 1 | 2 | 3 | 4;
  hits: number;
  misses: number;
  lastError?: string;
}

/** 字段明细行：字段名 + 遥测（fieldName 来自 getAllHealth() 的键）。 */
export interface DiagnosticsFieldEntry extends DiagnosticsFieldHealth {
  fieldName: string;
}

/** 汇总数据（结构与 bridge HealthTracker.summary() 返回值兼容）。 */
export interface DiagnosticsSummary {
  totalFields: number;
  healthyFields: number;
  hitRate: number;
  tierBreakdown: Record<"1" | "2" | "3" | "4", number>;
}

/** 诊断快照：一次抽屉渲染所需的全部数据。 */
export interface DiagnosticsSnapshot {
  fields: Record<string, DiagnosticsFieldHealth>;
  summary: DiagnosticsSummary;
  siteId?: string;
  routeId?: string;
}

export interface DiagnosticsDrawerProps {
  open: boolean;
  onClose: () => void;
  snapshot: DiagnosticsSnapshot;
}

/** 从 HealthTracker 生成诊断快照（宿主可在任意时刻调用后传给抽屉）。 */
export function collectDiagnostics(tracker: HealthTracker, extra?: { siteId?: string; routeId?: string }): DiagnosticsSnapshot {
  return {
    fields: tracker.getAllHealth(),
    summary: tracker.summary(),
    siteId: extra?.siteId,
    routeId: extra?.routeId,
  };
}

const TIERS: ReadonlyArray<1 | 2 | 3 | 4> = [1, 2, 3, 4];

const TIER_LABELS: Record<1 | 2 | 3 | 4, string> = {
  1: "T1 选择器链",
  2: "T2 相对定位",
  3: "T3 正则捕获",
  4: "T4 空间定位",
};

const TIER_COUNT_KEY: Record<1 | 2 | 3 | 4, "1" | "2" | "3" | "4"> = { 1: "1", 2: "2", 3: "3", 4: "4" };

const TIER_COLORS: Record<1 | 2 | 3 | 4, keyof ThemeVars> = { 1: "success", 2: "accent", 3: "warning", 4: "danger" };

export function DiagnosticsDrawer(props: DiagnosticsDrawerProps): ReactElement | null {
  const { open, onClose, snapshot } = props;
  const vars = useThemeVars();

  // Esc 关闭：仅 open 时挂监听，关闭时自动解绑
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  const summary = snapshot.summary;
  const entries: Array<DiagnosticsFieldEntry> = Object.entries(snapshot.fields).map(([fieldName, health]) => ({
    fieldName,
    ...health,
  }));
  // 未命中多的在前，其次命中少的在前，最后按字段名稳定排序
  entries.sort(
    (a, b) => b.misses - a.misses || a.hits - b.hits || a.fieldName.localeCompare(b.fieldName),
  );
  const hitRatePct = Math.round(summary.hitRate * 100);
  const scopeLabel = snapshot.siteId !== undefined ? (snapshot.routeId !== undefined ? `${snapshot.siteId} · ${snapshot.routeId}` : snapshot.siteId) : null;

  return (
    <div
      className="fixed inset-0 z-40"
      style={{ background: "rgba(0,0,0,.45)" }}
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <aside
        role="dialog"
        aria-label="提取器健康度诊断"
        className="absolute right-0 top-0 flex h-full w-[380px] max-w-[90vw] flex-col overflow-y-auto"
        style={{
          background: vars.surface,
          borderLeftWidth: 1,
          borderLeftStyle: "solid",
          borderColor: vars.border,
          boxShadow: "-12px 0 40px rgba(0,0,0,.35)",
        }}
      >
        <div
          className="flex shrink-0 items-center justify-between gap-2 px-4 py-3"
          style={{ borderBottomWidth: 1, borderBottomStyle: "solid", borderColor: vars.border }}
        >
          <div className="flex min-w-0 items-center gap-2">
            <Activity size={15} aria-hidden style={{ color: vars.accent }} />
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold" style={{ color: vars.text }}>
                提取器健康度
              </div>
              {scopeLabel !== null ? (
                <div className="truncate text-[11px]" style={{ color: vars.textMuted }}>
                  {scopeLabel}
                </div>
              ) : null}
            </div>
          </div>
          <button type="button" className="wr-btn wr-interactive" onClick={onClose} aria-label="关闭诊断面板" title="关闭 (Esc)">
            <X size={14} aria-hidden />
          </button>
        </div>

        <div className="shrink-0 px-4 py-3" style={{ borderBottomWidth: 1, borderBottomStyle: "solid", borderColor: vars.border }}>
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="text-[26px] font-semibold leading-none" style={{ color: vars.accent }}>
                {hitRatePct}%
              </div>
              <div className="mt-1 text-[11px]" style={{ color: vars.textMuted }}>
                字段命中率
              </div>
            </div>
            <div className="text-right text-[11px]" style={{ color: vars.textMuted }}>
              健康字段 {summary.healthyFields} / {summary.totalFields}
            </div>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full" style={{ background: vars.surfaceAlt }}>
            <div className="h-full rounded-full" style={{ background: vars.accent, width: `${hitRatePct}%` }} />
          </div>
          <div className="mt-3 flex flex-col gap-1.5">
            {TIERS.map((tier) => {
              const count = summary.tierBreakdown[TIER_COUNT_KEY[tier]];
              const pct = summary.totalFields > 0 ? Math.round((count / summary.totalFields) * 100) : 0;
              return (
                <div key={tier} className="flex items-center gap-2">
                  <span className="w-20 shrink-0 text-[11px]" style={{ color: vars.textSecondary }}>
                    {TIER_LABELS[tier]}
                  </span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: vars.surfaceAlt }}>
                    <div className="h-full rounded-full" style={{ background: vars[TIER_COLORS[tier]], width: `${pct}%` }} />
                  </div>
                  <span className="w-8 shrink-0 text-right text-[11px]" style={{ color: vars.textMuted }}>
                    {count}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="px-4 pb-1 pt-3 text-[11px] font-medium" style={{ color: vars.textMuted }}>
          字段明细（{entries.length}）
        </div>
        {entries.length === 0 ? (
          <div className="px-4 py-8 text-center text-[12px]" style={{ color: vars.textMuted }}>
            暂无提取遥测数据
          </div>
        ) : (
          <div className="flex flex-col">
            {entries.map((entry) => (
              <div
                key={entry.fieldName}
                className="px-4 py-2.5"
                style={{ borderBottomWidth: 1, borderBottomStyle: "solid", borderColor: vars.border }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className="truncate text-[12px]"
                    style={{ color: vars.text, fontFamily: THEME_MONO_FONT }}
                    title={entry.fieldName}
                  >
                    {entry.fieldName}
                  </span>
                  <span className="wr-chip shrink-0" style={{ color: vars[TIER_COLORS[entry.tier]] }}>
                    T{entry.tier}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-3 text-[11px]" style={{ color: vars.textMuted }}>
                  <span>命中 {entry.hits}</span>
                  <span>未命中 {entry.misses}</span>
                </div>
                {entry.lastError !== undefined && entry.lastError !== "" ? (
                  <div className="mt-1 break-all text-[11px]" style={{ color: vars.danger }}>
                    {entry.lastError}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}
