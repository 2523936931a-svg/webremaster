/// <reference lib="dom" />
/**
 * LiveVerifier —— Playwright 七重真浏览器验收器（Gate 1-6 门禁 + Gate 7 VLM 终审）。
 *
 * 流程：注入 fetch 日志（document-start）→ 注入打包产物 .user.js（document-start，真实模拟
 * 油猴注入）→ goto snapshot.url（load，30s 超时）→ settle → 六重门禁 → 截图 after.png →
 * （可选）VLM 终审 → VerificationReportSchema.parse → writeFileSync 落盘
 * outDir/05_verification.json（UTF-8）。
 *
 * 门禁一览：
 * 1. zero-runtime-errors：settle 后再等 1800ms，pageerror + console.error 必须为 0（前 3 条入 details）；
 * 2. zero-flash-curtain-lifted：html[data-wr-ready]="true"、style[data-wr-curtain] 已移除、
 *    web-remaster-root 的 shadowRoot 存在且 host 渲染区 ≥800×400、#wr-origin-wrapper 为 remastered；
 * 3. data-parity-and-health：列表原型（news-feed/classifieds-grid/data-table-portal/
 *    package-registry/forum-thread，其余原型按列表语义处理）按 shadowRoot 内 [data-wr-item="true"]
 *    数量对账 ratio ≥ 0.90、score=round(ratio*10)；阅读原型（doc-reader/academic-archive）按正文
 *    ≥200 字判 10/0；必填字段健康度（getHealth 归一化 perField）命中率 ≥0.9 才算通过；
 * 4. no-broken-render：shadowRoot 文本节点无独立 "undefined"/"NaN"（trim 后全等）、
 *    documentElement.scrollWidth ≤ innerWidth+4、首个元素子级背景/前景非浏览器默认值
 *    （确认 Tailwind 生效非默认白底）；
 * 5. bridge-and-split-smoke：Alt+Shift+R 三态循环 remastered→original→split（截图 split.png）→
 *    remastered；按 features 声明断言 Ctrl+K 命令面板（shadowRoot 内可见 [role=dialog]）与
 *    Alt+Shift+X 诊断抽屉（可见 [aria-label*=诊断] 或 [role=dialog]），Escape 关闭；全程零新增报错；
 * 6. portal-and-turbonav-integrity：portalSlots 非空时断言 light DOM 存在带活体节点的
 *    [data-wr-portal-slot] 容器，setMode("original") 300ms 后节点归还、容器消失，再恢复 remastered；
 *    enableTurboNav 时悬停原站首个同源链接，断言 __WR_FETCH_LOG__ 命中预取地址；两者都未声明时
 *    passed=true、details="契约未声明 portal/TurboNav"；
 * 7. （不入 gates 数组）VLM 终审：enableVlm 且提供 vlmCritic 时 score≥8.5 才算通过；
 *    无 critic 时 vlmScore=0、vlmFeedback="待终审（Agent-Native 模式）"。
 *
 * 实现决策（wrapper 契约约束下的取舍）：
 * - 打包 wrapper 未把 diagnostics.features 暴露到页面（__WR_DEBUG__ 仅含 getMode/setMode/
 *   getHealth/bootPhase，且勿改 monkeyBundler.ts）：验收器读取皮肤可选回填的
 *   window.__WR_DEBUG__.features 镜像；无镜像时退化为行为探测——探测到对话框即按已声明
 *   验证开/关，探测不到视为「未声明，跳过」并在 details 注明。
 * - remastered 模式下 #wr-origin-wrapper 位于视口外（left:-99999px）且 pointer-events:none，
 *   真实 hover 无法命中：TurboNav 预取断言先 setMode("original") 让原站回到文档流再做
 *   locator.hover()，断言完恢复 remastered。
 * - extractFieldWithCascade 等纯提取逻辑属于皮肤侧实现，验收器只看运行结果（items 数量 /
 *   遥测命中率），不重复实现提取算法。
 * - fixtureHtmlPath 为离线回放通道：主文档由本地 HTML 响应，站点不可达（地域封锁、CI 无
 *   外网、原站改版）时仍可复核门禁；报告的 Gate 1 details 会标注「离线 fixture 回放」，
 *   避免把回放结果误读成真站实测。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { Browser, Page } from "playwright";
import {
  VerificationReportSchema,
  type ContractRoute,
  type SiteContract,
  type SiteSnapshot,
  type VerificationGate,
  type VerificationReport,
} from "@webremaster/schema";
import { launchSurveyBrowser } from "../inspector/domXray.js";

/* ------------------------------------------------------------------ */
/* 公开类型（签名锁定）                                                  */
/* ------------------------------------------------------------------ */

export interface VlmCriticResult {
  score: number;
  feedback: string;
  tokensUsed?: number;
}

export type VlmCritic = (beforePngPath: string, afterPngPath: string) => Promise<VlmCriticResult>;

