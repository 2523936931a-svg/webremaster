/**
 * DOM X-Ray 测绘器验收（本地 HTTP fixture + 真实 Chromium）。
 * 覆盖：① HN tr.athing+tr 相邻兄弟配对；② arXiv dt-dd 配对；
 * ③ 同源 iframe 骨架与内部交互元素；④ 验证码 canvas/captcha 输入识别 + CSRF 隐藏域；
 * ⑤ 追踪请求拦截（tracker 请求不触达 fixture 服务器）；⑥ 骨架 ≤16KB 裁剪（L4 尾部丢弃）；
 * ⑦ before.png 截图与 SiteSnapshot 全量 schema 校验。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Browser } from "playwright";
import { SiteSnapshotSchema, type SiteSnapshot } from "@webremaster/schema";
import { launchSurveyBrowser, mapSite } from "../src/inspector/domXray.js";

/* ------------------------------------------------------------------ */
/* fixture 页面                                                        */
/* ------------------------------------------------------------------ */

const hnRows = (count: number): string =>
  Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    return (
      `    <tr class="athing" id="r${n}"><td class="title"><a href="/item/${n}">Story Headline ${n}</a></td></tr>\n` +
      `    <tr><td class="subtext"><a href="/user/user${n}">user${n}</a> ${n * 3} points</td></tr>`
    );
  }).join("\n");

const HN_PAGE = `<!doctype html>
<html>
<head>
  <title>Hacker Newsish</title>
  <link rel="stylesheet" href="/style.css">
  <script>var wrSkeletonProbe = "SKELETON_SCRIPT_SHOULD_BE_STRIPPED";</script>
</head>
<body>
<table id="hnmain" bgcolor="#f6f6ef">
  <tbody>
${hnRows(10)}
  </tbody>
</table>
<div id="sidebar"><ul id="blogroll"><li><a href="/blog/alpha">Alpha</a></li><li><a href="/blog/beta">Beta</a></li><li><a href="/blog/gamma">Gamma</a></li><li><a href="/blog/delta">Delta</a></li></ul></div>
</body>
</html>`;

const arxivPairs = (count: number): string =>
  Array.from({ length: count }, (_, i) =>
    `  <dt><a href="/abs/2401.0000${i}">[${i + 1}] Quantum Widgets ${i + 1}</a></dt>\n` +
    `  <dd>Authored by Author ${i + 1} · Abstract: we study widgets number ${i + 1}.</dd>`,
  ).join("\n");

const ARXIV_PAGE = `<!doctype html>
<html>
<head><title>arXivish Listings</title></head>
<body>
<h1>Listings</h1>
<dl id="abslist">
${arxivPairs(10)}
</dl>
</body>
</html>`;

const FRAMES_PAGE = `<!doctype html>
<html>
<head><title>Frameset Portal</title></head>
<body>
<h1>Portal</h1>
<iframe id="panel-frame" name="panel" title="Inner Panel" src="/inner"></iframe>
</body>
</html>`;

const INNER_PAGE = `<!doctype html>
<html>
<head><title>Inner</title></head>
<body>
<div id="inner-root"><button id="inner-btn">Do It</button><p>inner content marker</p></div>
</body>
</html>`;

const CAPTCHA_PAGE = `<!doctype html>
<html>
<head><title>Login Portal</title></head>
<body>
<h1>Login</h1>
<form action="/login" method="post">
  <input type="hidden" name="csrf_token" value="abc123">
  <label>User <input name="user"></label>
  <label>Pass <input type="password" name="pass"></label>
  <label>Captcha <input name="captcha_code" id="captcha-input"></label>
  <img src="/captcha.png" alt="captcha challenge">
  <canvas id="captcha-canvas" width="120" height="40"></canvas>
  <button type="submit">Login</button>
</form>
</body>
</html>`;

