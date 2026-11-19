/**
 * ResilientExtractor —— 4 级抗改版语义空间提取引擎 + 健康度遥测。
 *
 * Tier 1：selectors 优先级降级链（含同源 iframe 穿透，仅搜索子框架文档防误配）；
 * Tier 2：relativeTo 重定位（HN tr+tr / arXiv dt+dd 配对行场景）；
 * Tier 3：regexExtract 捕获组提取（对任意 Tier 命中的原文执行）；
 * Tier 4：spatialLabelRegex 空间邻近定位（<label for> → 同行下一 <td> → 右侧欧氏最近控件）。
 */
import { collectAccessibleRoots } from "./iframeBridge.js";

export interface FieldRule {
  fieldName: string;
  fieldType: "string" | "number" | "url" | "date" | "boolean" | "string[]";
  selectors: string[];
  relativeTo?: "self" | "next-sibling" | "parent";
  attribute: "textContent" | "href" | "src" | "value" | "innerHTML";
  regexExtract?: string;
  spatialLabelRegex?: string;
  required: boolean;
}

export interface FieldHealth {
  tier: 1 | 2 | 3 | 4;
  hits: number;
  misses: number;
  lastError?: string;
}

type Tier = 1 | 2 | 3 | 4;

export class HealthTracker {
  private readonly map = new Map<string, FieldHealth>();

  recordHit(fieldName: string, tier: Tier): void {
    const health = this.map.get(fieldName) ?? { tier, hits: 0, misses: 0 };
    health.tier = tier;
    health.hits += 1;
    this.map.set(fieldName, health);
  }

  recordMiss(fieldName: string, lastError?: string): void {
    const health = this.map.get(fieldName) ?? { tier: 1, hits: 0, misses: 0 };
    health.misses += 1;
    if (lastError) health.lastError = lastError;
    this.map.set(fieldName, health);
  }

  getHealth(fieldName: string): FieldHealth | undefined {
    return this.map.get(fieldName);
  }

  getAllHealth(): Record<string, FieldHealth> {
    const out: Record<string, FieldHealth> = {};
    for (const [key, value] of this.map) out[key] = { ...value };
    return out;
  }

  summary(): { totalFields: number; healthyFields: number; hitRate: number; tierBreakdown: Record<"1" | "2" | "3" | "4", number> } {
    let hits = 0;
    let misses = 0;
    let healthy = 0;
    const tierBreakdown: Record<"1" | "2" | "3" | "4", number> = { "1": 0, "2": 0, "3": 0, "4": 0 };
    for (const health of this.map.values()) {
      hits += health.hits;
      misses += health.misses;
      if (health.hits > 0) healthy += 1;
      tierBreakdown[String(health.tier) as "1" | "2" | "3" | "4"] += 1;
    }
    const total = hits + misses;
    return { totalFields: this.map.size, healthyFields: healthy, hitRate: total === 0 ? 1 : hits / total, tierBreakdown };
  }
}

const extractAttribute = (el: Element, attribute: string): string => {
  switch (attribute) {
    case "href":
      return (el as HTMLAnchorElement).href || el.getAttribute("href") || "";
    case "src":
      return (el as HTMLImageElement).src || el.getAttribute("src") || "";
    case "value": {
      const value = (el as HTMLInputElement).value;
      return value || el.getAttribute("value") || "";
    }
    case "innerHTML":
      return el.innerHTML ?? "";
    case "textContent":
    default:
      return (el.textContent ?? "").trim();
  }
};

const controlValue = (el: Element): string => {
  const value = (el as HTMLInputElement).value;
  return value || (el.textContent ?? "").trim();
};

