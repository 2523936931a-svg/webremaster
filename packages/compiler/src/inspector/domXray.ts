/// <reference lib="dom" />
/**
 * DOM X-Ray 测绘器（编译器前置：站点快照的唯一采集入口）。
 *
 * 用 Playwright 打开目标页并产出 @webremaster/schema 的 SiteSnapshot：
 * - domSkeletonHtml：结构骨架，≤16KB，分级裁剪（L0→L4 剥脚本/样式/注释/长文本，
 *   仍超预算时从 body 尾部逐棵丢弃子树，绝不输出被截断的半个标签）；
 * - repeatedGroups：重复组检测，支持 dt-dd-pair（定义列表）、paired-next-sibling
 *   （HN 式 `tr.athing + tr` 相邻行配对）与 single（同签名子项列表）；
 * - interactiveElements：链接/表单控件/按钮/canvas/iframe，标注 CSRF 隐藏域、
 *   验证码特征与包围盒；同源 iframe 内的元素带 frameId；
 * - 追踪拦截：已知 analytics/tracker 域名与路径特征的子资源请求一律 abort，
 *   主文档导航除外（保证测绘目标本身可达）；
 * - before.png：全页截图，落在 outDir 下。
 *
 * 浏览器策略：内置 Chromium → 系统 Chrome → 系统 Edge 依次回退。
 * 所有 DOM 遍历都在 page.evaluate 内完成（Node 侧无 DOM 依赖），in-page
 * 函数自包含（不引用模块级变量），可被 Playwright 原样序列化执行。
 */

import { chromium, type Browser, type LaunchOptions } from "playwright";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  SiteSnapshotSchema,
  type InteractiveElement,
  type RepeatedGroup,
  type SameOriginFrame,
  type SiteSnapshot,
  type Viewport,
} from "@webremaster/schema";

/** 传递给 in-page 测绘函数的参数（必须可结构化克隆）。 */
interface SurveyArgs {
  scope: "main" | "frame";
  skeletonBudgetBytes: number;
  maxGroups: number;
  maxInteractiveElements: number;
}

/** in-page 测绘函数的返回结构（JSON 化的 DOM 勘察结果）。 */
interface SurveyResult {
  groups: RepeatedGroup[];
  interactives: InteractiveElement[];
  skeletonHtml: string;
  hasFramesetOrIframes: boolean;
}

/** mapSite 的全部选项。 */
export interface DomXrayOptions {
  /** 目标页地址，仅支持 http/https。 */
  url: string;
  /** before.png 输出目录（不存在会递归创建）。 */
  outDir: string;
  /** 覆盖 siteId；默认由 hostname slug 化（如 127.0.0.1 → 127-0-0-1）。 */
  siteId?: string;
  /** Playwright 登录态 storageState.json 路径（wr auth-record 产物），注入 Cookie 后测绘私有页面。 */
  storageStatePath?: string;
  /** 代理服务器地址（如 http://127.0.0.1:7897），透传给 Chromium launch。 */
  proxy?: string;
  /** 视口尺寸，默认 1280×720。 */
  viewport?: Viewport;
  /** 骨架字节预算，默认 16KB（与 SiteSnapshotSchema 校验一致）。 */
  skeletonBudgetBytes?: number;
  /** load 事件后的稳定等待毫秒数，默认 400。 */
  settleMs?: number;
  /** 导航超时毫秒数；超时不视为失败（以已加载内容继续测绘），默认 30000。 */
  gotoTimeoutMs?: number;
  /** 复用外部浏览器实例（不注入则内部启动并负责关闭）。 */
  browser?: Browser;
  /** 重复组上限，默认 12。 */
  maxGroups?: number;
  /** 每个文档（主文档 / frame）交互元素上限，默认 60。 */
  maxInteractiveElements?: number;
  /** 追踪请求被 abort 时回调（URL），供调用方审计。 */
  onBlockedRequest?: (url: string) => void;
}