export interface VerifyRemasteredSkinOptions {
  snapshot: SiteSnapshot;
  contract: SiteContract;
  userscriptPath: string;
  outDir: string;
  enableVlm: boolean;
  vlmCritic?: VlmCritic;
  storageStatePath?: string;
  proxy?: string;
  settleMs?: number;
  /** 离线回放：用该本地 HTML 响应 snapshot.url 的主文档（站点不可达时复核门禁）。 */
  fixtureHtmlPath?: string;
  /** 是否落盘 after.png / split.png（默认 true；离线回放建议关闭，避免用回放截图覆盖真机图）。 */
  captureScreenshots?: boolean;
  browser?: Browser;
}

/* ------------------------------------------------------------------ */
/* 常量                                                                 */
/* ------------------------------------------------------------------ */

/** load 事件后的默认稳定等待毫秒数。 */
const DEFAULT_SETTLE_MS = 2500;
/** 导航超时毫秒数（验收器不容忍导航失败，与测绘器的超时容忍语义不同）。 */
const GOTO_TIMEOUT_MS = 30_000;
/** Gate 1 在 settle 之后的追加静默观察窗口。 */
const GATE1_EXTRA_WAIT_MS = 1800;
/** 烟测内每步（按键/模式切换）之后的状态稳定等待。 */
const SMOKE_SETTLE_MS = 150;
/** Gate 6 切 original 后等待传送门归还的窗口（规格要求 300ms）。 */
const PORTAL_RESTORE_WAIT_MS = 300;
/** Gate 6 悬停后等待 TurboNav 预取完成的窗口（规格要求 900ms）。 */
const TURBO_HOVER_WAIT_MS = 900;
/** 列表原型数据对账的最低还原比例。 */
const LIST_MIN_RATIO = 0.9;
/** 必填字段健康度的最低命中率。 */
const REQUIRED_MIN_HIT_RATE = 0.9;
/** 阅读原型的最小正文字数。 */
const READING_MIN_BODY_CHARS = 200;
/** VLM 终审通过分数线。 */
const VLM_PASS_SCORE = 8.5;
/** 无 VLM critic 时的占位终审反馈（Agent-Native 模式）。 */
const AGENT_NATIVE_FEEDBACK = "待终审（Agent-Native 模式）";
/** 验证报告落盘文件名。 */
const REPORT_FILE_NAME = "05_verification.json";

/** 列表原型：按 [data-wr-item] 数量对账。 */
const LIST_ARCHETYPES: ReadonlySet<string> = new Set([
  "news-feed",
  "classifieds-grid",
  "data-table-portal",
  "package-registry",
  "forum-thread",
]);
/** 阅读原型：按正文字数对账。 */
const READING_ARCHETYPES: ReadonlySet<string> = new Set(["doc-reader", "academic-archive"]);

/* ------------------------------------------------------------------ */
/* 页面内检查函数（全部自包含，可被 Playwright 原样序列化执行）            */
/* ------------------------------------------------------------------ */

/** 在页面内安装 fetch 包装：每次 fetch 的 url push 进 window.__WR_FETCH_LOG__（初始 []）。 */
function installFetchLog(): void {
  const holder = globalThis as unknown as { __WR_FETCH_LOG__?: unknown[]; fetch?: unknown };
  if (Array.isArray(holder.__WR_FETCH_LOG__)) return; // 幂等：重复注入不覆盖
  const log: unknown[] = [];
  holder.__WR_FETCH_LOG__ = log;
  const original = holder.fetch;
  if (typeof original !== "function") return;
  // fetch 归属于 globalThis，脱离接收者调用会 Illegal invocation，必须 .call(globalThis)
  const originalFetch = original as (
    this: unknown,
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response>;
  const wrappedFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    try {
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
      log.push(url);
    } catch {
      /* 日志失败不拦截请求 */
    }
    return originalFetch.call(globalThis, input, init);
  };
  holder.fetch = wrappedFetch;
}

/** Gate 2 页面内检查项。 */
interface CurtainInspection {
  readyOk: boolean;
  curtainGone: boolean;
  shadowOk: boolean;
  hostWidth: number;
  hostHeight: number;
  modeOk: boolean;
  mode: string | null;
}

/** Gate 2：幕帘揭起 + 挂载区渲染尺寸 + 原站隐身模式（自包含）。 */
function inspectCurtainLift(): CurtainInspection {
  const readyOk = document.documentElement.getAttribute("data-wr-ready") === "true";
  const curtainGone = document.querySelector("style[data-wr-curtain]") === null;
  const host = document.querySelector("web-remaster-root");
  let shadowOk = false;
  let hostWidth = 0;
  let hostHeight = 0;
  if (host instanceof HTMLElement && host.shadowRoot !== null) {
    shadowOk = true;
    const rect = host.getBoundingClientRect();
    hostWidth = rect.width;
    hostHeight = rect.height;
  }
  const wrapper = document.getElementById("wr-origin-wrapper");
  const mode = wrapper?.getAttribute("data-wr-mode") ?? null;
  return { readyOk, curtainGone, shadowOk, hostWidth, hostHeight, modeOk: mode === "remastered", mode };
}

