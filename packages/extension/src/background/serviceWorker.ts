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

/** 动态更新特定标签页的扩展徽标与气泡提示 */
async function updateTabBadge(tabId: number, url?: string): Promise<void> {
  if (!ext?.action) return;
  if (!url || url.startsWith("chrome://") || url.startsWith("edge://") || url.startsWith("about:") || url.startsWith("chrome-extension://")) {
    await ext.action.setBadgeText({ tabId, text: "" });
    return;
  }

  const matchedSkin = SKIN_REGISTRY.find((skin) =>
    skin.matchPatterns.some((p) => matchesPattern(p, url)),
  );

  if (!matchedSkin) {
    await ext.action.setBadgeText({ tabId, text: "" });
    await ext.action.setTitle({ tabId, title: "WebRemaster" });
    return;
  }

  const storageKey = `skin_enabled_${matchedSkin.id}`;
  const data = await ext.storage.local.get([storageKey, "master_enabled"]);
  const isMasterEnabled = data.master_enabled !== false;
  const isSkinEnabled = data[storageKey] !== false;

  if (isMasterEnabled && isSkinEnabled) {
    await ext.action.setBadgeText({ tabId, text: "ON" });
    await ext.action.setBadgeBackgroundColor({ tabId, color: "#0ea5e9" }); // sky-500
    await ext.action.setTitle({ tabId, title: `WebRemaster: ${matchedSkin.name}（已激活）` });
  } else {
    await ext.action.setBadgeText({ tabId, text: "OFF" });
    await ext.action.setBadgeBackgroundColor({ tabId, color: "#71717a" }); // zinc-500
    await ext.action.setTitle({ tabId, title: `WebRemaster: ${matchedSkin.name}（已暂停）` });
  }
}

ext.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const url = tab.url;
  if (!url || url.startsWith("chrome://") || url.startsWith("edge://") || url.startsWith("about:")) return;

  // 状态变化时刷新徽标
  await updateTabBadge(tabId, url);

  if (changeInfo.status !== "complete") return;

  // 寻找匹配的皮肤
  const matchedSkin = SKIN_REGISTRY.find((skin) =>
    skin.matchPatterns.some((p) => matchesPattern(p, url)),
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

// 标签页切换时更新徽标
ext.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await ext.tabs.get(activeInfo.tabId);
    if (tab?.url) {
      await updateTabBadge(activeInfo.tabId, tab.url);
    }
  } catch {
    /* 忽略已关闭标签页异常 */
  }
});

// 开关状态变化时响应并刷新所有标签页徽标
ext.storage.onChanged.addListener(async (_changes, area) => {
  if (area !== "local") return;
  try {
    const tabs = await ext.tabs.query({});
    for (const tab of tabs) {
      if (tab.id && tab.url) {
        await updateTabBadge(tab.id, tab.url);
      }
    }
  } catch {
    /* 忽略并发异常 */
  }
});

ext.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "GET_SKIN_REGISTRY") {
    sendResponse({ skins: SKIN_REGISTRY });
  }
  return true;
});

// 借鉴 Refined GitHub：注册右键快捷上下文菜单
ext.runtime.onInstalled?.addListener(() => {
  if (!ext.contextMenus) return;
  ext.contextMenus.removeAll?.(() => {
    ext.contextMenus.create({
      id: "wr-toggle-mode",
      title: "WebRemaster: 切换原版/重制版 (Alt+Shift+R)",
      contexts: ["page"],
    });
    ext.contextMenus.create({
      id: "wr-open-store",
      title: "WebRemaster: 浏览皮肤商店",
      contexts: ["page"],
    });
  });
});

ext.contextMenus?.onClicked?.addListener(async (info, tab) => {
  if (info.menuItemId === "wr-toggle-mode" && tab?.id) {
    try {
      await ext.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          window.dispatchEvent(new KeyboardEvent("keydown", { key: "R", altKey: true, shiftKey: true, bubbles: true }));
        },
        world: "MAIN",
      });
    } catch {
      /* 忽略非标或受限页面异常 */
    }
  } else if (info.menuItemId === "wr-open-store") {
    ext.tabs.create({ url: "https://webremaster.dev" });
  }
});