/** 追踪/分析类主机后缀（hostname 精确等于或以其结尾即命中）。 */
const TRACKER_HOST_SUFFIXES: readonly string[] = [
  "google-analytics.com",
  "googletagmanager.com",
  "googlesyndication.com",
  "doubleclick.net",
  "connect.facebook.net",
  "graph.facebook.com",
  "hotjar.com",
  "mixpanel.com",
  "segment.io",
  "segment.com",
  "clarity.ms",
  "quantserve.com",
  "scorecardresearch.com",
  "crwdcntrl.net",
  "adnxs.com",
  "criteo.com",
  "criteo.net",
  "taboola.com",
  "outbrain.com",
  "sharethis.com",
  "addthis.com",
  "branch.io",
  "amplitude.com",
  "fullstory.com",
  "fullstory.io",
  "newrelic.com",
  "nr-data.net",
  "mc.yandex.ru",
  "cnzz.com",
  "umeng.com",
  "matomo.cloud",
  "sentry.io",
  "sentry-cdn.com",
  "statcounter.com",
  "histats.com",
  "alexametrics.com",
];

/** 追踪/分析类路径特征（pathname+search 的子串，大小写不敏感）。 */
const TRACKER_PATH_HINTS: readonly string[] = [
  "/analytics",
  "/tracker",
  "/telemetry",
  "/beacon",
  "/collect",
  "/pageview",
  "/pixel",
  "/__utm.gif",
  "gtag/js",
  "analytics.js",
  "hm.js",
  "hm.gif",
  "matomo.php",
  "piwik.php",
];

/**
 * 判断一个 URL 是否命中追踪特征。命中且非主文档导航的请求会被测绘器 abort。
 */
export function isTrackerUrl(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const hostname = parsed.hostname.toLowerCase();
  for (const suffix of TRACKER_HOST_SUFFIXES) {
    if (hostname === suffix || hostname.endsWith(`.${suffix}`)) return true;
  }
  const pathAndQuery = `${parsed.pathname}?${parsed.search}`.toLowerCase();
  return TRACKER_PATH_HINTS.some((hint) => pathAndQuery.includes(hint));
}

/** hostname → kebab-case siteId（满足 SITE_ID_PATTERN，空串兜底 "site"）。 */
export function slugifySiteId(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "site";
}

/** frame URL 是否为与主站同源的 http(s) 地址。 */
function isSameOriginHttp(frameUrl: string, baseUrl: URL): boolean {
  try {
    const parsed = new URL(frameUrl);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.origin === baseUrl.origin;
  } catch {
    return false;
  }
}

/**
 * in-page 测绘主函数。scope=main 在主文档执行（全量），
 * scope=frame 在同源 iframe 内执行（仅骨架 + 交互元素）。
 * 自包含：不引用任何模块级变量，Playwright 按源码序列化后在页面内运行。
 */
