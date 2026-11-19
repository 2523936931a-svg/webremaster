/**
 * wr CLI 单测（零网络，不触碰 playwright / liveVerifier / LLM）：
 * ① buildProgram 结构锁定（六条命令名称、必填项、默认值）；
 * ② finalizeSkinHandler 绿灯路径（manifest.json 生成 + SkinManifestSchema 校验）；
 * ③ finalizeSkinHandler 红灯路径（门禁未全绿 / vlm-score 不足 / 产物缺失 → CliExitError，不落盘）。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CommanderError } from "commander";
import { afterEach, describe, expect, it } from "vitest";
import {
  SiteContractSchema,
  SiteSnapshotSchema,
  SkinManifestSchema,
  VerificationReportSchema,
  type SiteContract,
  type SiteSnapshot,
  type VerificationReport,
} from "@webremaster/schema";
import { CliExitError, buildProgram, finalizeSkinHandler } from "../src/cli.js";

const SITE_ID = "example-site";
const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

interface SeededSkinDir {
  rootDir: string;
  skinsDir: string;
  skinDir: string;
}

function makeSkinDir(): SeededSkinDir {
  const rootDir = mkdtempSync(path.join(tmpdir(), "wr-cli-test-"));
  createdDirs.push(rootDir);
  const skinsDir = path.join(rootDir, "skins");
  const skinDir = path.join(skinsDir, SITE_ID);
  mkdirSync(skinDir, { recursive: true });
  return { rootDir, skinsDir, skinDir };
}

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function makeSnapshot(): SiteSnapshot {
  return SiteSnapshotSchema.parse({
    siteId: SITE_ID,
    url: "https://news.example.com/list",
    matchPatterns: ["https://news.example.com/*"],
    capturedAt: new Date().toISOString(),
    title: "Example News List",
    viewport: { width: 1280, height: 720 },
    hasFramesetOrIframes: false,
    sameOriginFrames: [],
    domSkeletonHtml: '<html><body><ul class="list"><li><a href="/a">A</a></li></ul></body></html>',
    repeatedGroups: [
      {
        groupId: "grp-items",
        containerSelector: "ul.list",
        itemSelector: "ul.list > li",
        pairingMode: "single",
        totalCount: 12,
        sampleItemsHtml: [
          '<li><a href="/a">A</a></li>',
          '<li><a href="/b">B</a></li>',
          '<li><a href="/c">C</a></li>',
        ],
      },
    ],
    interactiveElements: [],
    originalItemCountHint: 12,
    beforeScreenshotPath: "before.png",
  });
}

function makeContract(): SiteContract {
  return SiteContractSchema.parse({
    siteId: SITE_ID,
    siteName: "Example News",
    matchPatterns: ["https://news.example.com/*"],
    routes: [
      {
        routeId: "front-page",
        urlRegex: "^/list",
        domFingerprintSelector: "ul.list",
        archetype: "news-feed",
        primaryListContainer: "ul.list",
        primaryItemSelector: "ul.list > li",
        pairingMode: "single",
        itemFields: [
          { fieldName: "title", fieldType: "string", selectors: ["a.title"], attribute: "textContent", required: true },
          { fieldName: "url", fieldType: "url", selectors: ["a.title"], attribute: "href", required: false },
        ],
      },
    ],
    enableTurboNav: true,
    recommendedPowerUps: ["cmd-k-search"],
  });
}

function makeGates(passed: boolean): Array<{ gateName: string; passed: boolean; score: number; details: string }> {
  const gateNames = ["data-parity", "item-count", "dom-fidelity", "extractor-health", "boot-timing", "vlm-visual"];
  return gateNames.map((gateName) =>
    passed
      ? { gateName, passed: true, score: 1, details: "ok" }
      : { gateName, passed: false, score: 0, details: "remastered item count mismatch" },
  );
}

function makeReport(gatesPassed: boolean): VerificationReport {
  return VerificationReportSchema.parse({
    siteId: SITE_ID,
    passed: gatesPassed,
    repairRoundsUsed: 0,
    originalItemCount: 12,
    remasteredItemCount: gatesPassed ? 12 : 3,
    dataParityRatio: gatesPassed ? 1 : 0.25,
    vlmScore: gatesPassed ? 9.2 : 4,
    vlmFeedback: gatesPassed ? "还原完整，布局现代" : "列表条目大量缺失",
    gates: makeGates(gatesPassed),
    extractorHealthSummary: { title: { tier: 1, hits: 12, misses: 0 } },
    totalTokensUsed: 4321,
    verifiedAt: new Date().toISOString(),
  });
}

/** 伪造一套「可 finalize」的皮肤工作目录：01/02/05 齐全 + 假 .user.js。 */
function seedGreenSkinDir(): SeededSkinDir {
  const seeded = makeSkinDir();
  writeJson(path.join(seeded.skinDir, "01_snapshot.json"), makeSnapshot());
  writeJson(path.join(seeded.skinDir, "02_contract.json"), makeContract());
  writeJson(path.join(seeded.skinDir, "05_verification.json"), makeReport(true));
  writeFileSync(
    path.join(seeded.skinDir, `${SITE_ID}.user.js`),
    "// ==UserScript==\n// ==/UserScript==\nconsole.log('skin');\n",
    "utf8",
  );
  return seeded;
}

