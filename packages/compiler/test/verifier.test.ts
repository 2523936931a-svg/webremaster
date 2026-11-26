/**
 * LiveVerifier 验收：本地 node:http fixture + bundleMonkeySkin 真实打包 + 共享 Chromium。
 *
 * fixture 页（/index.html）：10 行 <tr class=story> 列表 + 同源 <a href=./detail.html> + <img id=captcha>。
 * fixture 皮肤（entry.tsx，default export mountSkin(context 子集类型)）：
 * - 从 context.originWrapper 提取 10 行渲染为带 data-wr-item="true" 的 div 列表；
 * - HealthTracker recordHit("title",1)×10（必填字段 title 命中率 100%）+ recordMiss("optional-misc")；
 * - diagnostics.healthSummary 返回 { perField, summary }；diagnostics.features 声明双开关，
 *   并在挂载完成后镜像到 window.__WR_DEBUG__.features（wrapper 未把 diagnostics 暴露到页面，
 *   验收器按该约定读取；无镜像时验收器退化为行为探测）；
 * - 真实实现 Ctrl+K 命令面板（role=dialog + input，Escape 关）与 Alt+Shift+X 诊断抽屉
 *   （aria-label 含「诊断」）；
 * - new TurboNavigator(context.originWrapper, () => {}, {}) + #captcha 活体传送门
 *   （original 模式归还、其余模式投影）。
 *
 * 覆盖：① 正向全绿（report.passed、6 门禁全 passed、remasteredItemCount=10、
 * dataParityRatio≥0.9、after.png/split.png/05_verification.json 存在）；
 * ② 负向空列表皮肤（Gate 3 失败 + passed=false）；
 * ③ VLM 终审通道（≥8.5 通过且记账 tokens；<8.5 拦截且不通过）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Browser } from "playwright";
import { SiteContractSchema, type SiteContract, type SiteSnapshot } from "@webremaster/schema";
import { launchSurveyBrowser, mapSite } from "../src/inspector/domXray.js";
import { bundleMonkeySkin } from "../src/bundler/monkeyBundler.js";
import { verifyRemasteredSkin } from "../src/verifier/liveVerifier.js";

/* ------------------------------------------------------------------ */
/* fixture 页面                                                        */
/* ------------------------------------------------------------------ */

const storyRows = (count: number): string =>
  Array.from(
    { length: count },
    (_, i) =>
      `      <tr class="story"><td class="title">Story Headline ${i + 1}</td><td class="score">${(i + 1) * 3}</td></tr>`,
  ).join("\n");

const INDEX_PAGE = `<!doctype html>
<html>
<head>
  <title>Fixture Story List</title>
  <link rel="icon" href="/favicon.ico">
</head>
<body>
<h1>Fixture Stories</h1>
<table id="stories"><tbody>
${storyRows(10)}
</tbody></table>
<p><a href="./detail.html">Open detail</a></p>
<img id="captcha" src="/captcha.png" alt="captcha challenge" width="120" height="40">
</body>
</html>`;

const DETAIL_PAGE = `<!doctype html>
<html>
<head><title>Story Detail</title></head>
<body><h1>Story Detail</h1><p>detail body</p></body>
</html>`;

/**
 * 离线回放专用页面：与 INDEX_PAGE 同构，但把图片换成 data URI，
 * 确保 fixture 模式拦截全部请求时不会产生解码/加载报错污染 Gate 1。
 */
const FIXTURE_PAGE = `<!doctype html>
<html>
<head><title>Fixture Story List (Offline Replay)</title></head>
<body>
<h1>Fixture Stories</h1>
<table id="stories"><tbody>
${storyRows(10)}
</tbody></table>
<p><a href="./detail.html">Open detail</a></p>
<img id="captcha" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=" alt="captcha challenge" width="120" height="40">
</body>
</html>`;

/** 1×1 合法 PNG：favicon 与验证码占位图（避免 404/解码失败触发 console.error 干扰 Gate 1）。 */
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

/* ------------------------------------------------------------------ */
/* fixture 皮肤（bundleMonkeySkin 真实构建）                            */
/* ------------------------------------------------------------------ */

const SKIN_CSS = '@import "tailwindcss";\n@source "./";\n';

