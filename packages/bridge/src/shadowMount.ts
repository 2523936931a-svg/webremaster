/**
 * ShadowMount —— Shadow DOM 完美样式隔离挂载器。
 *
 * <web-remaster-root> 以 all:initial 与原站样式完全隔离；
 * Tailwind v4 的 @property 声明必须提升到主文档 head（Shadow DOM 内不生效），
 * 其余样式优先走 constructable stylesheet（adoptedStyleSheets），
 * 环境不支持时（如 JSDOM 未实现 replaceSync）降级为 Shadow Root 内部 <style>。
 */

export interface ShadowMountResult {
  host: HTMLElement;
  shadowRoot: ShadowRoot;
}

/** 精准匹配一个完整的 @property 声明块 */
const AT_PROPERTY_RULE_RE = /@property\s+--[a-zA-Z0-9_-]+\s*\{[^}]*\}/g;

const HOST_STYLE_CSS =
  "web-remaster-root{all:initial;display:block;min-height:100vh;position:relative;z-index:2147483640;}";

export function extractCssAtPropertyRules(cssText: string): string[] {
  if (typeof cssText !== "string" || cssText.length === 0) return [];
  return cssText.match(AT_PROPERTY_RULE_RE) ?? [];
}

/** head 内幂等注入 host 基础样式（重复挂载不重复注入） */
const ensureHostStyle = (): void => {
  if (typeof document === "undefined") return;
  if (document.querySelector("style[data-wr-host-style]")) return;
  const styleEl = document.createElement("style");
  styleEl.setAttribute("data-wr-host-style", "");
  styleEl.textContent = HOST_STYLE_CSS;
  const parent = document.head ?? document.documentElement;
  parent?.appendChild(styleEl);
};

/** @property 块幂等合并进 head 的 <style data-wr-tw-props>（按规则原文去重） */
const mergeAtPropertyRules = (rules: string[]): void => {
  if (rules.length === 0 || typeof document === "undefined") return;
  let styleEl = document.querySelector<HTMLStyleElement>("style[data-wr-tw-props]");
  if (!styleEl) {
    const created = document.createElement("style");
    created.setAttribute("data-wr-tw-props", "");
    const parent = document.head ?? document.documentElement;
    parent?.appendChild(created);
    styleEl = created;
  }
  const known = new Set(extractCssAtPropertyRules(styleEl.textContent ?? ""));
  const missing = rules.filter((rule) => !known.has(rule));
  if (missing.length === 0) return;
  const base = (styleEl.textContent ?? "").trim();
  styleEl.textContent = base.length > 0 ? `${base}\n${missing.join("\n")}` : missing.join("\n");
};

/**
 * 挂载 <web-remaster-root data-wr-app={appId}> 并返回 host 与 open ShadowRoot。
 * SSR / 无 DOM 环境优雅返回空结果（调用方不应在无 DOM 环境使用返回值）。
 */
export function mountWebRemasterRoot(appId: string, cssText?: string): ShadowMountResult {
  if (typeof document === "undefined") {
    return null as unknown as ShadowMountResult;
  }

  // 借鉴 wxt-dev/wxt 与 Tampermonkey 规范：重复挂载或重载时，清理同 appId 孤立根节点防内存泄漏
  const existingHost = document.querySelector(`web-remaster-root[data-wr-app="${appId}"]`);
  if (existingHost) {
    existingHost.remove();
  }

  const host = document.createElement("web-remaster-root");
  host.setAttribute("data-wr-app", appId);
  const mountParent = document.body ?? document.documentElement;
  mountParent?.appendChild(host);

  ensureHostStyle();

  const shadowRoot = host.attachShadow({ mode: "open" });

  if (typeof cssText === "string" && cssText.length > 0) {
    // Tailwind v4 防坑：@property（渐变/阴影/ring 所需）必须落在主文档
    const propertyRules = extractCssAtPropertyRules(cssText);
    mergeAtPropertyRules(propertyRules);

    const restCss = cssText.replace(AT_PROPERTY_RULE_RE, "").trim();
    if (restCss.length > 0) {
      let adopted = false;
      try {
        if (typeof CSSStyleSheet === "undefined") {
          throw new TypeError("CSSStyleSheet is not supported in this environment");
        }
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(restCss);
        // lib.dom 对 adoptedStyleSheets 的只读声明与各环境实现差异较大，收窄后赋值
        const adoptable = shadowRoot as unknown as { adoptedStyleSheets: CSSStyleSheet[] };
        adoptable.adoptedStyleSheets = [sheet];
        adopted = true;
      } catch {
        adopted = false;
      }
      if (!adopted) {
        // 降级：Shadow Root 内 <style>（JSDOM 走此分支属预期）
        const styleEl = document.createElement("style");
        styleEl.textContent = restCss;
        shadowRoot.appendChild(styleEl);
      }
    }
  }

  return { host, shadowRoot };
}