function finalizeOptions(skinsDir: string, overrides: Partial<{ vlmScore: number; category: string }> = {}) {
  return {
    siteId: SITE_ID,
    skinsDir,
    vlmScore: 9.2,
    category: "news",
    taglineZh: "极简新闻重制",
    taglineEn: "Minimal news remaster",
    ...overrides,
  };
}

describe("buildProgram（结构锁定）", () => {
  const program = buildProgram();

  it("程序名 wr / 版本 0.1.0 / 命令名称与顺序", () => {
    expect(program.name()).toBe("wr");
    expect(program.version()).toBe("0.1.0");
    expect(program.commands.map((command) => command.name())).toEqual([
      "auth-record",
      "inspect",
      "build-skin",
      "verify-skin",
      "finalize-skin",
      "compile",
      "sync-artifacts",
    ]);
  });

  it("前六条原子命令都带必填位置参数（Argument.required）", () => {
    const positionalCommands = program.commands.filter((c) => c.name() !== "sync-artifacts");
    for (const command of positionalCommands) {
      expect(command.registeredArguments.length).toBeGreaterThan(0);
      for (const argument of command.registeredArguments) {
        expect(argument.required).toBe(true);
      }
    }
  });

  it("必填参数缺失即拒绝（CommanderError，不触发 handler）", async () => {
    const positionalCommands = program.commands.filter((c) => c.name() !== "sync-artifacts");
    for (const command of positionalCommands) {
      // commander 对缺失位置参数报 "missing required argument"，对缺失必填选项报 "required option ... not specified"
      await expect(command.parseAsync([], { from: "user" })).rejects.toThrow(
        /missing required argument|required option .+ not specified/,
      );
    }
  });

  it("finalize-skin 四个必填选项（mandatory）与行为验证", async () => {
    const command = program.commands.find((candidate) => candidate.name() === "finalize-skin");
    expect(command).toBeDefined();
    const mandatoryFlags = command?.options.filter((option) => option.mandatory).map((option) => option.long);
    expect(mandatoryFlags).toEqual(["--vlm-score", "--category", "--tagline-zh", "--tagline-en"]);
    expect(command?.options.find((option) => option.long === "--skins-dir")?.mandatory).toBe(false);
    // 行为验证：位置参数已给但必填选项缺 → required option 报错（不触发 action）
    await expect(command?.parseAsync([SITE_ID, "--vlm-score", "9.2"], { from: "user" })).rejects.toThrow(/required option '--category <cat>' not specified/);
  });

  it("inspect --id 与 compile --id 均为必填选项", () => {
    const inspect = program.commands.find((candidate) => candidate.name() === "inspect");
    const compile = program.commands.find((candidate) => candidate.name() === "compile");
    expect(inspect?.options.find((option) => option.long === "--id")?.mandatory).toBe(true);
    expect(compile?.options.find((option) => option.long === "--id")?.mandatory).toBe(true);
  });

  it("默认值：--out / --out-dir / --skins-dir / --max-rounds / --no-minify 开关", () => {
    const authRecord = program.commands.find((candidate) => candidate.name() === "auth-record");
    const inspect = program.commands.find((candidate) => candidate.name() === "inspect");
    const buildSkin = program.commands.find((candidate) => candidate.name() === "build-skin");
    const compile = program.commands.find((candidate) => candidate.name() === "compile");
    expect(authRecord?.options.find((option) => option.long === "--out")?.defaultValue).toBe("./storageState.json");
    expect(inspect?.options.find((option) => option.long === "--out-dir")?.defaultValue).toBe("./skins");
    expect(buildSkin?.options.find((option) => option.long === "--skins-dir")?.defaultValue).toBe("./skins");
    const minifyOption = buildSkin?.options.find((option) => option.long === "--no-minify");
    expect(minifyOption).toBeDefined();
    expect(minifyOption?.negate).toBe(true);
    expect(compile?.options.find((option) => option.long === "--max-rounds")?.defaultValue).toBe("4");
  });
});