function surveyDocument(args: SurveyArgs): SurveyResult {
  const isMain = args.scope === "main";
  const XHTML_NS = "http://www.w3.org/1999/xhtml";

  const escapeHtmlText = (value: string): string =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const escapeHtmlAttr = (value: string): string =>
    value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

  const escapeSelector = (value: string): string => {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
    return value.replace(/([^a-zA-Z0-9_\u00A0-\uFFFF-])/g, "\\$1");
  };

  /** 尽量短且稳定的选择器：id 快路径，否则逐级带上 tag+前两个 class，重复 tag 加 nth-of-type。 */
  const uniqueSelector = (el: Element): string => {
    const idAttr = el.getAttribute("id");
    if (idAttr) {
      const idSelector = `#${escapeSelector(idAttr)}`;
      try {
        if (document.querySelectorAll(idSelector).length === 1) return idSelector;
      } catch {
        /* 非法选择器则继续走路径法 */
      }
    }
    const parts: string[] = [];
    let current: Element | null = el;
    while (current) {
      const tag = current.localName;
      let part = tag;
      const currentId = current.getAttribute("id");
      if (currentId) {
        parts.unshift(`#${escapeSelector(currentId)}`);
        break;
      }
      const classes = Array.from(current.classList).slice(0, 2);
      if (classes.length > 0) part += classes.map((c) => `.${escapeSelector(c)}`).join("");
      const parent: Element | null = current.parentElement;
      if (parent) {
        const sameTag = Array.from(parent.children).filter((c) => c.localName === tag);
        if (sameTag.length > 1) part += `:nth-of-type(${sameTag.indexOf(current) + 1})`;
      }
      parts.unshift(part);
      current = parent;
    }
    return parts.join(" > ");
  };

  /** 结构签名：tag + 第一个 class（无 class 退化为纯 tag）。 */
  const sigOf = (el: Element): string => {
    const firstClass = el.classList.length > 0 ? el.classList[0] : "";
    return firstClass ? `${el.localName}.${firstClass}` : el.localName;
  };

  const sigHasClass = (sig: string): boolean => sig.includes(".");

  const sigToSelector = (sig: string): string => {
    const dotIndex = sig.indexOf(".");
    if (dotIndex < 0) return sig;
    return `${sig.slice(0, dotIndex)}.${escapeSelector(sig.slice(dotIndex + 1))}`;
  };

  const slugifyGroupId = (itemSelector: string): string => {
    const slug = itemSelector
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return `grp-${slug.length > 0 ? slug : "group"}`.slice(0, 80);
  };

  /** 超长样本截断到安全位置（回退到上一个完整标签），绝不留下半个标签。 */
  const trimSampleHtml = (html: string, maxLength = 1200): string => {
    if (html.length <= maxLength) return html;
    const cut = html.slice(0, maxLength);
    const lastTagOpen = cut.lastIndexOf("<");
    return `${lastTagOpen > 0 ? cut.slice(0, lastTagOpen) : cut}<!--wr:truncated-->`;
  };

  const detectGroups = (maxGroups: number): RepeatedGroup[] => {
    const ITEM_SKIP_TAGS = new Set(["script", "style", "noscript", "template", "br", "wbr"]);
    const CONTAINER_SKIP_TAGS = new Set(["dl", "form", "label", "select", "optgroup", "datalist"]);
    const groups: RepeatedGroup[] = [];
    const seenItemSelectors = new Set<string>();
    const toSample = (items: Element[]): string[] =>
      items.slice(0, 3).map((item) => trimSampleHtml(item.outerHTML));

    // ① dt-dd 定义列表对（arXiv 式）。
    for (const dl of Array.from(document.querySelectorAll("dl"))) {
      const dts = Array.from(dl.children).filter((child) => child.localName === "dt");
      if (dts.length < 3) continue;
      const containerSelector = uniqueSelector(dl);
      const itemSelector = `${containerSelector} > dt`;
      if (seenItemSelectors.has(itemSelector)) continue;
      seenItemSelectors.add(itemSelector);
      groups.push({
        groupId: slugifyGroupId(itemSelector),
        containerSelector,
        itemSelector,
        pairingMode: "dt-dd-pair",
        companionSelector: `${containerSelector} > dt + dd`,
        totalCount: dts.length,
        sampleItemsHtml: toSample(dts),
      });
    }

    // ② 通用扫描：相邻兄弟配对（HN 式 tr.athing + tr）与同签名单组。
    for (const parent of Array.from(document.querySelectorAll("body *"))) {
      if (parent.namespaceURI !== null && parent.namespaceURI !== XHTML_NS) continue;
      if (CONTAINER_SKIP_TAGS.has(parent.localName)) continue;
      const children = Array.from(parent.children);
      if (children.length < 3) continue;

      const buckets = new Map<string, Element[]>();
      for (const child of children) {
        if (ITEM_SKIP_TAGS.has(child.localName)) continue;
        const sig = sigOf(child);
        const bucket = buckets.get(sig);
        if (bucket) bucket.push(child);
        else buckets.set(sig, [child]);
      }
      const qualifying = Array.from(buckets.entries()).filter(([, els]) => els.length >= 3);
      if (qualifying.length === 0) continue;
      const containerSelector = uniqueSelector(parent);
      const consumedSigs = new Set<string>();

      interface PairCandidate {
        sig: string;
        els: Element[];
        compSig: string;
        firstIndex: number;
      }
      const candidates: PairCandidate[] = [];
      for (const [sig, els] of qualifying) {
        const compSigs = els.map((el) => {
          const next = el.nextElementSibling;
          return next ? sigOf(next) : null;
        });
        const first = compSigs[0];
        if (
          compSigs.every((s) => s !== null && s !== sig) &&
          first !== null &&
          new Set(compSigs).size === 1
        ) {
          candidates.push({ sig, els, compSig: first, firstIndex: children.indexOf(els[0]) });
        }
      }

      const addPaired = (cand: PairCandidate): void => {
        const itemSelector = `${containerSelector} > ${sigToSelector(cand.sig)}`;
        if (seenItemSelectors.has(itemSelector)) return;
        seenItemSelectors.add(itemSelector);
        consumedSigs.add(cand.sig);
        consumedSigs.add(cand.compSig);
        const dotIndex = cand.compSig.indexOf(".");
        const companionTag = dotIndex >= 0 ? cand.compSig.slice(0, dotIndex) : cand.compSig;
        groups.push({
          groupId: slugifyGroupId(itemSelector),
          containerSelector,
          itemSelector,
          pairingMode: "paired-next-sibling",
          companionSelector: `${containerSelector} > ${sigToSelector(cand.sig)} + ${companionTag}`,
          totalCount: cand.els.length,
          sampleItemsHtml: toSample(cand.els),
        });
      };

      // 互为镜像的配对方向只留一个：优先「item 带 class、companion 无 class」，
      // 打平时取首个实例在文档中更靠前的一侧（HN：tr.athing 在前）。
      const taken = new Set<number>();
      for (let i = 0; i < candidates.length; i++) {
        if (taken.has(i)) continue;
        const cand = candidates[i];
        let inverseIndex = -1;
        for (let j = i + 1; j < candidates.length; j++) {
          if (taken.has(j)) continue;
          const other = candidates[j];
          if (other.sig === cand.compSig && other.compSig === cand.sig) {
            inverseIndex = j;
            break;
          }
        }
        if (inverseIndex >= 0) {
          const inverse = candidates[inverseIndex];
          const candPreferred = sigHasClass(cand.sig) && !sigHasClass(cand.compSig);
          const inversePreferred = sigHasClass(inverse.sig) && !sigHasClass(inverse.compSig);
          const winner =
            candPreferred === inversePreferred
              ? cand.firstIndex <= inverse.firstIndex
                ? cand
                : inverse
              : candPreferred
                ? cand
                : inverse;
          addPaired(winner);
          taken.add(i);
          taken.add(inverseIndex);
        } else {
          addPaired(cand);
          taken.add(i);
        }
      }

      // ③ 剩余同签名子项 → single。多个候选签名并存时，要求覆盖过半子项，过滤噪声。
      for (const [sig, els] of qualifying) {
        if (consumedSigs.has(sig)) continue;
        if (qualifying.length > 1 && els.length < children.length / 2) continue;
        const itemSelector = `${containerSelector} > ${sigToSelector(sig)}`;
        if (seenItemSelectors.has(itemSelector)) continue;
        seenItemSelectors.add(itemSelector);
        groups.push({
          groupId: slugifyGroupId(itemSelector),
          containerSelector,
          itemSelector,
          pairingMode: "single",
          totalCount: els.length,
          sampleItemsHtml: toSample(els),
        });
      }
    }

    groups.sort((a, b) => b.totalCount - a.totalCount);
    return groups.slice(0, maxGroups);
  };

  const buildInteractives = (limit: number): InteractiveElement[] => {
    const CAPTCHA_PATTERN = /captcha|recaptcha|hcaptcha|turnstile|challenge/i;
    const results: InteractiveElement[] = [];
    const nodes = Array.from(
      document.querySelectorAll("a[href], button, input, select, textarea, canvas, iframe[src], frame[src]"),
    );
    for (const el of nodes) {
      if (results.length >= limit) break;
      if (el.namespaceURI !== null && el.namespaceURI !== XHTML_NS) continue;
      const tag = el.localName;
      if (el instanceof HTMLInputElement && el.type === "hidden") continue;

      const idAttr = el.getAttribute("id") ?? "";
      const nameAttr = el.getAttribute("name") ?? "";
      const typeAttr = tag === "input" || tag === "button" ? (el.getAttribute("type") ?? undefined) : undefined;
      const srcAttr = el.getAttribute("src") ?? "";
      const form = el.closest("form");
      const hiddenCount = form ? form.querySelectorAll('input[type="hidden"]').length : 0;
      const isCaptchaOrCanvas =
        tag === "canvas" || CAPTCHA_PATTERN.test(`${idAttr} ${el.getAttribute("class") ?? ""} ${nameAttr} ${srcAttr}`);

      let label = el.getAttribute("aria-label") ?? "";
      if (!label) label = el.getAttribute("placeholder") ?? "";
      if (!label && (tag === "button" || typeAttr === "submit")) label = el.getAttribute("value") ?? "";
      if (!label && nameAttr) label = nameAttr;
      if (!label) {
        const text = (el.textContent ?? "").trim();
        if (text.length > 0) label = text.length > 80 ? `${text.slice(0, 77)}…` : text;
      }
      if (!label && tag === "a") label = el.getAttribute("href") ?? "";
      if (!label) label = tag;

      const selectors: string[] = [];
      if (idAttr) selectors.push(`#${escapeSelector(idAttr)}`);
      if (nameAttr) {
        selectors.push(`${tag}[name="${nameAttr.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`);
      }
      if (typeAttr) selectors.push(`${tag}[type="${typeAttr}"]`);
      selectors.push(uniqueSelector(el));
      const dedupedSelectors = Array.from(new Set(selectors));

      const rect = el.getBoundingClientRect();
      results.push({
        id: idAttr || `${tag}-${results.length}`,
        tag,
        role: el.getAttribute("role") ?? undefined,
        type: typeAttr,
        label,
        selectors: dedupedSelectors,
        formAction: form ? (form.getAttribute("action") ?? undefined) : undefined,
        formMethod: form ? ((form.getAttribute("method") ?? "").toUpperCase() || undefined) : undefined,
        hasCsrfOrHiddenInputs: hiddenCount > 0,
        isCaptchaOrCanvas,
        boundingBox:
          rect.width > 0 && rect.height > 0
            ? {
                x: Math.round(rect.x * 100) / 100,
                y: Math.round(rect.y * 100) / 100,
                width: Math.round(rect.width * 100) / 100,
                height: Math.round(rect.height * 100) / 100,
              }
            : undefined,
      });
    }
    return results;
  };

  const buildSkeleton = (budgetBytes: number): string => {
    const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr", "frame"]);
    const SKIP_TAGS = new Set(["script", "noscript", "style", "link", "meta", "template", "svg", "embed", "object", "base", "title"]);
    // 分级裁剪：文本上限逐步收紧、属性白名单逐步收窄（value 一律不带，防泄漏）。
    const LEVELS = [
      { textCap: 64, attrs: ["id", "class", "href", "src", "action", "method", "name", "type", "role", "title", "alt"] },
      { textCap: 24, attrs: ["id", "class", "href", "src", "action", "method", "name", "type", "role", "alt"] },
      { textCap: 12, attrs: ["id", "href", "src", "action", "method", "type"] },
      { textCap: 6, attrs: ["id", "src", "action"] },
    ];

    const prune = (root: Element, textCap: number, allowedAttrs: string[]): void => {
      const allowed = new Set(allowedAttrs);
      const walk = (el: Element): void => {
        for (const child of Array.from(el.childNodes)) {
          if (child.nodeType === Node.ELEMENT_NODE) {
            const elementChild = child as Element;
            if (SKIP_TAGS.has(elementChild.localName)) {
              elementChild.remove();
              continue;
            }
            walk(elementChild);
          } else if (child.nodeType === Node.TEXT_NODE) {
            const raw = (child.nodeValue ?? "").trim();
            if (raw.length === 0) {
              child.remove();
              continue;
            }
            child.nodeValue = raw.length > textCap ? `${raw.slice(0, Math.max(textCap - 1, 1))}…` : raw;
          } else {
            child.remove();
          }
        }
        for (const attr of Array.from(el.attributes)) {
          if (!allowed.has(attr.name)) el.removeAttribute(attr.name);
        }
      };
      walk(root);
    };

    const serialize = (el: Element): string => {
      const tag = el.localName;
      const attrText = Array.from(el.attributes)
        .map((attr) => ` ${attr.name}="${escapeHtmlAttr(attr.value)}"`)
        .join("");
      if (VOID_TAGS.has(tag)) return `<${tag}${attrText}>`;
      const inner = Array.from(el.childNodes)
        .map((node) =>
          node.nodeType === Node.ELEMENT_NODE ? serialize(node as Element) : escapeHtmlText(node.nodeValue ?? ""),
        )
        .join("");
      return `<${tag}${attrText}>${inner}</${tag}>`;
    };

    const withCropMarker = (html: string, level: string): string =>
      /^<html/i.test(html)
        ? html.replace(/^<html/i, `<html data-wr-crop="${level}"`)
        : `<!--wr:crop=${level}-->${html}`;

    const source = document.documentElement;
    for (let level = 0; level < LEVELS.length; level++) {
      const config = LEVELS[level];
      const clone = source.cloneNode(true) as Element;
      prune(clone, config.textCap, config.attrs);
      const html = serialize(clone);
      if (new TextEncoder().encode(html).length <= budgetBytes) return withCropMarker(html, `L${level}`);
    }

    // L4：文本与属性已压到最省仍超预算 → 从 body 尾部整棵丢弃子树直到达标。
    const deepest = LEVELS[LEVELS.length - 1];
    const clone = source.cloneNode(true) as Element;
    prune(clone, deepest.textCap, deepest.attrs);
    const body = clone.querySelector("body") ?? clone;
    let html = serialize(clone);
    while (new TextEncoder().encode(html).length > budgetBytes) {
      const last = body.lastElementChild;
      if (!last) return '<html data-wr-crop="L5"><head></head><body></body></html>';
      last.remove();
      html = serialize(clone);
    }
    return withCropMarker(html, "L4");
  };

  const interactives = buildInteractives(args.maxInteractiveElements);
  const skeletonHtml = buildSkeleton(args.skeletonBudgetBytes);
  const hasFramesetOrIframes = isMain ? document.querySelector("frameset, iframe, frame") !== null : false;
  const groups = isMain ? detectGroups(args.maxGroups) : [];
  return { groups, interactives, skeletonHtml, hasFramesetOrIframes };
}

