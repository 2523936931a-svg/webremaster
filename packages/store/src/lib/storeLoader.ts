import { StoreIndexSchema, type StoreIndex, type SkinManifest } from "@webremaster/schema";

function mergeCustomSkins(baseIndex: StoreIndex): StoreIndex {
  if (typeof window === "undefined" || !window.localStorage) return baseIndex;
  try {
    const raw = window.localStorage.getItem("webremaster_custom_skins");
    if (!raw) return baseIndex;
    const customList = JSON.parse(raw);
    if (!Array.isArray(customList)) return baseIndex;

    const existingIds = new Set(baseIndex.skins.map((s) => s.id));
    const mergedSkins = [...baseIndex.skins];

    for (const item of customList) {
      if (!existingIds.has(item.id)) {
        mergedSkins.unshift(item);
        existingIds.add(item.id);
      }
    }

    return {
      ...baseIndex,
      totalSkins: mergedSkins.length,
      skins: mergedSkins,
    };
  } catch {
    return baseIndex;
  }
}

export async function loadStoreIndex(): Promise<StoreIndex> {
  try {
    const res = await fetch("./data/store_index.json");
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    const json = await res.json();
    const parsed = StoreIndexSchema.parse(json);
    return mergeCustomSkins(parsed);
  } catch (err) {
    console.warn("Failed to load store_index.json from remote, using fallback:", err);
    // 降级兜底：至少展示 HackerNews 皮肤
    const fallback: StoreIndex = {
      version: "0.1.0",
      totalSkins: 1,
      totalTokensBurned: 0,
      avgVlmScore: 9.2,
      skins: [
        {
          id: "hackernews",
          name: "Hacker News",
          category: "开发者",
          targetUrl: "https://news.ycombinator.com/",
          matchPatterns: ["https://news.ycombinator.com/*"],
          archetype: "news-feed",
          tagline: {
            zh: "Hacker News 暗黑高密度重制：等宽数字排版 + TurboNav 0ms 双路由 + 折叠评论树",
            en: "Hacker News remastered: dense dark feed, 0ms dual-route TurboNav, collapsible comment tree",
          },
          enhancements: [
            "cmd-k-search",
            "csv-markdown-export",
            "vim-navigation",
            "dark-light-theme",
            "turbo-nav",
          ],
          userscriptFile: "hackernews.user.js",
          beforeImage: "before.png",
          afterImage: "after.png",
          vlmScore: 9.2,
          vlmScoreSource: "human-review",
          dataParityRatio: 1,
          bundleSizeKb: 287.3,
          tokensUsedToCompile: 0,
          version: "0.1.0",
        },
      ],
    };
    return mergeCustomSkins(fallback);
  }
}