const SKIN_ENTRY = `/**
 * LiveVerifier fixture 皮肤：真实挂载 10 行 data-wr-item 列表 + 健康度上报 +
 * Ctrl+K 命令面板 / Alt+Shift+X 诊断抽屉 + TurboNav + #captcha 活体传送门。
 */
import {
  createPortalSlotController,
  HealthTracker,
  TurboNavigator,
  type ViewMode,
} from "@webremaster/bridge";
import "./skin.css";

/** wrapper context 的子集类型（多余属性经中间变量传递，不触发 excess-property 检查）。 */
interface SkinMountContext {
  host: HTMLElement;
  shadowRoot: ShadowRoot;
  originWrapper: HTMLElement;
  originManager: { onViewModeChange(cb: (mode: ViewMode) => void): () => void };
  diagnostics: {
    healthSummary?: () => unknown;
    features?: { commandPalette?: boolean; diagnosticsDrawer?: boolean };
  };
}

export default function mountSkin(context: SkinMountContext): void {
  const tracker = new HealthTracker();
  const rows = Array.from(context.originWrapper.querySelectorAll("tr.story"));

  const root = document.createElement("div");
  root.className = "wr-skin-root rounded-xl bg-slate-900 p-4 text-slate-100";
  context.shadowRoot.appendChild(root);

  const heading = document.createElement("h2");
  heading.className = "text-lg font-bold";
  heading.textContent = "Fixture Stories · Remastered";
  root.appendChild(heading);

  const list = document.createElement("div");
  list.className = "mt-3";
  root.appendChild(list);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const item = document.createElement("div");
    item.setAttribute("data-wr-item", "true");
    item.className = "flex items-center justify-between px-2 py-1.5";
    const label = document.createElement("span");
    label.textContent = (row.textContent ?? "").trim();
    const score = document.createElement("span");
    score.className = "text-slate-400";
    score.textContent = String((i + 1) * 3);
    item.appendChild(label);
    item.appendChild(score);
    list.appendChild(item);
    tracker.recordHit("title", 1);
  }
  tracker.recordMiss("optional-misc");

  context.diagnostics.healthSummary = () => ({
    perField: tracker.getAllHealth(),
    summary: tracker.summary(),
  });
  context.diagnostics.features = { commandPalette: true, diagnosticsDrawer: true };
  // wrapper 未把 diagnostics 暴露到页面：挂载完成后再把 features 镜像到 __WR_DEBUG__ 供验收器读取
  window.setTimeout(() => {
    const handle = (window as unknown as { __WR_DEBUG__?: { features?: unknown } }).__WR_DEBUG__;
    if (handle !== undefined) handle.features = context.diagnostics.features;
  }, 0);

  // Ctrl+K 命令面板：role=dialog + input，Escape 关闭
  const palette = document.createElement("div");
  palette.setAttribute("role", "dialog");
  palette.setAttribute("aria-modal", "true");
  palette.style.cssText =
    "position:fixed;inset:0;z-index:2147483645;background:rgba(0,0,0,.35);display:none;";
  const palettePanel = document.createElement("div");
  palettePanel.style.cssText =
    "margin:18vh auto 0;width:min(520px,90vw);border-radius:14px;background:#16181c;overflow:hidden;";
  const paletteInput = document.createElement("input");
  paletteInput.type = "text";
  paletteInput.placeholder = "搜索命令";
  paletteInput.setAttribute("aria-label", "搜索命令");
  paletteInput.style.cssText =
    "display:block;width:100%;box-sizing:border-box;background:transparent;border:none;outline:none;color:#fff;font-size:16px;padding:14px 16px;";
  palettePanel.appendChild(paletteInput);
  palette.appendChild(palettePanel);
  root.appendChild(palette);

  // Alt+Shift+X 诊断抽屉：role=dialog + aria-label 含「诊断」，Escape 关闭
  const drawer = document.createElement("div");
  drawer.setAttribute("role", "dialog");
  drawer.setAttribute("aria-label", "诊断抽屉");
  drawer.style.cssText =
    "position:fixed;right:16px;top:16px;width:320px;max-height:60vh;overflow:auto;z-index:2147483646;border-radius:12px;background:#16181c;color:#e8eaed;font:13px/1.6 system-ui,sans-serif;padding:14px;display:none;";
  const drawerTitle = document.createElement("strong");
  drawerTitle.textContent = "诊断抽屉";
  const drawerBody = document.createElement("pre");
  drawerBody.style.cssText = "white-space:pre-wrap;margin:8px 0 0;";
  drawerBody.textContent = JSON.stringify({ items: rows.length, health: tracker.summary() }, null, 2);
  drawer.appendChild(drawerTitle);
  drawer.appendChild(drawerBody);
  root.appendChild(drawer);

  let paletteOpen = false;
  let drawerOpen = false;
  const setPalette = (open: boolean): void => {
    paletteOpen = open;
    palette.style.display = open ? "block" : "none";
    if (open) paletteInput.focus();
  };
  const setDrawer = (open: boolean): void => {
    drawerOpen = open;
    drawer.style.display = open ? "block" : "none";
  };
  window.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "k") {
      event.preventDefault();
      setPalette(!paletteOpen);
      return;
    }
    if (event.altKey && event.shiftKey && (event.key === "X" || event.key === "x")) {
      event.preventDefault();
      setDrawer(!drawerOpen);
      return;
    }
    if (event.key === "Escape") {
      if (paletteOpen) setPalette(false);
      if (drawerOpen) setDrawer(false);
    }
  });

  // TurboNav：悬停原站同源链接触发预取（验收器断言 __WR_FETCH_LOG__ 命中）
  new TurboNavigator(context.originWrapper, () => {}, {});

  // #captcha 活体传送门：投影进宿主 Light DOM；original 模式归还、其余模式（重新）投影
  const portal = createPortalSlotController(context.originWrapper, ["#captcha"], "captcha", context.host);
  const syncPortal = (mode: ViewMode): void => {
    if (mode === "original") portal.restore();
    else if (!portal.isProjected()) portal.project();
  };
  context.originManager.onViewModeChange(syncPortal);
  portal.project();
}
`;