/** Gate 3 页面内数据盘点。 */
interface RemasteredDataInspection {
  itemCount: number;
  bodyTextLength: number;
}

/** Gate 3：shadowRoot 内 [data-wr-item] 数量与正文字数（自包含）。 */
function inspectRemasteredData(): RemasteredDataInspection {
  const host = document.querySelector("web-remaster-root");
  const root = host instanceof HTMLElement ? host.shadowRoot : null;
  const itemCount = root !== null ? root.querySelectorAll('[data-wr-item="true"]').length : 0;
  const bodyTextLength = root !== null ? (root.textContent ?? "").trim().length : 0;
  return { itemCount, bodyTextLength };
}

/** Gate 3：读取皮肤健康度遥测（__WR_DEBUG__.getHealth()，缺失/异常时返回 null）。 */
function readHealthInPage(): unknown {
  const debug = (window as unknown as { __WR_DEBUG__?: { getHealth?: () => unknown } }).__WR_DEBUG__;
  try {
    return typeof debug?.getHealth === "function" ? debug.getHealth() : null;
  } catch {
    return null;
  }
}

/** Gate 4 页面内检查项。 */
interface RenderInspection {
  badTextSamples: string[];
  scrollWidth: number;
  innerWidth: number;
  firstPaint: { background: string; color: string } | null;
}

/** Gate 4：undefined/NaN 文本、横向溢出、首元素子级绘制（自包含）。 */
function inspectBrokenRender(): RenderInspection {
  const badLiterals = new Set(["undefined", "NaN"]);
  const badTextSamples: string[] = [];
  const innerWidth = window.innerWidth;
  const scrollWidth = document.documentElement.scrollWidth;
  const host = document.querySelector("web-remaster-root");
  const root = host instanceof HTMLElement ? host.shadowRoot : null;
  let firstPaint: { background: string; color: string } | null = null;
  if (root !== null) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let current = walker.nextNode();
    while (current !== null) {
      const text = (current.nodeValue ?? "").trim();
      if (badLiterals.has(text) && badTextSamples.length < 5) badTextSamples.push(text);
      current = walker.nextNode();
    }
    const firstChild = root.firstElementChild;
    if (firstChild !== null) {
      const style = getComputedStyle(firstChild);
      firstPaint = { background: style.backgroundColor, color: style.color };
    }
  }
  return { badTextSamples, scrollWidth, innerWidth, firstPaint };
}

/** Gate 5 页面内功能声明（__WR_DEBUG__.features 皮肤镜像；无镜像返回空对象）。 */
function readDeclaredFeaturesInPage(): { commandPalette?: boolean; diagnosticsDrawer?: boolean } {
  const debug = (window as unknown as { __WR_DEBUG__?: { features?: unknown } }).__WR_DEBUG__;
  const features = debug?.features;
  if (features === null || typeof features !== "object") return {};
  const holder = features as { commandPalette?: unknown; diagnosticsDrawer?: unknown };
  const out: { commandPalette?: boolean; diagnosticsDrawer?: boolean } = {};
  if (typeof holder.commandPalette === "boolean") out.commandPalette = holder.commandPalette;
  if (typeof holder.diagnosticsDrawer === "boolean") out.diagnosticsDrawer = holder.diagnosticsDrawer;
  return out;
}

/**
 * Gate 5：shadowRoot 内对话框可见性（自包含）。
 * kind="palette" 只查 [role=dialog]；kind="drawer" 查 [aria-label*=诊断] 或 [role=dialog]。
 */
function isShadowDialogVisible(kind: string): boolean {
  const host = document.querySelector("web-remaster-root");
  const root = host instanceof HTMLElement ? host.shadowRoot : null;
  if (root === null) return false;
  const candidates: Element[] = [];
  if (kind === "drawer") {
    const labeled = root.querySelector('[aria-label*="诊断"]');
    if (labeled !== null) candidates.push(labeled);
  }
  const dialog = root.querySelector('[role="dialog"]');
  if (dialog !== null) candidates.push(dialog);
  for (const candidate of candidates) {
    const style = getComputedStyle(candidate);
    const rect = candidate.getBoundingClientRect();
    if (style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0) {
      return true;
    }
  }
  return false;
}

/** Gate 6 页面内检查项：传送门容器盘点。 */
interface PortalContainersInspection {
  containerCount: number;
  withChildren: number;
}

/** Gate 6：light DOM 内 [data-wr-portal-slot] 容器数量与含活体节点的容器数（自包含）。 */
function inspectPortalContainers(): PortalContainersInspection {
  const containers = Array.from(document.querySelectorAll("[data-wr-portal-slot]"));
  return {
    containerCount: containers.length,
    withChildren: containers.filter((container) => container.childNodes.length > 0).length,
  };
}

/** Gate 6 页面内检查项：切 original 后的归还状态。 */
interface PortalReturnInspection {
  backInWrapper: boolean;
  containersLeft: number;
}

