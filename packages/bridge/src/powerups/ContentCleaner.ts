/**
 * ContentCleaner PowerUp —— 智能抗干扰与弹窗净化器（借鉴 uBlock Origin / Privacy Badger / "I Don't Care About Cookies"）。
 *
 * 针对许多古老转换站点或含恶意全屏蒙层的网页：
 * 1. 检测并移除 Cookie 授权弹窗与全屏模糊蒙层；
 * 2. 自动恢复被页面 JS 恶意锁死的 `document.body.style.overflow`（杜绝页面无法滚动问题）；
 * 3. 移除吸顶/吸底广告条与悬浮推广挂件。
 */

export interface CleaningResult {
  removedCount: number;
  overflowRestored: boolean;
}

/** 常见的干扰弹窗与 Cookie 授权选择器 */
const DISTRACTION_SELECTORS = [
  "#onetrust-consent-sdk",
  ".cookie-banner",
  ".cookie-consent",
  ".gdpr-banner",
  "#cookie-notice",
  ".modal-backdrop",
  ".newsletter-popup",
  "[id*='cookie-consent']",
  "[class*='cookie-notice']",
  ".ad-banner-floating",
  ".sticky-floating-ad",
];

export function cleanDistractions(root?: HTMLElement | Document): CleaningResult {
  const doc = root ?? (typeof document !== "undefined" ? document : null);
  if (!doc) return { removedCount: 0, overflowRestored: false };

  let removedCount = 0;

  for (const selector of DISTRACTION_SELECTORS) {
    try {
      const elements = doc.querySelectorAll(selector);
      for (const el of Array.from(elements)) {
        el.remove();
        removedCount++;
      }
    } catch {
      /* 忽略非法选择器 */
    }
  }

  // 恢复页面滚动能力
  let overflowRestored = false;
  if (typeof document !== "undefined") {
    const body = document.body;
    const html = document.documentElement;

    if (body) {
      if (body.style.overflow === "hidden" || window.getComputedStyle?.(body).overflow === "hidden") {
        body.style.setProperty("overflow", "auto", "important");
        overflowRestored = true;
      }
      if (body.style.position === "fixed") {
        body.style.removeProperty("position");
        overflowRestored = true;
      }
    }

    if (html && html.style.overflow === "hidden") {
      html.style.setProperty("overflow", "auto", "important");
      overflowRestored = true;
    }
  }

  return { removedCount, overflowRestored };
}