const EMPTY_SKIN_ENTRY = `/**
 * LiveVerifier 负向 fixture 皮肤：挂载成功但渲染零条 data-wr-item（空列表），
 * 不上报健康度、不声明 features、不接 TurboNav / 传送门 —— 用于验证验收器真的会打回。
 */
import "./skin.css";

export default function mountSkin(context: { shadowRoot: ShadowRoot }): void {
  const root = document.createElement("div");
  root.className = "wr-skin-root rounded-xl bg-slate-900 p-4 text-slate-100";
  root.textContent = "空列表皮肤（负向验收用例）";
  context.shadowRoot.appendChild(root);
}
`;

/* ------------------------------------------------------------------ */
/* 契约与共享状态                                                       */
/* ------------------------------------------------------------------ */

const CONTRACT: SiteContract = SiteContractSchema.parse({
  siteId: "fixture-story-list",
  siteName: "Fixture Story List",
  matchPatterns: ["*://127.0.0.1/*"],
  routes: [
    {
      routeId: "story-index",
      urlRegex: "^http://127\\.0\\.0\\.1:[0-9]+/index\\.html$",
      domFingerprintSelector: "table#stories",
      archetype: "news-feed",
      primaryListContainer: "table#stories tbody",
      primaryItemSelector: "tr.story",
      itemFields: [
        {
          fieldName: "title",
          fieldType: "string",
          selectors: ["tr.story td.title"],
          attribute: "textContent",
          required: true,
        },
        {
          fieldName: "score",
          fieldType: "number",
          selectors: ["tr.story td.score"],
          attribute: "textContent",
          required: false,
        },
      ],
      portalSlots: [
        {
          slotName: "captcha",
          description: "登录验证码图片（活体槽位，禁止重制）",
          selectors: ["#captcha"],
          kind: "captcha",
        },
      ],
    },
  ],
  enableTurboNav: true,
  recommendedPowerUps: ["cmd-k-search"],
});

const GATE_NAMES = [
  "zero-runtime-errors",
  "zero-flash-curtain-lifted",
  "data-parity-and-health",
  "no-broken-render",
  "bridge-and-split-smoke",
  "portal-and-turbonav-integrity",
];