/** Gate 6：原站节点是否回到 #wr-origin-wrapper 且投影容器已消失（自包含）。 */
function inspectPortalReturn(selector: string): PortalReturnInspection {
  const wrapper = document.getElementById("wr-origin-wrapper");
  let backInWrapper = false;
  if (wrapper !== null) {
    try {
      backInWrapper = wrapper.querySelector(selector) !== null;
    } catch {
      backInWrapper = false; // 非法选择器按未归还处理
    }
  }
  return { backInWrapper, containersLeft: document.querySelectorAll("[data-wr-portal-slot]").length };
}

/** Gate 6：#wr-origin-wrapper 内首个同源且非自链接的 <a href>（自链接 TurboNav 正确放行，不作断言对象）。 */
function findFirstSameOriginAnchor(): { index: number; href: string } | { selfOnly: true } | null {
  const anchors = Array.from(document.querySelectorAll("#wr-origin-wrapper a[href]"));
  let sawSelf = false;
  for (let index = 0; index < anchors.length; index++) {
    const anchor = anchors[index] as HTMLAnchorElement;
    const rawHref = anchor.getAttribute("href") ?? "";
    if (rawHref.startsWith("#")) continue; // 页内锚点：TurboNav 放行，不作预取断言对象
    try {
      const resolved = new URL(rawHref, window.location.href);
      if (
        (resolved.protocol === "http:" || resolved.protocol === "https:") &&
        resolved.origin === window.location.origin
      ) {
        if (resolved.pathname === window.location.pathname && resolved.search === window.location.search) {
          sawSelf = true; // 自链接（如 logo 回首页）：TurboNav 纯 hash/同页规则放行
          continue;
        }
        return { index, href: resolved.href };
      }
    } catch {
      /* 非法 href 跳过 */
    }
  }
  return sawSelf ? { selfOnly: true } : null;
}

/** Gate 6：读取 __WR_FETCH_LOG__（自包含，缺失时返回空数组）。 */
function readFetchLogInPage(): string[] {
  const log = (window as unknown as { __WR_FETCH_LOG__?: unknown }).__WR_FETCH_LOG__;
  return Array.isArray(log) ? log.filter((entry): entry is string => typeof entry === "string") : [];
}

/* ------------------------------------------------------------------ */
/* Node 侧辅助                                                          */
/* ------------------------------------------------------------------ */

/** 读取当前视图模式（__WR_DEBUG__ 缺失时返回 null，由断言暴露）。 */
async function readViewMode(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const debug = (window as unknown as { __WR_DEBUG__?: { getMode?: () => string } }).__WR_DEBUG__;
    try {
      return typeof debug?.getMode === "function" ? debug.getMode() : null;
    } catch {
      return null;
    }
  });
}

/** 读取皮肤功能声明镜像（无镜像返回空对象，随后走行为探测）。 */
async function readDeclaredFeatures(page: Page): Promise<{ commandPalette?: boolean; diagnosticsDrawer?: boolean }> {
  return page.evaluate(readDeclaredFeaturesInPage);
}

/** 设置视图模式（__WR_DEBUG__ 缺失时静默跳过，由后续断言暴露失败）。 */
async function setViewMode(page: Page, mode: string): Promise<void> {
  await page.evaluate((target) => {
    const debug = (window as unknown as { __WR_DEBUG__?: { setMode?: (mode: string) => void } }).__WR_DEBUG__;
    try {
      debug?.setMode?.(target);
    } catch {
      /* 切换失败由后续断言暴露 */
    }
  }, mode);
}

/** 热键探测 shadowRoot 内对话框：按热键 → 可见性 → Escape → 应不可见。 */
async function probeShadowDialog(
  page: Page,
  kind: "palette" | "drawer",
): Promise<{ opened: boolean; closedAfterEscape: boolean }> {
  await page.keyboard.press(kind === "palette" ? "Control+k" : "Alt+Shift+X");
  await page.waitForTimeout(SMOKE_SETTLE_MS);
  const opened = await page.evaluate(isShadowDialogVisible, kind);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(SMOKE_SETTLE_MS);
  const stillVisible = await page.evaluate(isShadowDialogVisible, kind);
  return { opened, closedAfterEscape: !stillVisible };
}

/** 解析合同路由：urlRegex 命中 snapshot.url 的第一条（非法正则视为不命中），回退 routes[0]。 */
function resolveRoute(contract: SiteContract, url: string): ContractRoute {
  for (const route of contract.routes) {
    try {
      if (new RegExp(route.urlRegex).test(url)) return route;
    } catch {
      /* 非法正则跳过 */
    }
  }
  return contract.routes[0]!;
}

/**
 * 归一化健康度遥测：对象含 perField 键则取 perField，否则整体视为
 * Record<string, {tier, hits, misses}>。逐字段消毒（tier 收敛 1-4、计数收敛非负整数），
 * 保证畸形遥测不会击穿 VerificationReportSchema.parse（消毒后命中率自然不及格，门禁失败）。
 */
