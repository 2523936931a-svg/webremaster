import { SKIN_REGISTRY } from "../registry/skinsRegistry.js";

function matchesPattern(pattern: string, url: string): boolean {
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

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url) return;

  // 寻找匹配的皮肤
  const matchedSkin = SKIN_REGISTRY.find((skin) =>
    skin.matchPatterns.some((p) => matchesPattern(p, tab.url!)),
  );

  if (!matchedSkin) return;

  const storageKey = `skin_enabled_${matchedSkin.id}`;
  const data = await chrome.storage.local.get([storageKey, "master_enabled"]);

  const isMasterEnabled = data.master_enabled !== false;
  const isSkinEnabled = data[storageKey] !== false;

  if (isMasterEnabled && isSkinEnabled) {
    try {
      console.log(`[WebRemaster] 注入皮肤: ${matchedSkin.name} (${matchedSkin.id}) -> Tab ${tabId}`);
      await chrome.scripting.executeScript({
        target: { tabId },
        files: [`skins/${matchedSkin.id}.js`],
        world: "MAIN",
      });
    } catch (err) {
      console.error(`[WebRemaster] 注入皮肤 ${matchedSkin.id} 失败:`, err);
    }
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "GET_SKIN_REGISTRY") {
    sendResponse({ skins: SKIN_REGISTRY });
  }
  return true;
});