let server: Server;
let baseUrl: string;
let browser: Browser;
let snapshot: SiteSnapshot;
let positiveUserscript: string;
let emptyUserscript: string;
let fixtureDir = "";
const tempDirs: string[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    const route = (req.url ?? "").split("?")[0] ?? "";
    const respond = (body: string | Buffer, contentType: string): void => {
      res.writeHead(200, { "content-type": contentType });
      res.end(body);
    };
    if (route === "/index.html") respond(INDEX_PAGE, "text/html; charset=utf-8");
    else if (route === "/detail.html") respond(DETAIL_PAGE, "text/html; charset=utf-8");
    else if (route === "/favicon.ico" || route === "/captcha.png") respond(TINY_PNG, "image/png");
    else {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
    }
  });
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  browser = await launchSurveyBrowser();

  // 快照：真实 mapSite 产物（10 行 tr.story → single 组 → originalItemCountHint = 10）
  const snapshotDir = await mkdtemp(join(tmpdir(), "wr-verifier-snap-"));
  tempDirs.push(snapshotDir);
  snapshot = await mapSite({ url: `${baseUrl}/index.html`, outDir: snapshotDir, browser, settleMs: 80 });
  expect(snapshot.originalItemCountHint).toBe(10);

  // fixture 皮肤落盘 + 双皮肤真实打包（tsc 门禁 + vite 构建 + 产物门禁）
  const compilerDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  fixtureDir = join(compilerDir, "node_modules", ".cache", "webremaster-verifier-test", randomUUID().slice(0, 8));
  await mkdir(fixtureDir, { recursive: true });
  const entryPath = join(fixtureDir, "entry.tsx");
  const emptyEntryPath = join(fixtureDir, "empty-entry.tsx");
  const cssPath = join(fixtureDir, "skin.css");
  await Promise.all([
    writeFile(entryPath, SKIN_ENTRY, "utf8"),
    writeFile(emptyEntryPath, EMPTY_SKIN_ENTRY, "utf8"),
    writeFile(cssPath, SKIN_CSS, "utf8"),
  ]);
  const positive = await bundleMonkeySkin({
    contract: CONTRACT,
    entry: entryPath,
    outFile: join(fixtureDir, "fixture-skin.user.js"),
  });
  const empty = await bundleMonkeySkin({
    contract: CONTRACT,
    entry: emptyEntryPath,
    outFile: join(fixtureDir, "empty-skin.user.js"),
  });
  positiveUserscript = positive.outFile;
  emptyUserscript = empty.outFile;
}, 180_000);

afterAll(async () => {
  await browser?.close();
  server?.closeAllConnections();
  await new Promise<void>((resolveClose) => server?.close(() => resolveClose()));
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
  if (fixtureDir !== "") await rm(fixtureDir, { recursive: true, force: true });
});