/**
 * 启动测绘浏览器：内置 Chromium（需已 download）→ 系统 Chrome → 系统 Edge，
 * 全部失败时抛出带原因清单的错误；可传代理服务器（如 http://127.0.0.1:7897）。
 */
export async function launchSurveyBrowser(proxy?: string): Promise<Browser> {
  const withProxy = (extra: LaunchOptions): LaunchOptions =>
    proxy === undefined ? extra : { ...extra, proxy: { server: proxy } };
  const attempts: LaunchOptions[] = [withProxy({}), withProxy({ channel: "chrome" }), withProxy({ channel: "msedge" })];
  const failures: string[] = [];
  for (const attempt of attempts) {
    try {
      return await chromium.launch(attempt);
    } catch (error) {
      failures.push(`${JSON.stringify(attempt)} → ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`DOM X-Ray 无法启动浏览器（已尝试内置 Chromium / 系统 Chrome / 系统 Edge）：\n${failures.join("\n")}`);
}

/**
 * 测绘一个页面并返回通过 SiteSnapshotSchema 校验的快照。
 * 流程：开上下文 → 装追踪拦截路由 → 导航（超时容忍）→ in-page 勘察 →
 * 遍历同源 frame 复勘 → 全页截图 before.png → 组装并 parse 校验。
 */
/** 规格入口名（Step 3 CLI 的 wr inspect 调用面），与 mapSite 等价。 */
export const inspectSite = mapSite;

export async function mapSite(options: DomXrayOptions): Promise<SiteSnapshot> {
  const target = new URL(options.url);
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new Error(`DOM X-Ray 仅支持 http/https 地址，收到：${options.url}`);
  }
  const siteId = options.siteId ?? slugifySiteId(target.hostname);
  const viewport = options.viewport ?? { width: 1280, height: 720 };
  const skeletonBudgetBytes = options.skeletonBudgetBytes ?? 16 * 1024;
  const settleMs = options.settleMs ?? 400;
  const gotoTimeoutMs = options.gotoTimeoutMs ?? 30000;
  const maxGroups = options.maxGroups ?? 12;
  const maxInteractiveElements = options.maxInteractiveElements ?? 60;

  const browser = options.browser ?? (await launchSurveyBrowser(options.proxy));
  const ownsBrowser = options.browser === undefined;
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    ...(options.storageStatePath !== undefined ? { storageState: options.storageStatePath } : {}),
  });
  try {
    const page = await context.newPage();
    await context.route("**/*", async (route) => {
      const request = route.request();
      try {
        // 主文档导航永不拦截，保证测绘目标可达；其余命中追踪特征的子资源一律 abort。
        const isMainNavigation = request.resourceType() === "document" && request.frame() === page.mainFrame();
        if (!isMainNavigation && isTrackerUrl(request.url())) {
          options.onBlockedRequest?.(request.url());
          await route.abort();
          return;
        }
        await route.continue();
      } catch {
        /* 页面/上下文销毁期的竞态，忽略 */
      }
    });
    try {
      await page.goto(target.href, { waitUntil: "load", timeout: gotoTimeoutMs }).catch((error: unknown) => {
        if (error instanceof Error && error.name === "TimeoutError") return;
        throw error;
      });
      if (settleMs > 0) await page.waitForTimeout(settleMs);

      const title = await page.title();
      const surveyArgs: SurveyArgs = { scope: "main", skeletonBudgetBytes, maxGroups, maxInteractiveElements };
      const survey = await page.evaluate(surveyDocument, surveyArgs);

      const sameOriginFrames: SameOriginFrame[] = [];
      const frameInteractives: InteractiveElement[] = [];
      const usedFrameIds = new Set<string>();
      let frameIndex = 0;
      for (const frame of page.frames()) {
        if (frame === page.mainFrame()) continue;
        frameIndex += 1;
        const frameUrl = frame.url();
        if (!isSameOriginHttp(frameUrl, target)) continue;
        let frameId = `frame-${frameIndex}`;
        let frameTitle = frame.name();
        try {
          const element = await frame.frameElement();
          const idAttr = await element.getAttribute("id");
          const nameAttr = await element.getAttribute("name");
          const titleAttr = await element.getAttribute("title");
          frameTitle = titleAttr ?? frameTitle;
          const baseId = idAttr ?? nameAttr ?? frameId;
          frameId = usedFrameIds.has(baseId) ? `${baseId}-${frameIndex}` : baseId;
          await element.dispose();
        } catch {
          /* frameElement 不可得时沿用兜底 id */
        }
        while (usedFrameIds.has(frameId)) frameId = `${frameId}-dup`;
        usedFrameIds.add(frameId);
        try {
          const frameArgs: SurveyArgs = { scope: "frame", skeletonBudgetBytes, maxGroups: 0, maxInteractiveElements };
          const payload = await frame.evaluate(surveyDocument, frameArgs);
          sameOriginFrames.push({ frameId, src: frameUrl, title: frameTitle, skeletonHtml: payload.skeletonHtml });
          for (const interactive of payload.interactives) {
            frameInteractives.push({ ...interactive, frameId });
          }
        } catch {
          /* frame 未就绪或已跳转：跳过该 frame */
        }
      }

      const outDir = resolve(options.outDir);
      await mkdir(outDir, { recursive: true });
      const screenshotPath = join(outDir, "before.png");
      await page.screenshot({ path: screenshotPath, fullPage: true });

      return SiteSnapshotSchema.parse({
        siteId,
        url: target.href,
        matchPatterns: [`${target.origin}/*`],
        capturedAt: new Date().toISOString(),
        title,
        viewport,
        hasFramesetOrIframes: survey.hasFramesetOrIframes || page.frames().length > 1,
        sameOriginFrames,
        domSkeletonHtml: survey.skeletonHtml,
        repeatedGroups: survey.groups,
        interactiveElements: [...survey.interactives, ...frameInteractives],
        // 主列表条数提示 = 最大重复组的 totalCount（对账基准；求和会把导航/分页等次组混入）
        originalItemCountHint: survey.groups.length > 0 ? Math.max(...survey.groups.map((group) => group.totalCount)) : 0,
        beforeScreenshotPath: screenshotPath,
      });
    } finally {
      await page.close().catch(() => undefined);
    }
  } finally {
    await context.close().catch(() => undefined);
    if (ownsBrowser) await browser.close().catch(() => undefined);
  }
}