/** Tier 4：空间邻近定位（JSDOM 全零矩形时自动跳过几何判定） */
const extractSpatial = (baseEl: Element | ParentNode, pattern: string, setLastError: (msg: string) => void): string | null => {
  const doc = baseEl instanceof Element ? baseEl.ownerDocument : (baseEl as Document);
  if (!doc || !doc.body) return null;
  let regex: RegExp;
  try {
    regex = new RegExp(pattern);
  } catch {
    setLastError("spatialLabelRegex 非法正则");
    return null;
  }
  const labels: Text[] = [];
  try {
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const text = node as Text;
      if (text.nodeValue && regex.test(text.nodeValue.trim())) labels.push(text);
      node = walker.nextNode();
    }
  } catch {
    return null;
  }
  for (const labelNode of labels) {
    const labelEl = labelNode.parentElement;
    if (!labelEl) continue;
    // (a) <label for="id"> 直连控件
    const labelWrap = labelEl.closest("label");
    if (labelWrap) {
      const forId = labelWrap.getAttribute("for");
      if (forId) {
        const control = doc.getElementById(forId);
        if (control) {
          const value = controlValue(control);
          if (value) return value;
        }
      }
    }
    // (b) 同一表格行的下一个单元格内的控件
    const cell = labelEl.closest("td,th");
    if (cell) {
      const nextCell = cell.nextElementSibling;
      if (nextCell) {
        const control = nextCell.querySelector("input,select,textarea");
        if (control) {
          const value = controlValue(control);
          if (value) return value;
        }
      }
    }
  }
  // (c) 右侧欧氏距离最近的交互控件（几何信息不可用时跳过）
  const labelRects = labels
    .map((label) => label.parentElement?.getBoundingClientRect())
    .filter((rect): rect is DOMRect => !!rect && (rect.width > 0 || rect.height > 0));
  if (labelRects.length === 0) return null;
  let best: { el: Element; dist: number } | null = null;
  for (const control of Array.from(doc.querySelectorAll("input,select,textarea,button"))) {
    if (control instanceof HTMLInputElement && (control.type === "hidden" || control.disabled)) continue;
    if (control instanceof HTMLButtonElement && control.disabled) continue;
    if (control instanceof HTMLSelectElement && control.disabled) continue;
    if (control instanceof HTMLTextAreaElement && control.disabled) continue;
    const rect = control.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    for (const labelRect of labelRects) {
      const dx = rect.left - labelRect.right;
      const dy = Math.abs(rect.top + rect.height / 2 - (labelRect.top + labelRect.height / 2));
      if (dx > 0 && dy < 40) {
        const dist = Math.hypot(dx, dy);
        if (!best || dist < best.dist) best = { el: control, dist };
      }
    }
  }
  if (best) {
    const value = controlValue(best.el);
    if (value) return value;
  }
  return null;
};

export function extractFieldWithCascade(baseEl: Element | ParentNode, rule: FieldRule, healthTracker?: HealthTracker): string | null {
  let lastError: string | undefined;
  const setLastError = (msg: string): void => {
    lastError = msg;
  };

  // 统一收口：对命中原文应用 Tier 3 regexExtract，成功记 hit 并返回
  const finish = (raw: string | null, tier: Tier): string | null => {
    if (raw === null || raw.length === 0) return null;
    if (rule.regexExtract) {
      try {
        const match = new RegExp(rule.regexExtract).exec(raw);
        if (!match) {
          setLastError("regexExtract 未命中");
          return null;
        }
        const out = (match[1] ?? match[0] ?? "").trim();
        if (!out) {
          setLastError("regexExtract 捕获组为空");
          return null;
        }
        healthTracker?.recordHit(rule.fieldName, tier);
        return out;
      } catch {
        setLastError("regexExtract 非法正则");
        return null;
      }
    }
    healthTracker?.recordHit(rule.fieldName, tier);
    return raw;
  };

  const selectorSearch = (root: Element | ParentNode, allowSelfMatch: boolean): Element | null => {
    for (const selector of rule.selectors) {
      let el: Element | null = null;
      try {
        el = root.querySelector(selector);
      } catch {
        el = null; // 非法选择器跳过
      }
      if (!el && allowSelfMatch && root instanceof Element) {
        try {
          if (root.matches(selector)) el = root;
        } catch {
          /* matches 失败忽略 */
        }
      }
      if (el) return el;
    }
    return null;
  };

  // Tier 1：原位 selector 降级链（relativeTo 未设或 self 时）
  if ((rule.relativeTo ?? "self") === "self") {
    const el = selectorSearch(baseEl, true);
    if (el) {
      const result = finish(extractAttribute(el, rule.attribute), 1);
      if (result !== null) return result;
    }
    // iframe 穿透：仅搜索同源子框架文档（排除 baseEl 自身所在文档，防止全文档误配）
    if (baseEl instanceof Element && baseEl.ownerDocument) {
      const ownDoc = baseEl.ownerDocument;
      let roots: DocumentOrShadowRoot[] = [];
      try {
        roots = collectAccessibleRoots(ownDoc.body ?? ownDoc.documentElement);
      } catch {
        roots = [];
      }
      for (const root of roots) {
        if (root === ownDoc) continue;
        const frameEl = selectorSearch(root as Document, false);
        if (frameEl) {
          const result = finish(extractAttribute(frameEl, rule.attribute), 1);
          if (result !== null) return result;
        }
      }
    }
  }

  // Tier 2：relativeTo 重定位（next-sibling / parent）
  if ((rule.relativeTo ?? "self") !== "self" && baseEl instanceof Element) {
    const newBase = rule.relativeTo === "next-sibling" ? baseEl.nextElementSibling : baseEl.parentElement;
    if (newBase) {
      const el = selectorSearch(newBase, true);
      if (el) {
        const result = finish(extractAttribute(el, rule.attribute), 2);
        if (result !== null) return result;
      }
    }
  }

  // Tier 4：空间邻近定位（前 3 级未命中且配置了 spatialLabelRegex）
  if (rule.spatialLabelRegex) {
    const spatial = extractSpatial(baseEl, rule.spatialLabelRegex, setLastError);
    if (spatial) {
      const result = finish(spatial, 4);
      if (result !== null) return result;
    }
  }

  healthTracker?.recordMiss(rule.fieldName, lastError);
  return null;
}
