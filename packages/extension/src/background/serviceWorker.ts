import { SKIN_REGISTRY } from "../registry/skinsRegistry.js";

const ext = typeof chrome !== "undefined" ? chrome : (globalThis as unknown as { browser: typeof chrome }).browser;

function matchesPattern(pattern: string, url: string): boolean {
  if (!url || url.startsWith("chrome://") || url.startsWith("edge://") || url.startsWith("about:") || url.startsWith("chrome-extension://")) {
    return false;
  }
  try {
    const escaped = pattern
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*");
    const regex = new RegExp(`^${escaped}$`);
    return regex.test(url);
  } catch {
    return false;
  }
}

ext.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url) return;
  if (tab.url.startsWith("chrome://") || tab.url.startsWith("edge://") || tab.url.startsWith("about:")) return;

  // 寻找匹配的皮肤
  const matchedSkin = SKIN_REGISTRY.find((skin) =>
    skin.matchPatterns.some((p) => matchesPattern(p, tab.url!)),
  );

  if (!matchedSkin) return;

  const storageKey = `skin_enabled_${matchedSkin.id}`;
  const data = await ext.storage.local.get([storageKey, "master_enabled"]);

  const isMasterEnabled = data.master_enabled !== false;
  const isSkinEnabled = data[storageKey] !== false;

  if (isMasterEnabled && isSkinEnabled) {
    try {
      console.log(`[WebRemaster] 注入皮肤: ${matchedSkin.name} (${matchedSkin.id}) -> Tab ${tabId}`);
      await ext.scripting.executeScript({
        target: { tabId },
        files: [`skins/${matchedSkin.id}.js`],
        world: "MAIN",
      });
    } catch (err) {
      console.error(`[WebRemaster] 注入皮肤 ${matchedSkin.id} 失败:`, err);
    }
  }
});

ext.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "GET_SKIN_REGISTRY") {
    sendResponse({ skins: SKIN_REGISTRY });
  }
  return true;
});