describe("finalizeSkinHandler（绿灯）", () => {
  it("门禁全绿 + vlm-score≥8.5：生成 manifest.json，落盘内容通过 SkinManifestSchema 且字段按契约组装", () => {
    const { skinsDir, skinDir } = seedGreenSkinDir();
    const manifest = finalizeSkinHandler(finalizeOptions(skinsDir));

    const manifestPath = path.join(skinDir, "manifest.json");
    expect(existsSync(manifestPath)).toBe(true);
    const onDisk = SkinManifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8")) as unknown);
    expect(onDisk).toEqual(manifest);

    expect(manifest.id).toBe(SITE_ID);
    expect(manifest.name).toBe("Example News");
    expect(manifest.category).toBe("news");
    expect(manifest.targetUrl).toBe("https://news.example.com/list");
    expect(manifest.matchPatterns).toEqual(["https://news.example.com/*"]);
    expect(manifest.archetype).toBe("news-feed");
    expect(manifest.tagline).toEqual({ zh: "极简新闻重制", en: "Minimal news remaster" });
    expect(manifest.enhancements).toEqual(["cmd-k-search"]);
    expect(manifest.userscriptFile).toBe(`${SITE_ID}.user.js`);
    expect(manifest.beforeImage).toBe("before.png");
    expect(manifest.afterImage).toBe("after.png");
    expect(manifest.vlmScore).toBe(9.2);
    expect(manifest.dataParityRatio).toBe(1);
    expect(manifest.bundleSizeKb).toBeGreaterThan(0);
    expect(manifest.tokensUsedToCompile).toBe(4321);
    expect(manifest.version).toBe("0.1.0");
  });

  it("manifest.json 原子写：磁盘上不残留 .tmp 文件", () => {
    const { skinsDir, skinDir } = seedGreenSkinDir();
    finalizeSkinHandler(finalizeOptions(skinsDir));
    expect(existsSync(`${path.join(skinDir, "manifest.json")}.tmp`)).toBe(false);
  });
});

describe("finalizeSkinHandler（红灯）", () => {
  it("门禁未全绿：抛 CliExitError(exitCode=1) 且不落 manifest.json", () => {
    const { skinsDir, skinDir } = makeSkinDir();
    writeJson(path.join(skinDir, "01_snapshot.json"), makeSnapshot());
    writeJson(path.join(skinDir, "02_contract.json"), makeContract());
    writeJson(path.join(skinDir, "05_verification.json"), makeReport(false));
    writeFileSync(path.join(skinDir, `${SITE_ID}.user.js`), "console.log('skin');\n", "utf8");

    expect(() => finalizeSkinHandler(finalizeOptions(skinsDir))).toThrow(CliExitError);
    try {
      finalizeSkinHandler(finalizeOptions(skinsDir));
      expect.unreachable("门禁未全绿必须抛错");
    } catch (error) {
      expect(error).toBeInstanceOf(CliExitError);
      expect((error as CliExitError).exitCode).toBe(1);
      expect((error as CliExitError).message).toContain("门禁未全绿");
    }
    expect(existsSync(path.join(skinDir, "manifest.json"))).toBe(false);
  });

  it("vlm-score 低于上架线 8.5：拒绝（门禁全绿也不放行）", () => {
    const { skinsDir, skinDir } = seedGreenSkinDir();
    expect(() => finalizeSkinHandler(finalizeOptions(skinsDir, { vlmScore: 8.4 }))).toThrow(CliExitError);
    expect(existsSync(path.join(skinDir, "manifest.json"))).toBe(false);
  });

  it("缺 05_verification.json：抛 CliExitError 并指明缺失文件", () => {
    const { skinsDir, skinDir } = seedGreenSkinDir();
    rmSync(path.join(skinDir, "05_verification.json"));
    expect(() => finalizeSkinHandler(finalizeOptions(skinsDir))).toThrow(/05_verification\.json/);
  });

  it("缺 .user.js：抛 CliExitError 并提示先 build-skin", () => {
    const { skinsDir, skinDir } = seedGreenSkinDir();
    rmSync(path.join(skinDir, `${SITE_ID}.user.js`));
    expect(() => finalizeSkinHandler(finalizeOptions(skinsDir))).toThrow(/build-skin/);
    expect(existsSync(path.join(skinDir, "manifest.json"))).toBe(false);
  });
});