function normalizeHealthSummary(raw: unknown): Record<string, { tier: number; hits: number; misses: number }> {
  if (raw === null || typeof raw !== "object") return {};
  const holder = raw as Record<string, unknown>;
  const source =
    holder.perField !== null && typeof holder.perField === "object" ? holder.perField : raw;
  if (source === null || typeof source !== "object") return {};
  const out: Record<string, { tier: number; hits: number; misses: number }> = {};
  for (const [field, value] of Object.entries(source as Record<string, unknown>)) {
    if (value === null || typeof value !== "object") continue;
    const entry = value as Record<string, unknown>;
    const toCount = (candidate: unknown): number =>
      typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0 ? Math.floor(candidate) : 0;
    const tierCandidate = entry.tier;
    const tier =
      typeof tierCandidate === "number" && Number.isInteger(tierCandidate) && tierCandidate >= 1 && tierCandidate <= 4
        ? tierCandidate
        : 1;
    out[field] = { tier, hits: toCount(entry.hits), misses: toCount(entry.misses) };
  }
  return out;
}

/** fetch 日志条目与期望地址是否同指一 URL（容忍相对/绝对形式差异）。 */
function isSameUrl(logged: string, expected: string): boolean {
  if (logged === expected) return true;
  try {
    return new URL(logged).href === expected;
  } catch {
    return false;
  }
}

