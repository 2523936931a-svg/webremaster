/**
 * CodeBlockEnhancer PowerUp —— 经典文档代码块智能增强器（借鉴 Carbon / GitHub Code View）。
 *
 * 针对各大古老技术文档（如 SQLite、curl 手册、Python PEPs、GCC 文档）：
 * 1. 自动为页面所有 <pre> 或 pre > code 挂载现代化复制按钮；
 * 2. 带有轻量点击反馈动画（"已复制" / 绿勾图标）；
 * 3. 幂等运行，避免重复增强。
 */

export function enhanceCodeBlocks(container?: HTMLElement | Document | null): { enhancedCount: number } {
  const root = container ?? (typeof document !== "undefined" ? document : null);
  if (!root) return { enhancedCount: 0 };

  const preElements = Array.from(root.querySelectorAll("pre"));
  let enhancedCount = 0;

  for (let i = 0; i < preElements.length; i++) {
    const pre = preElements[i];
    // 已增强则跳过，幂等执行
    if (pre.getAttribute("data-wr-code-enhanced") === "true") continue;
    pre.setAttribute("data-wr-code-enhanced", "true");

    const codeText = pre.textContent || "";
    if (codeText.trim().length === 0) continue;

    // 保证 pre 处于相对定位以挂载右上角复制按钮
    if (window.getComputedStyle?.(pre).position === "static") {
      pre.style.position = "relative";
    }

    const btn = document.createElement("button");
    btn.className = "wr-code-copy-btn";
    btn.type = "button";
    btn.innerHTML =
      `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg> 复制`;
    btn.style.cssText =
      "position:absolute;top:8px;right:8px;font-size:11px;padding:3px 8px;border-radius:6px;" +
      "background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);color:#cbd5e1;" +
      "cursor:pointer;display:inline-flex;align-items:center;gap:4px;transition:all 0.15s ease;" +
      "backdrop-filter:blur(4px);z-index:10;user-select:none;";

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        navigator.clipboard
          .writeText(codeText.trim())
          .then(() => {
            const original = btn.innerHTML;
            btn.innerHTML =
              `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> 已复制`;
            setTimeout(() => {
              btn.innerHTML = original;
            }, 2000);
          })
          .catch(() => {});
      }
    });

    pre.appendChild(btn);
    enhancedCount++;
  }

  return { enhancedCount };
}