const TRACKER_PAGE = `<!doctype html>
<html>
<head>
  <title>Tracked Page</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
<h1>Instrumented</h1>
<img id="logo" src="/logo.png" alt="logo">
<script src="/tracker.js"></script>
<img src="/analytics/pixel.gif" width="1" height="1" alt="">
<script>fetch("/api/telemetry/collect", { method: "POST" });</script>
</body>
</html>`;

const bigItems = (count: number): string =>
  Array.from(
    { length: count },
    (_, i) =>
      `<span class="row-item" id="item-${i}">Entry ${i} filler text pad pad pad pad pad pad pad pad pad pad.</span>`,
  ).join("\n");

const BIG_PAGE = `<!doctype html>
<html>
<head><title>Big Listing</title></head>
<body>
<h1>Big Listing</h1>
${bigItems(900)}
</body>
</html>`;

/* ------------------------------------------------------------------ */
/* 服务器与浏览器共享状态                                              */
/* ------------------------------------------------------------------ */

let server: Server;
let baseUrl: string;
let browser: Browser;
const hits: string[] = [];
const tempDirs: string[] = [];

/** /tracker.js 与 /analytics/pixel.gif 在服务器侧有路由，但应永远收不到请求。 */
const pages: Record<string, { body: string; contentType?: string }> = {};

beforeAll(async () => {
  pages["/hn"] = { body: HN_PAGE };
  pages["/arxiv"] = { body: ARXIV_PAGE };
  pages["/frames"] = { body: FRAMES_PAGE };
  pages["/inner"] = { body: INNER_PAGE };
  pages["/captcha"] = { body: CAPTCHA_PAGE };
  pages["/tracker-page"] = { body: TRACKER_PAGE };
  pages["/big"] = { body: BIG_PAGE };
  pages["/style.css"] = { body: "body { background: #f6f6ef; }", contentType: "text/css; charset=utf-8" };
  pages["/logo.png"] = { body: "fakepng", contentType: "image/png" };
  pages["/tracker.js"] = { body: "window.__tracker = true;", contentType: "text/javascript" };
  pages["/analytics/pixel.gif"] = { body: "gif", contentType: "image/gif" };
  pages["/captcha.png"] = { body: "captchaimg", contentType: "image/png" };

  server = createServer((req, res) => {
    hits.push(req.url ?? "");
    const path = (req.url ?? "").split("?")[0] ?? "";
    const entry = pages[path];
    if (!entry) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    res.writeHead(200, { "content-type": entry.contentType ?? "text/html; charset=utf-8" });
    res.end(entry.body);
  });
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  browser = await launchSurveyBrowser();
});

afterAll(async () => {
  await browser?.close();
  server.closeAllConnections();
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
});

async function xray(pathName: string): Promise<SiteSnapshot> {
  const dir = await mkdtemp(join(tmpdir(), "wr-domxray-"));
  tempDirs.push(dir);
  return mapSite({ url: `${baseUrl}${pathName}`, outDir: dir, browser, settleMs: 80 });
}