/** fixture 同目录同名资源的 Content-Type（未知扩展名按二进制流处理，浏览器不会误解析）。 */
function fixtureContentType(fileName: string): string {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "css":
      return "text/css; charset=utf-8";
    case "js":
      return "text/javascript; charset=utf-8";
    case "html":
      return "text/html; charset=utf-8";
    case "svg":
      return "image/svg+xml";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "json":
      return "application/json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

/* ------------------------------------------------------------------ */
/* 主流程                                                               */
/* ------------------------------------------------------------------ */

/**
 * 七重真浏览器验收：装载 userscript 后依次执行 Gate 1-6 与 Gate 7（VLM 终审），
 * 返回经 VerificationReportSchema 校验的报告（已落盘 outDir/05_verification.json）。
 * 门禁失败体现在报告内（passed=false），基础设施错误（导航失败、浏览器不可用等）直接抛出。
 */
export async function verifyRemasteredSkin(options: VerifyRemasteredSkinOptions): Promise<VerificationReport> {
  const settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;
  const captureScreenshots = options.captureScreenshots ?? true;
  if (!captureScreenshots && options.enableVlm) {
    throw new Error("captureScreenshots=false 时不产出 after.png，无法进行 VLM 评审；请关闭 VLM 或保留截图。");
  }
  mkdirSync(options.outDir, { recursive: true });

  // options.browser 注入优先（调用方负责关闭）；自建浏览器在 finally 关闭
  const browser = options.browser ?? (await launchSurveyBrowser(options.proxy));
  const ownsBrowser = options.browser === undefined;
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ...(options.storageStatePath !== undefined ? { storageState: options.storageStatePath } : {}),
  });
  try {
    // 离线回放：主文档由本地快照响应；同源静态资源（CSS/SVG/JS）优先取 fixture 同目录同名文件，
    // 缺失时返回 200 空响应 —— 既不触发 net::ERR_FAILED（那会污染 Gate 1 的错误采集），
    // 也不让 load 事件卡在不可达的网络上。
    const fixtureNote = options.fixtureHtmlPath !== undefined ? "（离线 fixture 回放：主文档由本地快照响应）" : "";
    if (options.fixtureHtmlPath !== undefined) {
      const fixturePath = resolve(options.fixtureHtmlPath);
      if (!existsSync(fixturePath)) {
        throw new Error(`fixture HTML 不存在：${fixturePath}`);
      }
      const fixtureDir = dirname(fixturePath);
      const fixtureHtml = readFileSync(fixturePath);
      await context.route("**/*", async (route) => {
        const request = route.request();
        if (request.url() === options.snapshot.url) {
          await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: fixtureHtml });
          return;
        }
        if (request.resourceType() === "document") {
          await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: "" });
          return;
        }
        const fileName = basename(new URL(request.url()).pathname);
        const localPath = join(fixtureDir, fileName);
        if (fileName.length > 0 && existsSync(localPath)) {
          await route.fulfill({ status: 200, contentType: fixtureContentType(fileName), body: readFileSync(localPath) });
          return;
        }
        await route.fulfill({ status: 200, contentType: fixtureContentType(fileName), body: "" });
      });
    }

    const page = await context.newPage();

    // 错误采集从导航开始：pageerror + console(type===error)
    const errors: string[] = [];
    page.on("pageerror", (error) => {
      errors.push(`pageerror: ${error.message}`);
    });
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`console.error: ${message.text()}`);
    });

    // 注入顺序：fetch 日志先行，皮肤 .user.js 随后 —— 均在 document-start 生效
    await page.addInitScript(installFetchLog);
    await page.addInitScript({ path: options.userscriptPath });

    await page.goto(options.snapshot.url, { waitUntil: "load", timeout: GOTO_TIMEOUT_MS });
    if (settleMs > 0) await page.waitForTimeout(settleMs);

    const gates: VerificationGate[] = [];

    /* ---- Gate 1 zero-runtime-errors ---- */
    await page.waitForTimeout(GATE1_EXTRA_WAIT_MS);
    const gate1Passed = errors.length === 0;
    gates.push({
      gateName: "zero-runtime-errors",
      passed: gate1Passed,
      score: gate1Passed ? 10 : 0,
      details: gate1Passed
        ? `页面零运行时错误（pageerror 与 console.error 均为 0 条）${fixtureNote}`
        : `采集到 ${errors.length} 条运行时错误，前 3 条：${errors.slice(0, 3).join("；")}${fixtureNote}`,
    });

    /* ---- Gate 2 zero-flash-curtain-lifted ---- */
    const curtain = await page.evaluate(inspectCurtainLift);
    const curtainFailures: string[] = [];
    if (!curtain.readyOk) curtainFailures.push('html[data-wr-ready] !== "true"');
    if (!curtain.curtainGone) curtainFailures.push("style[data-wr-curtain] 仍存在");
    if (!curtain.shadowOk) {
      curtainFailures.push("web-remaster-root 的 shadowRoot 不存在");
    } else if (curtain.hostWidth < 800 || curtain.hostHeight < 400) {
      curtainFailures.push(
        `host 渲染区 ${Math.round(curtain.hostWidth)}×${Math.round(curtain.hostHeight)} 低于 800×400`,
      );
    }
    if (!curtain.modeOk) {
      curtainFailures.push(`#wr-origin-wrapper data-wr-mode=${curtain.mode ?? "（缺失）"} !== "remastered"`);
    }
    const gate2Passed = curtainFailures.length === 0;
    gates.push({
      gateName: "zero-flash-curtain-lifted",
      passed: gate2Passed,
      score: gate2Passed ? 10 : 0,
      details: gate2Passed
        ? `幕帘已揭起：data-wr-ready=true，幕帘样式已移除，host 渲染区 ${Math.round(curtain.hostWidth)}×${Math.round(
            curtain.hostHeight,
          )}，原站处于 remastered 隐身模式`
        : `幕帘检查未通过：${curtainFailures.join("；")}`,
    });

    /* ---- Gate 3 data-parity-and-health ---- */
    const route = resolveRoute(options.contract, options.snapshot.url);
    const data = await page.evaluate(inspectRemasteredData);
    const health = normalizeHealthSummary(await page.evaluate(readHealthInPage));
    const isReading = READING_ARCHETYPES.has(route.archetype);
    let ratio: number;
    let parityPassed: boolean;
    let parityScore: number;
    if (isReading) {
      ratio = 1;
      parityPassed = data.bodyTextLength >= READING_MIN_BODY_CHARS;
      parityScore = parityPassed ? 10 : 0;
    } else {
      ratio = data.itemCount / Math.max(1, options.snapshot.originalItemCountHint);
      parityPassed = ratio >= LIST_MIN_RATIO;
      parityScore = Math.min(10, Math.round(ratio * 10));
    }
    const requiredFields = route.itemFields.filter((field) => field.required);
    const healthFailures: string[] = [];
    for (const field of requiredFields) {
      const entry = health[field.fieldName];
      const hits = entry?.hits ?? 0;
      const misses = entry?.misses ?? 0;
      const samples = hits + misses;
      const rate = samples > 0 ? hits / samples : 0;
      if (rate < REQUIRED_MIN_HIT_RATE) {
        healthFailures.push(
          `${field.fieldName} 命中率 ${
            samples > 0 ? `${(rate * 100).toFixed(0)}%（${hits}/${samples}）` : "无采样"
          } < 90%`,
        );
      }
    }
    const healthPassed = healthFailures.length === 0;
    const telemetry =
      Object.entries(health)
        .map(([field, entry]) => `${field}(t${entry.tier} h${entry.hits}/m${entry.misses})`)
        .join(", ") || "（空）";
    const parityDesc = isReading
      ? `阅读原型 ${route.archetype}：正文 ${data.bodyTextLength} 字（要求 ≥${READING_MIN_BODY_CHARS}）`
      : `列表原型 ${route.archetype}：remastered ${data.itemCount} 项 / 原站 hint ${options.snapshot.originalItemCountHint} → ratio ${ratio.toFixed(2)}`;
    gates.push({
      gateName: "data-parity-and-health",
      passed: parityPassed && healthPassed,
      score: parityScore,
      details: `${parityDesc}；必填字段健康度：${
        requiredFields.length === 0 ? "无必填字段（自动通过）" : healthPassed ? "全部 ≥90%" : healthFailures.join("；")
      }；健康遥测：${telemetry}`,
    });

    /* ---- Gate 4 no-broken-render ---- */
    const render = await page.evaluate(inspectBrokenRender);
    const renderFailures: string[] = [];
    if (render.badTextSamples.length > 0) {
      renderFailures.push(`shadowRoot 文本含独立 undefined/NaN：${render.badTextSamples.join("、")}`);
    }
    if (render.scrollWidth > render.innerWidth + 4) {
      renderFailures.push(
        `documentElement.scrollWidth ${render.scrollWidth} > innerWidth ${render.innerWidth} + 4（横向溢出）`,
      );
    }
    if (render.firstPaint === null) {
      renderFailures.push("shadowRoot 无元素子级，无法确认真实绘制");
    } else if (render.firstPaint.background === "rgba(0, 0, 0, 0)" && render.firstPaint.color === "rgb(0, 0, 0)") {
      renderFailures.push(
        `首个元素子级为浏览器默认白底黑字（background=${render.firstPaint.background}, color=${render.firstPaint.color}），样式未生效`,
      );
    }
    const gate4Passed = renderFailures.length === 0;
    gates.push({
      gateName: "no-broken-render",
      passed: gate4Passed,
      score: gate4Passed ? 10 : 0,
      details: gate4Passed
        ? `渲染健康：无 undefined/NaN 文本，scrollWidth ${render.scrollWidth} ≤ innerWidth ${render.innerWidth}+4，首个元素子级 background=${render.firstPaint?.background} / color=${render.firstPaint?.color}`
        : `渲染检查未通过：${renderFailures.join("；")}`,
    });

    /* ---- Gate 5 bridge-and-split-smoke ---- */
    const errorsBeforeSmoke = errors.length;
    const smokeNotes: string[] = [];

    // 三态切换：remastered → original → split（截图 split.png）→ remastered
    let modeCycleOk = true;
    await page.keyboard.press("Alt+Shift+R");
    await page.waitForTimeout(SMOKE_SETTLE_MS);
    const mode1 = await readViewMode(page);
    if (mode1 !== "original") modeCycleOk = false;
    await page.keyboard.press("Alt+Shift+R");
    await page.waitForTimeout(SMOKE_SETTLE_MS);
    const mode2 = await readViewMode(page);
    if (mode2 !== "split") modeCycleOk = false;
    if (captureScreenshots) await page.screenshot({ path: join(options.outDir, "split.png") });
    await page.keyboard.press("Alt+Shift+R");
    await page.waitForTimeout(SMOKE_SETTLE_MS);
    const mode3 = await readViewMode(page);
    if (mode3 !== "remastered") modeCycleOk = false;
    smokeNotes.push(`Alt+Shift+R 三态切换：remastered→${mode1 ?? "?"}→${mode2 ?? "?"}→${mode3 ?? "?"}`);

    // 功能开关：优先读 __WR_DEBUG__.features 镜像声明；无镜像时行为探测（探测到即验证，探测不到按未声明跳过）
    const declared = await readDeclaredFeatures(page);
    const palette = await probeShadowDialog(page, "palette");
    let paletteOk = true;
    if (declared.commandPalette === true) {
      paletteOk = palette.opened && palette.closedAfterEscape;
      smokeNotes.push(
        `commandPalette=true（镜像声明）：Ctrl+K ${palette.opened ? "唤起面板成功" : "未唤起面板（失败）"}，Escape ${
          palette.closedAfterEscape ? "关闭成功" : "未关闭（失败）"
        }`,
      );
    } else {
      smokeNotes.push(
        palette.opened
          ? "commandPalette 未声明：探测到可用面板，已完成打开/Escape 关闭验证"
          : "commandPalette 未声明：未检测到面板，跳过断言",
      );
    }
    const drawer = await probeShadowDialog(page, "drawer");
    let drawerOk = true;
    if (declared.diagnosticsDrawer === true) {
      drawerOk = drawer.opened && drawer.closedAfterEscape;
      smokeNotes.push(
        `diagnosticsDrawer=true（镜像声明）：Alt+Shift+X ${drawer.opened ? "唤起抽屉成功" : "未唤起抽屉（失败）"}，Escape ${
          drawer.closedAfterEscape ? "关闭成功" : "未关闭（失败）"
        }`,
      );
    } else {
      smokeNotes.push(
        drawer.opened
          ? "diagnosticsDrawer 未声明：探测到可用抽屉，已完成打开/Escape 关闭验证"
          : "diagnosticsDrawer 未声明：未检测到抽屉，跳过断言",
      );
    }
    const newErrors = errors.length - errorsBeforeSmoke;
    if (newErrors > 0) {
      smokeNotes.push(
        `烟测期间新增 ${newErrors} 条报错：${errors.slice(errorsBeforeSmoke, errorsBeforeSmoke + 3).join("；")}`,
      );
    }
    const gate5Passed = modeCycleOk && paletteOk && drawerOk && newErrors === 0;
    gates.push({
      gateName: "bridge-and-split-smoke",
      passed: gate5Passed,
      score: gate5Passed ? 10 : 0,
      details: smokeNotes.join("；"),
    });

    /* ---- Gate 6 portal-and-turbonav-integrity ---- */
    const portalSlots = route.portalSlots ?? [];
    let portalOk = true;
    const integrityNotes: string[] = [];
    if (portalSlots.length > 0) {
      const projected = await page.evaluate(inspectPortalContainers);
      const projectedOk = projected.containerCount > 0 && projected.withChildren === projected.containerCount;
      await setViewMode(page, "original");
      await page.waitForTimeout(PORTAL_RESTORE_WAIT_MS);
      const firstSelector = portalSlots[0]!.selectors[0]!;
      const returned = await page.evaluate(inspectPortalReturn, firstSelector);
      await setViewMode(page, "remastered");
      await page.waitForTimeout(SMOKE_SETTLE_MS);
      portalOk = projectedOk && returned.backInWrapper && returned.containersLeft === 0;
      integrityNotes.push(
        `portal[${portalSlots.map((slot) => slot.slotName).join(", ")}]：投影容器 ${projected.containerCount} 个（含活体节点 ${projected.withChildren} 个）；切 original ${PORTAL_RESTORE_WAIT_MS}ms 后归还=${returned.backInWrapper}，残留容器 ${returned.containersLeft} 个；已恢复 remastered`,
      );
    } else {
      integrityNotes.push("route.portalSlots 未声明：跳过传送门投影/归还断言");
    }
    let turboOk = true;
    if (options.contract.enableTurboNav === true) {
      // remastered 模式下原站 wrapper 位于视口外且 pointer-events:none，真实 hover 无法命中；
      // 先切 original 让原站回文档流再悬停首个同源链接验证预取，断言完恢复 remastered。
      await setViewMode(page, "original");
      await page.waitForTimeout(SMOKE_SETTLE_MS);
      const anchor = await page.evaluate(findFirstSameOriginAnchor);
      if (anchor === null) {
        turboOk = false;
        integrityNotes.push("TurboNav：#wr-origin-wrapper 内未找到同源 <a href>，预取无从触发");
      } else if ("selfOnly" in anchor) {
        integrityNotes.push("TurboNav：页面仅含自链接（TurboNav 同页规则正确放行），跳过预取断言");
      } else {
        await page.locator("#wr-origin-wrapper a[href]").nth(anchor.index).hover();
        await page.waitForTimeout(TURBO_HOVER_WAIT_MS);
        const fetchLog = await page.evaluate(readFetchLogInPage);
        const hit = fetchLog.some((logged) => isSameUrl(logged, anchor.href));
        turboOk = hit;
        integrityNotes.push(
          `TurboNav：悬停首个同源链接 ${anchor.href} ${TURBO_HOVER_WAIT_MS}ms，__WR_FETCH_LOG__ 共 ${fetchLog.length} 条，${
            hit ? "预取命中" : "未命中预取（失败）"
          }`,
        );
      }
      await setViewMode(page, "remastered");
    } else {
      integrityNotes.push("contract.enableTurboNav=false：跳过 TurboNav 预取断言");
    }
    const gate6Passed = portalOk && turboOk;
    const bothUndeclared = portalSlots.length === 0 && options.contract.enableTurboNav !== true;
    gates.push({
      gateName: "portal-and-turbonav-integrity",
      passed: gate6Passed,
      score: gate6Passed ? 10 : 0,
      details: bothUndeclared ? "契约未声明 portal/TurboNav" : integrityNotes.join("；"),
    });

    /* ---- Gate 7（不入 gates 数组）：VLM 终审 ---- */
    const afterPath = join(options.outDir, "after.png");
    if (captureScreenshots) await page.screenshot({ path: afterPath });
    let vlmScore = 0;
    let vlmFeedback = AGENT_NATIVE_FEEDBACK;
    let totalTokensUsed = 0;
    if (options.enableVlm && options.vlmCritic !== undefined) {
      const verdict = await options.vlmCritic(options.snapshot.beforeScreenshotPath, afterPath);
      vlmScore = verdict.score;
      vlmFeedback = verdict.feedback;
      totalTokensUsed = verdict.tokensUsed ?? 0;
    }

    const passed = gates.every((gate) => gate.passed) && (!options.enableVlm || vlmScore >= VLM_PASS_SCORE);
    const report = VerificationReportSchema.parse({
      siteId: options.snapshot.siteId,
      passed,
      repairRoundsUsed: 0,
      originalItemCount: options.snapshot.originalItemCountHint,
      remasteredItemCount: data.itemCount,
      dataParityRatio: Math.min(1, Math.max(0, ratio)),
      vlmScore,
      vlmFeedback,
      gates,
      extractorHealthSummary: health,
      totalTokensUsed,
      verifiedAt: new Date().toISOString(),
    });
    writeFileSync(join(options.outDir, REPORT_FILE_NAME), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    return report;
  } finally {
    await context.close().catch(() => undefined);
    if (ownsBrowser) await browser.close().catch(() => undefined);
  }
}
