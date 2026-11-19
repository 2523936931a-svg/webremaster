import { StoreIndexSchema, type StoreIndex } from "@webremaster/schema";

export async function loadStoreIndex(): Promise<StoreIndex> {
  try {
    const res = await fetch("./data/store_index.json");
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    const json = await res.json();
    return StoreIndexSchema.parse(json);
  } catch (err) {
    console.warn("Failed to load store_index.json from remote, using fallback:", err);
    // 降级兜底：至少展示 HackerNews 皮肤
    return {
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
          dataParityRatio: 1,
          bundleSizeKb: 287.3,
          tokensUsedToCompile: 0,
          version: "0.1.0",
        },
      ],
    };
  }
}