async function expectPng(path: string): Promise<void> {
  const bytes = await readFile(path);
  expect(bytes.length).toBeGreaterThan(500);
  expect(Array.from(bytes.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
}

describe("domXray", () => {
  it("HN：paired-next-sibling 配对（tr.athing + tr）+ single 组 + 骨架/截图", async () => {
    const snap = await xray("/hn");

    // 快照结构与元信息
    expect(() => SiteSnapshotSchema.parse(snap)).not.toThrow();
    expect(snap.siteId).toBe("127-0-0-1");
    expect(snap.url).toBe(`${baseUrl}/hn`);
    expect(snap.matchPatterns).toEqual([`${baseUrl}/*`]);
    expect(snap.title).toBe("Hacker Newsish");
    expect(snap.hasFramesetOrIframes).toBe(false);
    expect(snap.sameOriginFrames).toEqual([]);

    // HN 配对：10 行 athing + 相邻 subtext 行
    const paired = snap.repeatedGroups.find((g) => g.pairingMode === "paired-next-sibling");
    expect(paired).toBeDefined();
    expect(paired!.itemSelector).toContain("tr.athing");
    expect(paired!.companionSelector).toContain("tr.athing + tr");
    expect(paired!.totalCount).toBe(10);
    expect(paired!.sampleItemsHtml).toHaveLength(3);
    expect(paired!.sampleItemsHtml[0]).toContain("Story Headline 1");
    expect(paired!.sampleItemsHtml[0]).toContain('href="/item/1"');

    // 侧栏 4 项 blogroll → single 组
    const single = snap.repeatedGroups.find((g) => g.pairingMode === "single");
    expect(single).toBeDefined();
    expect(single!.itemSelector).toContain("li");
    expect(single!.totalCount).toBe(4);
    expect(snap.repeatedGroups).toHaveLength(2);
    expect(snap.originalItemCountHint).toBe(10); // 主列表组条数（max 语义），导航类次组不混入对账基准

    // 交互元素：10 标题链接 + 10 用户链接 + 4 博客链接
    expect(snap.interactiveElements.length).toBeGreaterThanOrEqual(20);
    const firstLink = snap.interactiveElements.find((el) => el.tag === "a");
    expect(firstLink).toBeDefined();
    expect(firstLink!.selectors.length).toBeGreaterThanOrEqual(1);
    expect(firstLink!.boundingBox).toBeDefined();
    expect(firstLink!.label).toContain("Story Headline");

    // 骨架：保留地标、剥掉脚本、≤16KB
    expect(Buffer.byteLength(snap.domSkeletonHtml, "utf8")).toBeLessThanOrEqual(16384);
    expect(snap.domSkeletonHtml).toContain('id="hnmain"');
    expect(snap.domSkeletonHtml).not.toContain("SKELETON_SCRIPT_SHOULD_BE_STRIPPED");

    // before.png
    expect(snap.beforeScreenshotPath.endsWith("before.png")).toBe(true);
    await expectPng(snap.beforeScreenshotPath);
  });

  it("arXiv：dt-dd-pair 配对", async () => {
    const snap = await xray("/arxiv");
    expect(() => SiteSnapshotSchema.parse(snap)).not.toThrow();
    expect(snap.title).toBe("arXivish Listings");

    expect(snap.repeatedGroups).toHaveLength(1);
    const group = snap.repeatedGroups[0]!;
    expect(group.pairingMode).toBe("dt-dd-pair");
    expect(group.itemSelector).toContain("> dt");
    expect(group.companionSelector).toContain("dt + dd");
    expect(group.totalCount).toBe(10);
    expect(group.sampleItemsHtml[0]).toContain("Quantum Widgets 1");
    expect(snap.originalItemCountHint).toBe(10);
  });

  it("iframe：同源 frame 骨架捕获 + frame 内交互元素带 frameId", async () => {
    const snap = await xray("/frames");
    expect(snap.hasFramesetOrIframes).toBe(true);
    expect(snap.sameOriginFrames).toHaveLength(1);

    const frameInfo = snap.sameOriginFrames[0]!;
    expect(frameInfo.frameId).toBe("panel-frame");
    expect(frameInfo.title).toBe("Inner Panel");
    expect(frameInfo.src).toBe(`${baseUrl}/inner`);
    expect(frameInfo.skeletonHtml).toContain("inner content marker");
    expect(frameInfo.skeletonHtml).toContain('id="inner-root"');

    const innerButton = snap.interactiveElements.find((el) => el.frameId === "panel-frame" && el.tag === "button");
    expect(innerButton).toBeDefined();
    expect(innerButton!.selectors).toContain("#inner-btn");
    // 主文档的 iframe 元素本身也是交互元素
    expect(snap.interactiveElements.some((el) => el.tag === "iframe")).toBe(true);
  });

  it("验证码：canvas / captcha 输入识别 + CSRF 隐藏域标记", async () => {
    const snap = await xray("/captcha");
    expect(snap.repeatedGroups).toHaveLength(0);

    const canvas = snap.interactiveElements.find((el) => el.tag === "canvas");
    expect(canvas).toBeDefined();
    expect(canvas!.isCaptchaOrCanvas).toBe(true);
    expect(canvas!.selectors).toContain("#captcha-canvas");

    const captchaInput = snap.interactiveElements.find((el) => el.id === "captcha-input");
    expect(captchaInput).toBeDefined();
    expect(captchaInput!.isCaptchaOrCanvas).toBe(true);

    const userInput = snap.interactiveElements.find((el) =>
      el.selectors.some((s) => s.includes('name="user"')),
    );
    expect(userInput).toBeDefined();
    expect(userInput!.hasCsrfOrHiddenInputs).toBe(true);
    expect(userInput!.formAction).toBe("/login");
    expect(userInput!.formMethod).toBe("POST");

    const submit = snap.interactiveElements.find((el) => el.tag === "button");
    expect(submit).toBeDefined();
    expect(submit!.type).toBe("submit");
    expect(submit!.label).toBe("Login");
    expect(submit!.hasCsrfOrHiddenInputs).toBe(true);
  });

  it("追踪拦截：tracker 子资源被 abort，不触达 fixture 服务器", async () => {
    const blockedUrls: string[] = [];
    const dir = await mkdtemp(join(tmpdir(), "wr-domxray-"));
    tempDirs.push(dir);
    const snap = await mapSite({
      url: `${baseUrl}/tracker-page`,
      outDir: dir,
      browser,
      settleMs: 200,
      onBlockedRequest: (url) => blockedUrls.push(url),
    });

    expect(blockedUrls.some((u) => u.includes("/tracker.js"))).toBe(true);
    expect(blockedUrls.some((u) => u.includes("/api/telemetry/collect"))).toBe(true);
    expect(blockedUrls.some((u) => u.includes("/analytics/pixel.gif"))).toBe(true);

    // 服务器侧从未收到被拦截的请求
    expect(hits).not.toContain("/tracker.js");
    expect(hits.some((h) => h.includes("/telemetry"))).toBe(false);
    expect(hits.some((h) => h.includes("/analytics/pixel.gif"))).toBe(false);
    // 正常子资源与主文档请求未被误伤
    expect(hits).toContain("/style.css");
    expect(hits.some((h) => h.includes("/logo.png"))).toBe(true);
    expect(hits).toContain("/tracker-page");
    await expectPng(snap.beforeScreenshotPath);
  });

  it("骨架裁剪：超预算页面收敛到 ≤16KB，保留头部地标并标记裁剪级别", async () => {
    const snap = await xray("/big");
    expect(() => SiteSnapshotSchema.parse(snap)).not.toThrow();

    expect(Buffer.byteLength(snap.domSkeletonHtml, "utf8")).toBeLessThanOrEqual(16384);
    expect(snap.domSkeletonHtml).toMatch(/data-wr-crop="L[1-5]"/);
    // 尾部整棵丢弃：头部条目保留、尾部条目消失
    expect(snap.domSkeletonHtml).toContain('id="item-0"');
    expect(snap.domSkeletonHtml).not.toContain('id="item-899"');
    expect(snap.beforeScreenshotPath.endsWith("before.png")).toBe(true);
    await expectPng(snap.beforeScreenshotPath);
  });

  it("非法输入：非 http/https 与坏 URL 直接抛错", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wr-domxray-"));
    tempDirs.push(dir);
    await expect(mapSite({ url: "ftp://example.com/x", outDir: dir })).rejects.toThrow(/http\/https/);
    await expect(mapSite({ url: "not-a-url", outDir: dir })).rejects.toThrow();
  });
});
