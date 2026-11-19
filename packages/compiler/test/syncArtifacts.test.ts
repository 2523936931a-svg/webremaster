import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { syncArtifactsHandler } from "../src/integrator/syncArtifacts.js";
import { StoreIndexSchema } from "@webremaster/schema";

describe("syncArtifacts", () => {
  let tempDir: string;
  let skinsDir: string;
  let extDir: string;
  let storeDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "wr-sync-test-"));
    skinsDir = path.join(tempDir, "skins");
    extDir = path.join(tempDir, "extension");
    storeDir = path.join(tempDir, "store");
    mkdirSync(skinsDir, { recursive: true });
    mkdirSync(extDir, { recursive: true });
    mkdirSync(storeDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("应成功同步已通过且 VLM>=8.5 的皮肤至 Chrome 扩展与皮肤商店", async () => {
    const makeGates = (passed: boolean) => [
      { gateName: "zero-runtime-errors", passed, score: passed ? 10 : 0, details: "ok" },
      { gateName: "zero-flash-curtain-lifted", passed, score: passed ? 10 : 0, details: "ok" },
      { gateName: "data-parity-and-health", passed, score: passed ? 10 : 0, details: "ok" },
      { gateName: "no-broken-render", passed, score: passed ? 10 : 0, details: "ok" },
      { gateName: "bridge-and-split-smoke", passed, score: passed ? 10 : 0, details: "ok" },
      { gateName: "portal-and-turbonav-integrity", passed, score: passed ? 10 : 0, details: "ok" },
    ];

    // 构造合格站点
    const goodSkin = path.join(skinsDir, "good-site");
    mkdirSync(goodSkin, { recursive: true });
    writeFileSync(
      path.join(goodSkin, "manifest.json"),
      JSON.stringify({
        id: "good-site",
        name: "Good Site",
        category: "开发者",
        targetUrl: "https://good.example.com/",
        matchPatterns: ["https://good.example.com/*"],
        archetype: "news-feed",
        tagline: { zh: "优秀重制", en: "Good Remaster" },
        enhancements: ["cmd-k-search"],
        userscriptFile: "good-site.user.js",
        beforeImage: "before.png",
        afterImage: "after.png",
        vlmScore: 9.2,
        dataParityRatio: 1,
        bundleSizeKb: 45,
        tokensUsedToCompile: 120000,
        version: "0.1.0",
      }),
    );
    writeFileSync(
      path.join(goodSkin, "05_verification.json"),
      JSON.stringify({
        siteId: "good-site",
        passed: true,
        repairRoundsUsed: 0,
        originalItemCount: 10,
        remasteredItemCount: 10,
        dataParityRatio: 1,
        vlmScore: 9.2,
        vlmFeedback: "优异",
        gates: makeGates(true),
        extractorHealthSummary: {
          title: { tier: 1, hits: 10, misses: 0 },
        },
        totalTokensUsed: 120000,
        verifiedAt: new Date().toISOString(),
      }),
    );
    writeFileSync(path.join(goodSkin, "good-site.user.js"), "// ==UserScript==\nconsole.log('good');");
    writeFileSync(path.join(goodSkin, "before.png"), "fake-png-data");
    writeFileSync(path.join(goodSkin, "after.png"), "fake-png-data");

    // 构造不合格站点（未通过验证）
    const failedSkin = path.join(skinsDir, "failed-site");
    mkdirSync(failedSkin, { recursive: true });
    writeFileSync(
      path.join(failedSkin, "manifest.json"),
      JSON.stringify({
        id: "failed-site",
        name: "Failed Site",
        category: "开发者",
        targetUrl: "https://fail.example.com/",
        matchPatterns: ["https://fail.example.com/*"],
        archetype: "news-feed",
        tagline: { zh: "失败站", en: "Failed" },
        enhancements: [],
        userscriptFile: "failed-site.user.js",
        beforeImage: "before.png",
        afterImage: "after.png",
        vlmScore: 7.0,
        dataParityRatio: 0.5,
        bundleSizeKb: 40,
        tokensUsedToCompile: 50000,
        version: "0.1.0",
      }),
    );
    writeFileSync(
      path.join(failedSkin, "05_verification.json"),
      JSON.stringify({
        siteId: "failed-site",
        passed: false,
        repairRoundsUsed: 2,
        originalItemCount: 10,
        remasteredItemCount: 5,
        dataParityRatio: 0.5,
        vlmScore: 7.0,
        vlmFeedback: "门禁失败",
        gates: makeGates(false),
        extractorHealthSummary: {
          title: { tier: 1, hits: 5, misses: 5 },
        },
        totalTokensUsed: 50000,
        verifiedAt: new Date().toISOString(),
      }),
    );

    const result = await syncArtifactsHandler({
      skinsDir,
      extDir,
      storeDir,
      minVlmScore: 8.5,
    });

    expect(result.totalFound).toBe(2);
    expect(result.acceptedCount).toBe(1);
    expect(result.rejectedCount).toBe(1);
    expect(result.acceptedSkins[0].id).toBe("good-site");

    // 验证 Chrome Extension 输出
    const extJs = path.join(extDir, "public", "skins", "good-site.js");
    expect(existsSync(extJs)).toBe(true);
    const registry = path.join(extDir, "src", "registry", "skinsRegistry.ts");
    expect(existsSync(registry)).toBe(true);
    const regContent = readFileSync(registry, "utf-8");
    expect(regContent).toContain("SKIN_REGISTRY");
    expect(regContent).toContain("good-site");

    // 验证 Store 输出
    const storeIndex = path.join(storeDir, "public", "data", "store_index.json");
    expect(existsSync(storeIndex)).toBe(true);
    const parsedIndex = StoreIndexSchema.parse(JSON.parse(readFileSync(storeIndex, "utf-8")));
    expect(parsedIndex.totalSkins).toBe(1);
    expect(parsedIndex.avgVlmScore).toBe(9.2);
    expect(parsedIndex.totalTokensBurned).toBe(120000);
  });
});
