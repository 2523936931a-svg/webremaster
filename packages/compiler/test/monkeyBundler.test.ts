/**
 * MonkeyBundler 单测：正常打包 / tsc 门禁 / vite 门禁。
 *
 * 皮肤修复件（entry.tsx / skin.css）与产物都放在 <compiler>/node_modules/.cache 下：
 * 1) 裸导入（react、tailwindcss）沿 node_modules 链解析到本包依赖；
 * 2) 该目录被根 .gitignore 覆盖，不污染仓库。
 * Vite 真实构建 + TypeScript Program API 门禁在此全量执行（引擎按需动态加载工具链）。
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import type { SiteContract } from "@webremaster/schema";
import {
  bundleMonkeySkin,
  MonkeyBundleError,
  stripJsStringsAndComments,
} from "../src/bundler/monkeyBundler.js";

const compilerDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testRoot = path.join(compilerDir, "node_modules", ".cache", "webremaster-monkey-test");

async function createFixtureDir(label: string): Promise<string> {
  const dir = path.join(testRoot, `${label}-${randomUUID().slice(0, 8)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function writeFixture(dir: string, fileName: string, content: string): Promise<string> {
  const filePath = path.join(dir, fileName);
  await writeFile(filePath, content, "utf8");
  return filePath;
}

function expectBundleError(error: unknown): MonkeyBundleError {
  if (error instanceof MonkeyBundleError) {
    return error;
  }
  throw new Error(`期望抛出 MonkeyBundleError，实际：${String(error)}`);
}

interface TypecheckFailureDetails {
  errors: Array<{ file: string; line: number; character: number; code: string; message: string }>;
  totalErrorCount: number;
  stagingDir: string;
}

interface BuildFailureDetails {
  buildErrors: string[];
  stagingDir: string;
}

interface GateFailureDetails {
  failures: Array<{ check: string; detail: string }>;
  stagingDir: string;
}

const contract: SiteContract = {
  siteId: "hacker-news",
  siteName: "Hacker News",
  matchPatterns: ["https://news.ycombinator.com/*"],
  routes: [
    {
      routeId: "front-page",
      urlRegex: "^https://news\\.ycombinator\\.com/?$",
      domFingerprintSelector: "#hnmain",
      archetype: "news-feed",
      primaryListContainer: "table",
      primaryItemSelector: "tr.athing",
      itemFields: [
        {
          fieldName: "title",
          fieldType: "string",
          selectors: ["tr.athing td.title > a"],
          attribute: "textContent",
          required: true,
        },
      ],
    },
  ],
  enableTurboNav: true,
  recommendedPowerUps: ["cmd-k-search"],
};

const SKIN_CSS = '@import "tailwindcss";\n@source "./";\n';

const VALID_ENTRY = `import { createRoot } from "react-dom/client";
import type { ReactElement } from "react";
import type { SiteContract } from "@webremaster/schema";
import "./skin.css";

interface SkinMountContext {
  host: HTMLElement;
  shadowRoot: ShadowRoot;
  contract: SiteContract;
}

function FeedPreview(props: { siteName: string }): ReactElement {
  return (
    <section className="rounded-xl bg-slate-900 p-4 text-slate-100">
      <h2 className="text-lg font-bold">{props.siteName}</h2>
    </section>
  );
}

export default function mountSkin(context: SkinMountContext): void {
  const rootEl = document.createElement("div");
  rootEl.className = "wr-skin-root";
  context.shadowRoot.appendChild(rootEl);
  createRoot(rootEl).render(<FeedPreview siteName={context.contract.siteName} />);
}
`;

const TYPE_ERROR_ENTRY = `import type { SiteContract } from "@webremaster/schema";

export default function mountSkin(context: { contract: SiteContract }): void {
  const broken: number = context.contract.siteName;
}
`;

const NO_DEFAULT_EXPORT_ENTRY = `export function mountSkin(context: { shadowRoot: ShadowRoot }): void {
  context.shadowRoot.appendChild(document.createElement("div"));
}
`;

const SYNTAX_ERROR_ENTRY = `export default function mountSkin(context: { shadowRoot: ShadowRoot }): void {
  const el = document.createElement("div"
  context.shadowRoot.appendChild(el);
}
`;

const MISSING_CSS_ENTRY = `import "./missing.css";

export default function mountSkin(context: { shadowRoot: ShadowRoot }): void {
  context.shadowRoot.appendChild(document.createElement("div"));
}
`;

const NO_CSS_ENTRY = `export default function mountSkin(context: { shadowRoot: ShadowRoot }): void {
  const el = document.createElement("div");
  el.className = "rounded-xl";
  context.shadowRoot.appendChild(el);
}
`;

afterAll(async () => {
  await rm(testRoot, { recursive: true, force: true });
});

describe("monkeyBundler 正常打包", () => {
  it("React + Tailwind v4 皮肤被打包为单个零闪烁 .user.js", async () => {
    const dir = await createFixtureDir("normal");
    const entryPath = await writeFixture(dir, "entry.tsx", VALID_ENTRY);
    await writeFixture(dir, "skin.css", SKIN_CSS);
    const outFile = path.join(dir, "hacker-news.user.js");

    const result = await bundleMonkeySkin({
      contract,
      entry: entryPath,
      outFile,
      userscript: { version: "2.3.4", description: "HN 零闪烁重制皮肤（打包单测）" },
    });

    // 双门禁全绿
    expect(result.gate.typecheck.ok).toBe(true);
    expect(result.gate.typecheck.errorCount).toBe(0);
    expect(result.gate.build.ok).toBe(true);
    expect(result.gate.artifactGate.ok).toBe(true);

    // 头部解析
    expect(result.header.name).toBe("WebRemaster · Hacker News");
    expect(result.header.version).toBe("2.3.4");
    expect(result.header.runAt).toBe("document-start");
    expect(result.header.match).toEqual(["https://news.ycombinator.com/*"]);
    expect(result.header.grant).toEqual(["none"]);

    // 产物落盘与元数据块
    const code = await readFile(outFile, "utf8");
    expect(result.outFile).toBe(outFile);
    expect(result.sizeBytes).toBe(Buffer.byteLength(code, "utf8"));
    expect(code.startsWith("// ==UserScript==")).toBe(true);
    expect(code).toContain("// @match        https://news.ycombinator.com/*");
    expect(code).toContain("// @run-at       document-start");
    expect(code).toContain("const __WR_CSS__ = ");

    // Tailwind v4 真的编译了（工具类出现在回注 CSS 中）
    expect(code).toContain(".rounded-xl");

    // 零闪烁时序埋点：幕帘先于挂载
    expect(code).toContain("wrCurtainAt");
    expect(code).toContain("wrMountedAt");
    expect(code.indexOf("wrCurtainAt")).toBeLessThan(code.indexOf("wrMountedAt"));

    // 单文件自包含：无任何外部引用残留
    const stripped = stripJsStringsAndComments(code);
    expect(stripped).not.toMatch(/\bimport\s*\(/);
    expect(stripped).not.toMatch(/\brequire\s*\(/);

    // React 运行时被内联（体积远大于空壳），CSS 产物非空
    expect(result.jsBytes).toBeGreaterThan(50_000);
    expect(result.cssBytes).toBeGreaterThan(0);
  }, 180_000);

  it("拒绝破坏零闪烁时序的 run-at 覆盖", async () => {
    const dir = await createFixtureDir("runat");
    const entryPath = await writeFixture(dir, "entry.tsx", VALID_ENTRY);

    await expect(
      bundleMonkeySkin({
        contract,
        entry: entryPath,
        outFile: path.join(dir, "out.user.js"),
        userscript: { runAt: "document-end" },
      }),
    ).rejects.toMatchObject({ code: "invalid-options" });
  });
});

describe("monkeyBundler tsc 门禁", () => {
  it("类型错误的皮肤源码被拦截，并保留暂存现场", async () => {
    const dir = await createFixtureDir("tsc-type");
    const entryPath = await writeFixture(dir, "entry.tsx", TYPE_ERROR_ENTRY);

    const thrown = await bundleMonkeySkin({
      contract,
      entry: entryPath,
      outFile: path.join(dir, "out.user.js"),
    }).then(
      () => null,
      (error: unknown) => error,
    );

    const bundleError = expectBundleError(thrown);
    expect(bundleError.code).toBe("typecheck-failed");
    const details = bundleError.details as TypecheckFailureDetails;
    expect(details.totalErrorCount).toBeGreaterThan(0);
    expect(details.errors.some((item) => item.code === "TS2322")).toBe(true);
    expect(details.errors.some((item) => item.file.endsWith("entry.tsx"))).toBe(true);
    expect(existsSync(details.stagingDir)).toBe(true);
  }, 180_000);

  it("缺少默认导出的皮肤无法通过挂载协议校验", async () => {
    const dir = await createFixtureDir("tsc-protocol");
    const entryPath = await writeFixture(dir, "entry.tsx", NO_DEFAULT_EXPORT_ENTRY);

    const thrown = await bundleMonkeySkin({
      contract,
      entry: entryPath,
      outFile: path.join(dir, "out.user.js"),
    }).then(
      () => null,
      (error: unknown) => error,
    );

    const bundleError = expectBundleError(thrown);
    expect(bundleError.code).toBe("typecheck-failed");
    const details = bundleError.details as TypecheckFailureDetails;
    expect(details.errors.some((item) => item.message.includes("default export"))).toBe(true);
  }, 180_000);

  it("语法错误的皮肤在 tsc 阶段即被拦截", async () => {
    const dir = await createFixtureDir("tsc-syntax");
    const entryPath = await writeFixture(dir, "entry.tsx", SYNTAX_ERROR_ENTRY);

    const thrown = await bundleMonkeySkin({
      contract,
      entry: entryPath,
      outFile: path.join(dir, "out.user.js"),
    }).then(
      () => null,
      (error: unknown) => error,
    );

    const bundleError = expectBundleError(thrown);
    expect(bundleError.code).toBe("typecheck-failed");
    const details = bundleError.details as TypecheckFailureDetails;
    expect(details.totalErrorCount).toBeGreaterThan(0);
    expect(details.errors.some((item) => item.file.endsWith("entry.tsx"))).toBe(true);
  }, 180_000);
});

describe("monkeyBundler vite 门禁", () => {
  it("无法解析的样式导入让 Vite 构建失败并保留现场", async () => {
    const dir = await createFixtureDir("vite-unresolved");
    const entryPath = await writeFixture(dir, "entry.tsx", MISSING_CSS_ENTRY);

    const thrown = await bundleMonkeySkin({
      contract,
      entry: entryPath,
      outFile: path.join(dir, "out.user.js"),
    }).then(
      () => null,
      (error: unknown) => error,
    );

    const bundleError = expectBundleError(thrown);
    expect(bundleError.code).toBe("build-failed");
    const details = bundleError.details as BuildFailureDetails;
    expect(details.buildErrors.length).toBeGreaterThan(0);
    expect(details.buildErrors.join("\n")).toContain("missing.css");
    expect(existsSync(details.stagingDir)).toBe(true);
  }, 180_000);

  it("缺少 CSS 产物的打包结果被产物门禁拒绝", async () => {
    const dir = await createFixtureDir("vite-nocss");
    const entryPath = await writeFixture(dir, "entry.tsx", NO_CSS_ENTRY);

    const thrown = await bundleMonkeySkin({
      contract,
      entry: entryPath,
      outFile: path.join(dir, "out.user.js"),
    }).then(
      () => null,
      (error: unknown) => error,
    );

    const bundleError = expectBundleError(thrown);
    expect(bundleError.code).toBe("gate-failed");
    const details = bundleError.details as GateFailureDetails;
    expect(details.failures.some((failure) => failure.check === "css-present")).toBe(true);
    expect(existsSync(details.stagingDir)).toBe(true);
  }, 180_000);
});