async function expectPng(path: string): Promise<void> {
  const bytes = await readFile(path);
  expect(bytes.length).toBeGreaterThan(500);
  expect(Array.from(bytes.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
}

/* ------------------------------------------------------------------ */
/* 用例                                                                 */
/* ------------------------------------------------------------------ */

describe("liveVerifier", () => {
  it("正向：全功能皮肤 6 门禁全绿 + 产物落盘", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "wr-verifier-ok-"));
    tempDirs.push(outDir);

    const report = await verifyRemasteredSkin({
      snapshot,
      contract: CONTRACT,
      userscriptPath: positiveUserscript,
      outDir,
      enableVlm: false,
      settleMs: 400,
      browser,
    });

    // 报告结构与总体判定
    expect(report.siteId).toBe(snapshot.siteId);


    expect(report.passed).toBe(true);
    expect(report.repairRoundsUsed).toBe(0);
    expect(report.gates).toHaveLength(6);
    expect(report.gates.map((gate) => gate.gateName)).toEqual(GATE_NAMES);
    expect(report.gates.every((gate) => gate.passed)).toBe(true);

    // 数据对账与提取器健康度
    expect(report.originalItemCount).toBe(10);
    expect(report.remasteredItemCount).toBe(10);
    expect(report.dataParityRatio).toBeGreaterThanOrEqual(0.9);
    expect(report.extractorHealthSummary["title"]).toEqual({ tier: 1, hits: 10, misses: 0 });
    expect(report.extractorHealthSummary["optional-misc"]).toEqual({ tier: 1, hits: 0, misses: 1 });

    // Agent-Native 模式（--no-vlm）
    expect(report.vlmScore).toBe(0);
    expect(report.vlmFeedback).toBe("待终审（Agent-Native 模式）");
    expect(report.totalTokensUsed).toBe(0);
    expect(new Date(report.verifiedAt).getTime()).not.toBeNaN();

    // 产物：after.png / split.png / 05_verification.json 存在且与返回报告一致
    await expectPng(join(outDir, "after.png"));
    await expectPng(join(outDir, "split.png"));
    const persisted = JSON.parse(await readFile(join(outDir, "05_verification.json"), "utf8")) as object;
    expect(persisted).toEqual(report as unknown as object);
  }, 180_000);

  it("负向：空列表皮肤 → Gate 3 失败 + passed=false", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "wr-verifier-bad-"));
    tempDirs.push(outDir);

    const report = await verifyRemasteredSkin({
      snapshot,
      contract: CONTRACT,
      userscriptPath: emptyUserscript,
      outDir,
      enableVlm: false,
      settleMs: 400,
      browser,
    });

    expect(report.passed).toBe(false);
    const gate3 = report.gates.find((gate) => gate.gateName === "data-parity-and-health");
    expect(gate3).toBeDefined();
    expect(gate3!.passed).toBe(false);
    expect(gate3!.score).toBe(0);
    expect(report.remasteredItemCount).toBe(0);
    expect(report.dataParityRatio).toBe(0);
    expect(report.gates).toHaveLength(6);
  }, 180_000);

  it("VLM 终审通道：≥8.5 通过且记账 tokens，<8.5 拦截", async () => {
    const passDir = await mkdtemp(join(tmpdir(), "wr-verifier-vlm1-"));
    tempDirs.push(passDir);
    const passReport = await verifyRemasteredSkin({
      snapshot,
      contract: CONTRACT,
      userscriptPath: positiveUserscript,
      outDir: passDir,
      enableVlm: true,
      vlmCritic: async () => ({ score: 9.2, feedback: "视觉一致，通过终审", tokensUsed: 123 }),
      settleMs: 400,
      browser,
    });
    expect(passReport.passed).toBe(true);
    expect(passReport.gates.every((gate) => gate.passed)).toBe(true);
    expect(passReport.vlmScore).toBe(9.2);
    expect(passReport.vlmFeedback).toBe("视觉一致，通过终审");
    expect(passReport.totalTokensUsed).toBe(123);

    const failDir = await mkdtemp(join(tmpdir(), "wr-verifier-vlm2-"));
    tempDirs.push(failDir);
    const failReport = await verifyRemasteredSkin({
      snapshot,
      contract: CONTRACT,
      userscriptPath: positiveUserscript,
      outDir: failDir,
      enableVlm: true,
      vlmCritic: async () => ({ score: 4, feedback: "布局漂移，打回修复" }),
      settleMs: 400,
      browser,
    });
    expect(failReport.passed).toBe(false);
    expect(failReport.gates.every((gate) => gate.passed)).toBe(true);
    expect(failReport.vlmScore).toBe(4);
    expect(failReport.vlmFeedback).toBe("布局漂移，打回修复");
    expect(failReport.totalTokensUsed).toBe(0);
  }, 180_000);

  it("离线 fixture 回放：站点不可达也能跑六门禁，报告标注来源且不覆盖截图", async () => {
    const replayDir = await mkdtemp(join(tmpdir(), "wr-verifier-fixture-"));
    tempDirs.push(replayDir);
    const fixtureHtmlPath = join(replayDir, "front.html");
    await writeFile(fixtureHtmlPath, FIXTURE_PAGE, "utf8");

    const report = await verifyRemasteredSkin({
      snapshot,
      contract: CONTRACT,
      userscriptPath: positiveUserscript,
      outDir: replayDir,
      enableVlm: false,
      settleMs: 400,
      browser,
      fixtureHtmlPath,
      captureScreenshots: false,
    });

    // 主文档来自本地快照：与真站验证同等的六门禁结论
    expect(report.passed).toBe(true);
    expect(report.gates).toHaveLength(6);
    expect(report.gates.every((gate) => gate.passed)).toBe(true);
    expect(report.remasteredItemCount).toBe(10);
    expect(report.dataParityRatio).toBeGreaterThanOrEqual(0.9);

    // 来源必须可辨认，避免回放结果被读成真站实测
    const gate1 = report.gates.find((gate) => gate.gateName === "zero-runtime-errors");
    expect(gate1?.details).toContain("离线 fixture 回放");

    // 回放不落盘截图：真机图不会被回放画面覆盖
    await expect(readFile(join(replayDir, "after.png"))).rejects.toBeTruthy();
    await expect(readFile(join(replayDir, "split.png"))).rejects.toBeTruthy();

    const persisted = JSON.parse(await readFile(join(replayDir, "05_verification.json"), "utf8")) as object;
    expect(persisted).toEqual(report as unknown as object);
  }, 180_000);
});
