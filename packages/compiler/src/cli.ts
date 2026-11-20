#!/usr/bin/env node
/**
 * wr —— WebRemaster Agent-Native 零 Key CLI（commander + chalk + ora，纯 ESM）。
 *
 * 结构锁定：buildProgram() 是唯一的命令装配出口；六条命令全部真实接线；
 * handler 拆分为可导出函数，内部只抛错/返回结果，绝不 process.exit——
 * 进程退出码由命令层（guard / 命令 action / main 入口）统一转换，测试进程安全。
 *
 * 工程决策：
 * - 重依赖（playwright / domXray / monkeyBundler / liveVerifier）按命令惰性动态加载：
 *   CLI 冷启动不拖浏览器与 vite，finalize 等纯本地命令可在毫秒级完成，
 *   单测也可以在不触发这些模块的前提下直接调用 handler；
 * - ./verifier/liveVerifier.js 由同批次并行任务交付，运行时按需解析（verify-skin / compile 才加载）；
 * - LLM 面全部走 ./llm/gateway.js 的 LlmGateway（三档熔断 + JSON 回炉 + 可恢复重试），
 *   结构化产出经网关 completeStructured 通道（"code" / "vision" 两档）完成。
 */
import { Command, CommanderError } from "commander";
import chalk from "chalk";
import ora from "ora";
import yaml from "yaml";
import { z } from "zod";

import { zodToJsonSchema } from "zod-to-json-schema";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import {
  SiteContractSchema,
  SiteSnapshotSchema,
  SkinManifestSchema,
  UXDesignSpecSchema,
  VerificationReportSchema,
  type SiteContract,
  type SiteSnapshot,
  type SkinManifest,
  type UXDesignSpec,
  type VerificationReport,
} from "@webremaster/schema";
import { LlmGateway, type LlmImage, type LlmMessage } from "./llm/gateway.js";
import type { MonkeyBundleResult } from "./bundler/monkeyBundler.js";
import {
  syncArtifactsHandler,
  type SyncArtifactsOptions,
  type SyncArtifactsResult,
} from "./integrator/syncArtifacts.js";

export {
  syncArtifactsHandler,
  type SyncArtifactsOptions,
  type SyncArtifactsResult,
};

/* ------------------------------------------------------------------ */
/* 常量与小型工具                                                       */
/* ------------------------------------------------------------------ */

/** compile / VLM 评审使用的默认模型（可用 WR_MODEL 环境变量覆盖）。 */
const DEFAULT_MODEL = "gpt-4o";
/** 上架 VLM 分数线。 */
const MIN_VLM_SCORE = 8.5;
/** 皮肤清单版本（与 @webremaster/compiler 0.1.0 对齐）。 */
const SKIN_VERSION = "0.1.0";
/** 各阶段产物文件名（目录结构锁定：skins/<siteId>/ 下）。 */
const SNAPSHOT_FILE = "01_snapshot.json";
const CONTRACT_FILE = "02_contract.json";
const DESIGN_FILE = "03_design.json";
const VERIFICATION_FILE = "05_verification.json";
const COMPILE_STATE_FILE = ".wr-compile-state.json";
/** 活体验证器模块说明符（同批次交付；运行时解析，verify-skin / compile 才加载）。 */
const LIVE_VERIFIER_SPECIFIER = "./verifier/liveVerifier.js";

/** CLI 业务错误：message 为红字主因，details 为灰字补充，exitCode 交给命令层。 */
export class CliExitError extends Error {
  readonly exitCode: number;
  readonly details?: string;

  constructor(message: string, exitCode = 1, details?: string) {
    super(message);
    this.name = "CliExitError";
    this.exitCode = exitCode;
    this.details = details;
  }
}

/**
 * 皮肤打包门禁失败（tsc / vite / 产物自检）：可经「重写皮肤源码」自愈。
 * compile 的重试循环只把这类的 details 附回 SkinCodegen 提示词；
 * 其余 CliExitError（合同缺失/校验失败、入口缺失等）视为不可修复，直接上抛。
 */
export class SkinBuildGateError extends CliExitError {
  constructor(message: string, details?: string) {
    super(message, 1, details);
    this.name = "SkinBuildGateError";
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function truncateSingleLine(text: string, maxLength: number): string {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length > maxLength ? `${single.slice(0, Math.max(maxLength - 1, 1))}…` : single;
}

/** 命令行选项收窄：unknown → string（缺失/为空即业务错误）。 */
function optString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new CliExitError(`选项 --${label} 缺失或不是非空字符串`);
  }
  return value;
}

/** 命令行选项收窄：unknown → string | undefined。 */
function optOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** 命令行选项收窄：unknown → number（非法数字即业务错误）。 */
function optNumber(value: unknown, label: string, fallback?: number): number {
  if (value === undefined) {
    if (fallback !== undefined) return fallback;
    throw new CliExitError(`选项 --${label} 缺失`);
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new CliExitError(`选项 --${label} 不是合法数字：${String(value)}`);
  }
  return parsed;
}

/** 命令行选项收窄：布尔开关（commander 的 --no-x 旗标缺省为 true）。 */
function optBoolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === true;
}

/** 列出 zod 校验 issues（逐条 path + message）。 */
function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  - ${issue.path.length > 0 ? issue.path.join(".") : "<root>"}: ${issue.message}`)
    .join("\n");
}

/** 读 + JSON.parse + zod 校验一步到位；所有失败都转成带定位信息的 CliExitError。 */
function parseJsonFile<T>(filePath: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, label: string): T {
  if (!existsSync(filePath)) {
    throw new CliExitError(`${label}不存在：${filePath}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  } catch (error) {
    throw new CliExitError(`${label}不是合法 JSON：${filePath}`, 1, errorMessage(error));
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new CliExitError(`${label}校验失败（${filePath}）：\n${formatZodIssues(parsed.error)}`);
  }
  return parsed.data;
}

/** 原子写 JSON：<file>.tmp 先落盘，再 fs.renameSync 换名（finalize/阶段产物共用）。 */
function atomicWriteJson(filePath: string, value: unknown): void {
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tmpPath, filePath);
}

function hasOpenAiKey(): boolean {
  const apiKey = process.env.OPENAI_API_KEY;
  return apiKey !== undefined && apiKey.length > 0;
}

function assertOpenAiKey(purpose: string): void {
  if (!hasOpenAiKey()) {
    throw new CliExitError(`缺少 OPENAI_API_KEY：${purpose}需要调用 LLM 网关。请设置环境变量（可用 OPENAI_BASE_URL / WR_MODEL 指向兼容网关与模型），或改用免 Key 的本地命令（inspect / build-skin / verify-skin --no-vlm）。`);
  }
}

function resolveModel(): string {
  const fromEnv = process.env.WR_MODEL;
  return fromEnv !== undefined && fromEnv.length > 0 ? fromEnv : DEFAULT_MODEL;
}

function pngDataUrl(filePath: string): string {
  if (!existsSync(filePath)) {
    throw new CliExitError(`图片不存在：${filePath}`);
  }
  return `data:image/png;base64,${readFileSync(filePath).toString("base64")}`;
}

/* ------------------------------------------------------------------ */
/* VLM 视觉评审（OpenAI Gateway 通道）                                  */
/* ------------------------------------------------------------------ */

/** VLM 评审结论（vlmCritic 公开契约的返回面）。 */
export interface GatewayVlmCriticResult {
  score: number;
  feedback: string;
  tokensUsed: number;
}

/** VLM 评审器：输入重构前后两张 PNG 路径，输出打分与反馈。 */
export interface GatewayVlmCritic {
  score(beforePngPath: string, afterPngPath: string): Promise<GatewayVlmCriticResult>;
}

const VlmScoreSchema = z.object({
  overall: z.number().min(0).max(10),
  feedback: z.string(),
});

/** PNG 文件 → 网关图片输入（base64 无前缀）。 */
function pngImage(filePath: string): LlmImage {
  return { data: readFileSync(filePath).toString("base64"), mimeType: "image/png" };
}

/**
 * 网关版 VLM 评审器：读 OPENAI_API_KEY（缺失即红字报错退出），
 * 经 LlmGateway.completeStructured("vision", …) 以 before/after 双附图评审。
 */
export function createGatewayVlmCritic(): GatewayVlmCritic {
  if (!hasOpenAiKey()) {
    throw new CliExitError("缺少 OPENAI_API_KEY：VLM 视觉评审无法调用。请设置环境变量，或对 verify-skin 使用 --no-vlm 关闭视觉评审。");
  }
  const gateway = new LlmGateway({ model: resolveModel() });
  return {
    async score(beforePngPath: string, afterPngPath: string): Promise<GatewayVlmCriticResult> {
      const messages: LlmMessage[] = [
        {
          role: "user",
          content: [
            "你是 WebRemaster 的 VLM 视觉评审。对比同一站点「重构前（before）」与「重制皮肤（after）」两张全页截图（分别以第 1、2 张附图提供）。",
            "评分维度：① 信息保真——列表条目数、标题/元信息一条不少；② 布局现代感——栅格、留白、层级；③ 主题一致性——强调色与明暗运用；④ 可读性——字号对比与行宽。",
            `10 分为可直接上架；低于 ${MIN_VLM_SCORE} 视为不可上架。feedback 需给出可执行的具体修改建议（≤200 字）。`,
            `只输出符合以下 JSON Schema 的对象本身（禁止解释、禁止 Markdown 围栏）：${JSON.stringify(zodToJsonSchema(VlmScoreSchema))}`,
          ].join("\n"),
        },
      ];
      const completion = await gateway.completeStructured(
        "vision",
        { messages, images: [pngImage(beforePngPath), pngImage(afterPngPath)] },
        VlmScoreSchema,
      );
      return { score: completion.data.overall, feedback: completion.data.feedback, tokensUsed: completion.tokensUsed };
    },
  };
}

/* ------------------------------------------------------------------ */
/* 活体验证器的公开契约面（./verifier/liveVerifier.js，同批次交付）        */
/* ------------------------------------------------------------------ */

export interface VerifyRemasteredSkinOptions {
  snapshot: SiteSnapshot;
  contract: SiteContract;
  /** 打包产物 .user.js 路径（document-start 注入）。 */
  userscriptPath: string;
  /** 验证产物落盘目录（after.png / split.png / 05_verification.json）。 */
  outDir: string;
  enableVlm: boolean;
  vlmCritic?: (beforePngPath: string, afterPngPath: string) => Promise<{ score: number; feedback: string; tokensUsed?: number }>;
  storageStatePath?: string;
  proxy?: string;
  settleMs?: number;
}

interface LiveVerifierModule {
  verifyRemasteredSkin(options: VerifyRemasteredSkinOptions): Promise<VerificationReport>;
}

/** 运行时解析活体验证器；缺失/契约不符时给出可定位的业务错误而非裸 TypeError。 */
async function loadLiveVerifier(): Promise<LiveVerifierModule> {
  const loaded: unknown = await import(LIVE_VERIFIER_SPECIFIER);
  if (typeof loaded !== "object" || loaded === null) {
    throw new CliExitError(`模块 ${LIVE_VERIFIER_SPECIFIER} 加载结果异常（非对象命名空间）`);
  }
  const candidate = loaded as Partial<LiveVerifierModule>;
  if (typeof candidate.verifyRemasteredSkin !== "function") {
    throw new CliExitError(`模块 ${LIVE_VERIFIER_SPECIFIER} 未导出 verifyRemasteredSkin（活体验证器缺失或公开契约变更）`);
  }
  return loaded as LiveVerifierModule;
}

/* ------------------------------------------------------------------ */
/* handler 1：auth-record                                              */
/* ------------------------------------------------------------------ */

export interface AuthRecordOptions {
  url: string;
  out: string;
  proxy?: string;
}

export interface AuthRecordResult {
  storageStatePath: string;
}

/** 等待终端回车；stdin 提前关闭（agent 管道调用）时明确报错而非悬挂。 */
async function waitForEnter(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answered = rl.question("");
    const closed = new Promise<never>((_resolve, reject) => {
      rl.once("close", () => reject(new CliExitError("stdin 已关闭：保存登录态需要在交互终端按 Enter 确认")));
    });
    await Promise.race([answered, closed]);
  } finally {
    rl.close();
  }
}

export async function authRecordHandler(options: AuthRecordOptions): Promise<AuthRecordResult> {
  const outPath = path.resolve(options.out);
  mkdirSync(path.dirname(outPath), { recursive: true });
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    headless: false,
    ...(options.proxy !== undefined ? { proxy: { server: options.proxy } } : {}),
  });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(options.url);
    console.log(chalk.cyan(`已打开 ${options.url}（有头浏览器，请手工完成登录）`));
    console.log(chalk.yellow("登录完成后回终端按 Enter 保存登录态"));
    await waitForEnter();
    await context.storageState({ path: outPath });
    console.log(chalk.green(`✓ 登录态已保存：${outPath}`));
    return { storageStatePath: outPath };
  } finally {
    await browser.close().catch(() => undefined);
  }
}

/* ------------------------------------------------------------------ */
/* handler 2：inspect                                                  */
/* ------------------------------------------------------------------ */

export interface InspectOptions {
  url: string;
  siteId: string;
  auth?: string;
  outDir: string;
  proxy?: string;
}

export interface InspectOutcome {
  snapshot: SiteSnapshot;
  snapshotPath: string;
  beforePngPath: string;
}

export async function inspectHandler(options: InspectOptions): Promise<InspectOutcome> {
  if (options.auth !== undefined && !existsSync(options.auth)) {
    throw new CliExitError(`登录态文件不存在：${options.auth}（先运行 wr auth-record 生成）`);
  }
  const outDir = path.resolve(options.outDir, options.siteId);
  mkdirSync(outDir, { recursive: true });
  const spinner = ora(chalk.cyan(`DOM X-Ray 测绘中：${options.url} → ${outDir}`)).start();
  let snapshot: SiteSnapshot;
  try {
    const { mapSite } = await import("./inspector/domXray.js");
    snapshot = await mapSite({
      url: options.url,
      outDir,
      siteId: options.siteId,
      ...(options.auth !== undefined ? { storageStatePath: path.resolve(options.auth) } : {}),
      ...(options.proxy !== undefined ? { proxy: options.proxy } : {}),
    });
  } catch (error) {
    spinner.fail(chalk.red(`测绘失败：${errorMessage(error)}`));
    throw error;
  }
  const snapshotPath = path.join(outDir, SNAPSHOT_FILE);
  // mapSite 只落盘 before.png；快照 JSON 由 CLI 兜底补写（幂等：已存在不覆盖）。
  if (!existsSync(snapshotPath)) {
    writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  }
  const beforePngPath = snapshot.beforeScreenshotPath;
  spinner.succeed(
    chalk.green(
      `测绘完成：itemGroups=${snapshot.repeatedGroups.length}，originalItemCountHint=${snapshot.originalItemCountHint}`,
    ),
  );
  for (const group of snapshot.repeatedGroups) {
    console.log(chalk.dim(`  · ${group.groupId}（${group.pairingMode}）× ${group.totalCount} → ${group.itemSelector}`));
  }
  console.log(chalk.dim(`  before.png：${beforePngPath}`));
  console.log(chalk.dim(`  快照：${snapshotPath}`));
  return { snapshot, snapshotPath, beforePngPath };
}

/* ------------------------------------------------------------------ */
/* handler 3：build-skin                                               */
/* ------------------------------------------------------------------ */

export interface BuildSkinOptions {
  siteId: string;
  skinsDir: string;
  minify: boolean;
}

export interface BuildSkinOutcome {
  result: MonkeyBundleResult;
  sizeKb: number;
  artifactPath: string;
  entryPath: string;
}

/** 打包失败细节收窄：tsc 诊断 / vite 门禁失败 / 构建错误 → 逐行文本。 */
function formatBundleErrorDetails(details: unknown): string | undefined {
  if (typeof details !== "object" || details === null) return undefined;
  const record = details as { errors?: unknown; failures?: unknown; buildErrors?: unknown };
  const lines: string[] = [];
  if (Array.isArray(record.errors)) {
    for (const item of record.errors) {
      if (typeof item === "object" && item !== null) {
        const diag = item as { file?: unknown; line?: unknown; character?: unknown; code?: unknown; message?: unknown };
        lines.push(
          `${String(diag.file ?? "?")}:${String(diag.line ?? 0)}:${String(diag.character ?? 0)} ${String(diag.code ?? "")} ${String(diag.message ?? "")}`.trim(),
        );
      }
    }
  }
  if (Array.isArray(record.failures)) {
    for (const item of record.failures) {
      if (typeof item === "object" && item !== null) {
        const failure = item as { check?: unknown; detail?: unknown };
        lines.push(`[${String(failure.check ?? "?")}] ${String(failure.detail ?? "")}`);
      }
    }
  }
  if (Array.isArray(record.buildErrors)) {
    for (const item of record.buildErrors) {
      if (typeof item === "string") lines.push(item);
    }
  }
  return lines.length > 0 ? lines.join("\n") : undefined;
}

export async function buildSkinHandler(options: BuildSkinOptions): Promise<BuildSkinOutcome> {
  const skinDir = path.resolve(options.skinsDir, options.siteId);
  const contractPath = path.join(skinDir, CONTRACT_FILE);
  const contract = parseJsonFile(contractPath, SiteContractSchema, "站点合同");
  const entryPath = path.join(skinDir, "src", "entry.tsx");
  if (!existsSync(entryPath)) {
    throw new CliExitError(
      `皮肤入口不存在：${entryPath}\n入口须默认导出 mountSkin(context)。mountSkin 协议：context = { host: HTMLElement; shadowRoot: ShadowRoot; contract: SiteContract; originManager: OriginManager; originWrapper: HTMLElement; diagnostics: { healthSummary?: () => unknown; features?: { commandPalette?: boolean; diagnosticsDrawer?: boolean } } }——皮肤把 context 声明为其子集类型，挂载进 shadowRoot（React 19 createRoot），并可经 diagnostics 上报健康度与功能开关。`,
    );
  }
  const bundler = await import("./bundler/monkeyBundler.js");
  let result: MonkeyBundleResult;
  try {
    result = await bundler.bundleMonkeySkin({
      contract,
      entry: entryPath,
      outFile: path.join(skinDir, `${options.siteId}.user.js`),
      minify: options.minify,
    });
  } catch (error) {
    if (error instanceof bundler.MonkeyBundleError) {
      throw new SkinBuildGateError(`打包门禁未通过（${options.siteId}）：${error.message}`, formatBundleErrorDetails(error.details));
    }
    throw error;
  }
  const sizeKb = result.sizeBytes / 1024;
  console.log(chalk.green(`✓ 打包完成：${result.outFile}（${sizeKb.toFixed(1)} KB）`));
  console.log(
    `  tsc 门禁　：${result.gate.typecheck.ok ? chalk.green("✓ 通过") : chalk.red("✗ 未过")}（${result.gate.typecheck.durationMs}ms，${result.gate.typecheck.errorCount} 个错误）`,
  );
  console.log(
    `  vite 门禁　：${result.gate.build.ok ? chalk.green("✓ 通过") : chalk.red("✗ 未过")}（${result.gate.build.durationMs}ms）`,
  );
  console.log(
    `  产物自检　：${result.gate.artifactGate.ok ? chalk.green("✓ 通过") : chalk.red(`✗ ${result.gate.artifactGate.failures.map((failure) => failure.check).join("、")}`)}`,
  );
  const gateOk = result.gate.typecheck.ok && result.gate.build.ok && result.gate.artifactGate.ok;
  if (!gateOk) {
    throw new SkinBuildGateError(`打包三门禁未全部通过（${options.siteId}）`, formatBundleErrorDetails(result.gate));
  }
  return { result, sizeKb, artifactPath: result.outFile, entryPath };
}

/* ------------------------------------------------------------------ */
/* handler 4：verify-skin                                              */
/* ------------------------------------------------------------------ */

export interface VerifySkinOptions {
  siteId: string;
  skinsDir: string;
  enableVlm: boolean;
  auth?: string;
  proxy?: string;
  settleMs?: number;
}

/** 六重门禁表格 + VLM 反馈 + 数据对齐率 + 提取器健康摘要（chalk 表格）。 */
function printVerificationReport(report: VerificationReport): void {
  console.log(chalk.bold(`\n六重门禁（${report.siteId}）${report.passed ? chalk.green("—— 全部通过") : chalk.red("—— 未全绿")}`));
  const nameWidth = Math.max(...report.gates.map((gate) => gate.gateName.length), 8);
  for (const gate of report.gates) {
    const mark = gate.passed ? chalk.green("✓ 通过") : chalk.red("✗ 未过");
    console.log(
      `  ${gate.gateName.padEnd(nameWidth)}  ${mark}  得分 ${chalk.bold(gate.score.toFixed(1))}  ${chalk.dim(truncateSingleLine(gate.details, 72))}`,
    );
  }
  console.log(
    `  数据对齐率：${chalk.bold(`${(report.dataParityRatio * 100).toFixed(1)}%`)}（原始 ${report.originalItemCount} 项 → 重制 ${report.remasteredItemCount} 项，修复轮次 ${report.repairRoundsUsed}）`,
  );
  if (report.vlmFeedback.trim().length > 0) {
    console.log(`  VLM 反馈（${report.vlmScore.toFixed(1)}/10）：${chalk.cyan(report.vlmFeedback)}`);
  }
  console.log(chalk.bold("提取器健康摘要"));
  const healthEntries = Object.entries(report.extractorHealthSummary);
  if (healthEntries.length === 0) {
    console.log(chalk.dim("  （无字段遥测）"));
  }
  for (const [field, health] of healthEntries) {
    const healthy = health.hits > 0 && health.misses === 0;
    console.log(
      `  ${healthy ? chalk.green("✓") : chalk.yellow("⚠")} ${field}：tier=${health.tier} hits=${health.hits} misses=${health.misses}`,
    );
  }
}

export async function verifySkinHandler(options: VerifySkinOptions): Promise<VerificationReport> {
  const skinDir = path.resolve(options.skinsDir, options.siteId);
  const snapshot = parseJsonFile(path.join(skinDir, SNAPSHOT_FILE), SiteSnapshotSchema, "站点快照");
  const contract = parseJsonFile(path.join(skinDir, CONTRACT_FILE), SiteContractSchema, "站点合同");
  const vlmCritic = options.enableVlm ? createGatewayVlmCritic() : undefined;
  if (options.enableVlm) {
    console.log(chalk.cyan(`VLM 视觉评审已启用（模型 ${resolveModel()}，经 OpenAI 兼容网关）`));
  }
  const spinner = ora(chalk.cyan(`活体验证中：${options.siteId}（before/after 双图 + 六重门禁）`)).start();
  let report: VerificationReport;
  try {
    const { verifyRemasteredSkin } = await loadLiveVerifier();
    report = await verifyRemasteredSkin({
      snapshot,
      contract,
      userscriptPath: path.join(skinDir, `${options.siteId}.user.js`),
      outDir: skinDir,
      enableVlm: options.enableVlm,
      ...(vlmCritic !== undefined ? { vlmCritic: vlmCritic.score.bind(vlmCritic) } : {}),
      ...(options.auth !== undefined ? { storageStatePath: path.resolve(options.auth) } : {}),
      ...(options.proxy !== undefined ? { proxy: options.proxy } : {}),
      ...(options.settleMs !== undefined ? { settleMs: options.settleMs } : {}),
    });
  } catch (error) {
    spinner.stop();
    throw error;
  }
  spinner.succeed(chalk.green("活体验证完成"));
  printVerificationReport(report);
  return report;
}

/* ------------------------------------------------------------------ */
/* handler 5：finalize-skin                                            */
/* ------------------------------------------------------------------ */

export interface FinalizeSkinOptions {
  siteId: string;
  skinsDir: string;
  vlmScore: number;
  category: string;
  taglineZh: string;
  taglineEn: string;
}

/**
 * 上架终审：强校验六门禁全绿且 vlmScore ≥ 8.5，组装 SkinManifest 并原子写 manifest.json。
 * 同步函数：只做本地文件操作，全部失败路径抛 CliExitError（由命令层转退出码）。
 */
export function finalizeSkinHandler(options: FinalizeSkinOptions): SkinManifest {
  const skinDir = path.resolve(options.skinsDir, options.siteId);
  const report = parseJsonFile(path.join(skinDir, VERIFICATION_FILE), VerificationReportSchema, "验证报告");
  const contract = parseJsonFile(path.join(skinDir, CONTRACT_FILE), SiteContractSchema, "站点合同");
  const snapshot = parseJsonFile(path.join(skinDir, SNAPSHOT_FILE), SiteSnapshotSchema, "站点快照");

  const identityMismatches: string[] = [];
  if (report.siteId !== options.siteId) identityMismatches.push(`05_verification.siteId=${report.siteId}`);
  if (contract.siteId !== options.siteId) identityMismatches.push(`02_contract.siteId=${contract.siteId}`);
  if (snapshot.siteId !== options.siteId) identityMismatches.push(`01_snapshot.siteId=${snapshot.siteId}`);
  if (identityMismatches.length > 0) {
    throw new CliExitError(
      `产物归属校验失败：${identityMismatches.join("、")} 与命令行 siteId=${options.siteId} 不一致（目录与产物可能错位）`,
    );
  }

  const failedGates = report.gates.filter((gate) => !gate.passed);
  if (failedGates.length > 0) {
    throw new CliExitError(
      `门禁未全绿，禁止 finalize（${failedGates.length}/6 未过）：${failedGates
        .map((gate) => `${gate.gateName}（得分 ${gate.score.toFixed(1)}，${truncateSingleLine(gate.details, 60)}）`)
        .join("；")}`,
    );
  }
  if (!Number.isFinite(options.vlmScore) || options.vlmScore < MIN_VLM_SCORE) {
    throw new CliExitError(`--vlm-score=${options.vlmScore} 低于上架线 ${MIN_VLM_SCORE}，禁止 finalize`);
  }

  const userscriptFile = `${options.siteId}.user.js`;
  const userscriptPath = path.join(skinDir, userscriptFile);
  if (!existsSync(userscriptPath)) {
    throw new CliExitError(`用户脚本不存在：${userscriptPath}（先运行 wr build-skin ${options.siteId}）`);
  }
  const bundleSizeKb = statSync(userscriptPath).size / 1024;

  const manifestCandidate = {
    id: options.siteId,
    name: contract.siteName,
    category: options.category,
    targetUrl: snapshot.url,
    matchPatterns: [...contract.matchPatterns],
    archetype: contract.routes[0].archetype,
    tagline: { zh: options.taglineZh, en: options.taglineEn },
    enhancements: [...contract.recommendedPowerUps],
    userscriptFile,
    beforeImage: "before.png",
    afterImage: "after.png",
    vlmScore: options.vlmScore,
    dataParityRatio: report.dataParityRatio,
    bundleSizeKb,
    tokensUsedToCompile: report.totalTokensUsed,
    version: SKIN_VERSION,
  };
  const parsed = SkinManifestSchema.safeParse(manifestCandidate);
  if (!parsed.success) {
    throw new CliExitError(`SkinManifest 校验失败：\n${formatZodIssues(parsed.error)}`);
  }
  const manifestPath = path.join(skinDir, "manifest.json");
  atomicWriteJson(manifestPath, parsed.data);
  console.log(
    chalk.green(
      `✓ manifest.json 已生成：${manifestPath}（${parsed.data.name} · v${parsed.data.version} · VLM ${parsed.data.vlmScore.toFixed(1)} · 对齐率 ${(parsed.data.dataParityRatio * 100).toFixed(1)}% · ${parsed.data.bundleSizeKb.toFixed(1)} KB）`,
    ),
  );
  return parsed.data;
}

/* ------------------------------------------------------------------ */
/* handler 6：compile（Agent-Native 全自动流水线 + 断点续传）             */
/* ------------------------------------------------------------------ */

export interface CompileOptions {
  url: string;
  siteId: string;
  skinsDir: string;
  maxRounds: number;
  proxy?: string;
}

export interface CompileOutcome {
  report: VerificationReport;
  artifactPath: string;
  sizeKb: number;
  roundsUsed: number;
  tokensUsed: number;
}

type CompileStageKey = "inspect" | "contract" | "design" | "codegen" | "verify";

interface WrCompileState {
  siteId: string;
  url: string;
  stages: Record<CompileStageKey, boolean>;
  updatedAt: string;
}

const COMPILE_STAGES: readonly CompileStageKey[] = ["inspect", "contract", "design", "codegen", "verify"];

/** 阶段产物 → 状态键映射（状态位与磁盘双确认，文件丢失自动重做该阶段）。 */
const STAGE_ARTIFACTS: Record<CompileStageKey, string> = {
  inspect: SNAPSHOT_FILE,
  contract: CONTRACT_FILE,
  design: DESIGN_FILE,
  codegen: path.join("src", "entry.tsx"),
  verify: VERIFICATION_FILE,
};

function compileStatePath(skinDir: string): string {
  return path.join(skinDir, COMPILE_STATE_FILE);
}

function loadCompileState(skinDir: string, siteId: string, url: string): WrCompileState {
  const statePath = compileStatePath(skinDir);
  if (existsSync(statePath)) {
    try {
      const raw: unknown = JSON.parse(readFileSync(statePath, "utf8")) as unknown;
      if (typeof raw === "object" && raw !== null) {
        const holder = raw as { siteId?: unknown; url?: unknown; stages?: unknown };
        if (holder.siteId === siteId && holder.url === url && typeof holder.stages === "object" && holder.stages !== null) {
          const stagesRaw = holder.stages as Record<string, unknown>;
          const stages = Object.fromEntries(
            COMPILE_STAGES.map((stage) => [stage, stagesRaw[stage] === true]),
          ) as Record<CompileStageKey, boolean>;
          const done = COMPILE_STAGES.filter((stage) => stages[stage]);
          console.log(chalk.cyan(`发现断点状态（${COMPILE_STATE_FILE}）：已完成 ${done.join("、") || "无"}，重跑将跳过已完成阶段`));
          return { siteId, url, stages, updatedAt: new Date().toISOString() };
        }
        console.log(chalk.yellow("断点状态与本次目标（url/siteId）不一致：重置编译状态"));
      }
    } catch {
      console.log(chalk.yellow("断点状态文件损坏：重置编译状态"));
    }
  }
  return {
    siteId,
    url,
    stages: { inspect: false, contract: false, design: false, codegen: false, verify: false },
    updatedAt: new Date().toISOString(),
  };
}

function saveCompileState(skinDir: string, state: WrCompileState): void {
  state.updatedAt = new Date().toISOString();
  atomicWriteJson(compileStatePath(skinDir), state);
}

function markStageDone(skinDir: string, state: WrCompileState, stage: CompileStageKey): void {
  state.stages[stage] = true;
  saveCompileState(skinDir, state);
}

/** 阶段视为完成 = 状态位为 true 且产物仍在磁盘上。 */
function stageDone(state: WrCompileState, skinDir: string, stage: CompileStageKey): boolean {
  return state.stages[stage] && existsSync(path.join(skinDir, STAGE_ARTIFACTS[stage]));
}

/* ------------------------- 提示词（真实实现） ------------------------- */

function domainAnalystMessages(snapshot: SiteSnapshot): LlmMessage[] {
  const system = [
    "你是 DomainAnalyst，WebRemaster 编译器的领域分析师。输入是 DOM X-Ray 站点快照（≤16KB 结构骨架、重复组 repeatedGroups、交互元素 interactiveElements），输出是单站多路由数据合同 SiteContract——重制皮肤的施工图。",
    "产出规则：",
    "1. routes：为核心重复组各建一条路由；routeId 用 kebab-case；urlRegex 匹配该列表页地址（基于快照 matchPatterns 的域内正则）；domFingerprintSelector 选容器级稳定锚点（id 或强语义 class）；archetype 从枚举中选最贴近的模板族。",
    "2. itemFields：从 sampleItemsHtml 归纳每条列表项的数据字段——fieldName 用语义化英文；fieldType 从枚举选；selectors 优先「itemSelector 内的相对选择器」并补备用路径；attribute 从枚举选（文本 textContent、链接 href、图片 src）；required 只对主键字段（标题/链接）置 true。",
    "3. portalSlots：interactiveElements 中 isCaptchaOrCanvas=true 或 tag=canvas/video/iframe 的活体节点必须逐个登记（kind：captcha/canvas/video/widget），selectors 至少给一个定位器——活体节点严禁重制，只能原样嵌入。",
    "4. actions：登记搜索/翻页/登录等交互；表单 hasCsrfOrHiddenInputs=true 时必须登记 fill_and_submit 并给 submitSelectors；kind 从枚举选。",
    "5. enableTurboNav：多页静态站保持 true；recommendedPowerUps 从 POWER_UP_IDS 枚举按原型推荐（news-feed→cmd-k-search+csv-markdown-export；data-table-portal→table-sort-filter+csv-markdown-export；doc-reader→reading-progress+dark-light-theme；其余原型按语义取舍）。",
    `只输出符合以下 JSON Schema 的 JSON 对象本身（禁止解释、禁止 Markdown 围栏）：${JSON.stringify(zodToJsonSchema(SiteContractSchema))}`,
  ].join("\n");
  return [
    { role: "system", content: system },
    {
      role: "user",
      content: `站点快照（SiteSnapshot）JSON：\n${JSON.stringify(snapshot)}\n\n任务：产出该站点的 SiteContract。`,
    },
  ];
}

function uxArchitectMessages(contract: SiteContract, snapshot: SiteSnapshot): LlmMessage[] {
  const system = [
    "你是 UXArchitect，WebRemaster 的设计架构师。输入是 SiteContract 与站点快照要点，输出是 UXDesignSpec——重制视觉与布局蓝图。",
    "产出规则：",
    "- themeIdentity：按 archetype 选定现代主题；brandAccentHex/darkBgHex/lightBgHex 均为 #RRGGBB；aestheticStyle 用一句话概括风格流派（如 linear-冷静信息流 / editorial-杂志编排 / terminal-极客工作台）。",
    "- layoutStrategy：明确列表容器布局（卡片流/双栏/表格化）、信息密度与栅格断点策略。",
    "- keyEnhancements：3~6 条可落地的体验增强，与 contract.recommendedPowerUps 呼应。",
    "- componentBlueprint：给出组件树文字蓝图，把 Card/Row 的字段一一映射到 itemFields.fieldName。",
    `只输出符合以下 JSON Schema 的 JSON 对象本身（禁止解释、禁止 Markdown 围栏）：${JSON.stringify(zodToJsonSchema(UXDesignSpecSchema))}`,
  ].join("\n");
  const digest = {
    url: snapshot.url,
    title: snapshot.title,
    originalItemCountHint: snapshot.originalItemCountHint,
    repeatedGroups: snapshot.repeatedGroups.map((group) => ({
      groupId: group.groupId,
      pairingMode: group.pairingMode,
      totalCount: group.totalCount,
    })),
  };
  return [
    { role: "system", content: system },
    {
      role: "user",
      content: `站点合同（SiteContract）JSON：\n${JSON.stringify(contract)}\n\n站点快照要点：\n${JSON.stringify(digest)}\n\n任务：产出 UXDesignSpec。`,
    },
  ];
}

const CodegenOutputSchema = z.object({
  entryTsx: z.string().min(1),
  skinCss: z.string().min(1),
});

function skinCodegenMessages(
  contract: SiteContract,
  design: UXDesignSpec,
  repairFeedback: string | undefined,
  skinDir: string,
): LlmMessage[] {
  const system = [
    "你是 SkinCodegen，WebRemaster 的皮肤代码生成器。产出完整、可编译的 React 19 + Tailwind v4 皮肤入口 entry.tsx 与样式 skin.css。",
    "硬性协议（打包器 tsc/vite 双门禁全量校验，违反即失败）：",
    '1. entry.tsx 第一行 import "./skin.css"；skin.css 第一行 @import "tailwindcss"; 第二行 @source "./"; 随后写皮肤样式。',
    "2. entry.tsx 默认导出挂载函数（可 async）：export default function mountSkin(context: SkinMountContext)。SkinMountContext 必须声明为以下形状的结构子集（只声明实际用到的字段，禁止捏造）：{ host: HTMLElement; shadowRoot: ShadowRoot; contract: SiteContract; originWrapper: HTMLElement; diagnostics?: { healthSummary?: () => unknown; features?: { commandPalette?: boolean; diagnosticsDrawer?: boolean } } }。",
    '3. 挂载：const rootEl = document.createElement("div"); rootEl.className = "wr-skin-root"; context.shadowRoot.appendChild(rootEl); createRoot(rootEl).render(<SkinApp />)——createRoot 来自 react-dom/client，JSX 用 React 19 语义。',
    "4. 数据同步：原站 DOM 已被隐身保留在 context.originWrapper 中——按 contract.routes[].itemFields[].selectors（配合 primaryItemSelector / pairingMode 定位条目）从 originWrapper 查询字段，用 setInterval 或 MutationObserver 增量同步进 React state；严禁 fetch 原站接口、严禁修改原站 DOM。",
    "5. portalSlots 中的活体节点（验证码/Canvas/视频/widget）严禁重制：保持原站原样。",
    "6. strict TS：禁止 any；只用类型化字段；import type { SiteContract } from \"@webremaster/schema\"；不得导入 contract/diagnostics 之外的 workspace 私有模块。",
    "7. 如实上报能力：context.diagnostics 若被声明，则 healthSummary 返回 { totalFields, healthyFields, hitRate }，features 报 { commandPalette, diagnosticsDrawer } 的真实实现状态。",
    "8. 视觉遵循 UXDesignSpec 的主题色与布局策略；列表用语义化结构（ul/li 或 table），全部样式走 Tailwind 类 + skin.css。",
    `只输出符合以下 JSON Schema 的 JSON 对象本身（禁止解释、禁止 Markdown 围栏）：${JSON.stringify(zodToJsonSchema(CodegenOutputSchema))}`,
  ].join("\n");
  const parts: string[] = [
    `站点合同（SiteContract）JSON：\n${JSON.stringify(contract)}`,
    `设计规格（UXDesignSpec）JSON：\n${JSON.stringify(design)}`,
  ];
  if (repairFeedback !== undefined) {
    parts.push(`上一轮产物未通过门禁，本次必须修复以下全部问题后完整重写两个文件：\n${repairFeedback}`);
    const previousEntryPath = path.join(skinDir, "src", "entry.tsx");
    if (existsSync(previousEntryPath)) {
      parts.push(`上一轮 entry.tsx 全文（供定位问题，重写时不得复制其错误）：\n${readFileSync(previousEntryPath, "utf8")}`);
    }
  }
  parts.push('任务：产出 {"entryTsx": string, "skinCss": string}。');
  return [
    { role: "system", content: system },
    { role: "user", content: parts.join("\n\n") },
  ];
}

/* --------------------------- 门禁反馈格式化 --------------------------- */

function formatFailedGates(report: VerificationReport): string {
  const lines = report.gates
    .filter((gate) => !gate.passed)
    .map((gate) => `[${gate.gateName}] 得分=${gate.score.toFixed(1)}：${gate.details}`);
  if (report.vlmFeedback.trim().length > 0) {
    lines.push(`[VLM 反馈] ${report.vlmFeedback}`);
  }
  const missedFields = Object.entries(report.extractorHealthSummary)
    .filter(([, health]) => health.misses > 0)
    .map(([field, health]) => `${field}（misses=${health.misses}）`);
  if (missedFields.length > 0) {
    lines.push(`[提取健康] 未命中字段：${missedFields.join("、")}`);
  }
  lines.push(`[数据对齐率] ${(report.dataParityRatio * 100).toFixed(1)}%（要求 100% 附近）`);
  return lines.join("\n");
}

function formatCompileRepairContext(error: unknown): string {
  if (error instanceof CliExitError) {
    return error.details !== undefined ? `${error.message}\n${error.details}` : error.message;
  }
  return errorMessage(error);
}

/* --------------------------- compile 主流程 --------------------------- */

export async function compileHandler(options: CompileOptions): Promise<CompileOutcome> {
  assertOpenAiKey("compile 流水线");
  if (!(options.maxRounds >= 1)) {
    throw new CliExitError(`--max-rounds 必须 ≥ 1（收到 ${options.maxRounds}）`);
  }
  const gateway = new LlmGateway({ model: resolveModel() });
  const skinDir = path.resolve(options.skinsDir, options.siteId);
  mkdirSync(skinDir, { recursive: true });
  const state = loadCompileState(skinDir, options.siteId, options.url);
  saveCompileState(skinDir, state);

  const artifactPath = path.join(skinDir, `${options.siteId}.user.js`);

  // 断点：整条流水线此前已通过——直接读盘汇报，不再消耗任何 Token。
  if (stageDone(state, skinDir, "verify")) {
    const report = parseJsonFile(path.join(skinDir, VERIFICATION_FILE), VerificationReportSchema, "验证报告");
    console.log(chalk.green(`✓ ${options.siteId} 此前已通过全部阶段（断点续传），汇报既有结果`));
    printVerificationReport(report);
    if (!existsSync(artifactPath)) {
      throw new CliExitError(`断点状态显示已完成但产物缺失：${artifactPath}（删除 ${COMPILE_STATE_FILE} 后重跑）`);
    }
    return {
      report,
      artifactPath,
      sizeKb: statSync(artifactPath).size / 1024,
      roundsUsed: 0,
      tokensUsed: 0,
    };
  }

  let roundsUsed = 0;
  let repairFeedback: string | undefined;

  for (;;) {
    if (!stageDone(state, skinDir, "inspect")) {
      await inspectHandler({
        url: options.url,
        siteId: options.siteId,
        outDir: options.skinsDir,
        ...(options.proxy !== undefined ? { proxy: options.proxy } : {}),
      });
      markStageDone(skinDir, state, "inspect");
    }
    if (!stageDone(state, skinDir, "contract")) {
      const snapshot = parseJsonFile(path.join(skinDir, SNAPSHOT_FILE), SiteSnapshotSchema, "站点快照");
      const spinner = ora(chalk.cyan("[2/6] DomainAnalyst 生成站点合同")).start();
      let contract: SiteContract;
      let contractTokens: number;
      try {
        const completion = await gateway.completeStructured("code", domainAnalystMessages(snapshot), SiteContractSchema);
        contract = completion.data;
        contractTokens = completion.tokensUsed;
      } catch (error) {
        spinner.fail(chalk.red(`[2/6] 站点合同生成失败：${errorMessage(error)}`));
        throw error;
      }
      atomicWriteJson(path.join(skinDir, CONTRACT_FILE), contract);
      spinner.succeed(chalk.green(`[2/6] 站点合同完成（${contract.routes.length} 条路由，${contractTokens} tokens）`));
      markStageDone(skinDir, state, "contract");
    }
    if (!stageDone(state, skinDir, "design")) {
      const contract = parseJsonFile(path.join(skinDir, CONTRACT_FILE), SiteContractSchema, "站点合同");
      const snapshot = parseJsonFile(path.join(skinDir, SNAPSHOT_FILE), SiteSnapshotSchema, "站点快照");
      const spinner = ora(chalk.cyan("[3/6] UXArchitect 产出设计规格")).start();
      let design: UXDesignSpec;
      let designTokens: number;
      try {
        const completion = await gateway.completeStructured("code", uxArchitectMessages(contract, snapshot), UXDesignSpecSchema);
        design = completion.data;
        designTokens = completion.tokensUsed;
      } catch (error) {
        spinner.fail(chalk.red(`[3/6] 设计规格生成失败：${errorMessage(error)}`));
        throw error;
      }
      atomicWriteJson(path.join(skinDir, DESIGN_FILE), design);
      spinner.succeed(chalk.green(`[3/6] 设计规格完成（${design.themeIdentity.aestheticStyle}，${designTokens} tokens）`));
      markStageDone(skinDir, state, "design");
    }
    if (!stageDone(state, skinDir, "codegen")) {
      const contract = parseJsonFile(path.join(skinDir, CONTRACT_FILE), SiteContractSchema, "站点合同");
      const design = parseJsonFile(path.join(skinDir, DESIGN_FILE), UXDesignSpecSchema, "设计规格");
      const spinner = ora(chalk.cyan("[4/6] SkinCodegen 生成皮肤源码")).start();
      let entryTsx: string;
      let skinCss: string;
      let codegenTokens: number;
      try {
        const completion = await gateway.completeStructured(
          "code",
          skinCodegenMessages(contract, design, repairFeedback, skinDir),
          CodegenOutputSchema,
        );
        entryTsx = completion.data.entryTsx;
        skinCss = completion.data.skinCss;
        codegenTokens = completion.tokensUsed;
      } catch (error) {
        spinner.fail(chalk.red(`[4/6] 皮肤源码生成失败：${errorMessage(error)}`));
        throw error;
      }
      const srcDir = path.join(skinDir, "src");
      mkdirSync(srcDir, { recursive: true });
      writeFileSync(path.join(srcDir, "entry.tsx"), entryTsx, "utf8");
      writeFileSync(path.join(srcDir, "skin.css"), skinCss, "utf8");
      spinner.succeed(chalk.green(`[4/6] 皮肤源码完成（entry.tsx + skin.css，${codegenTokens} tokens）`));
      markStageDone(skinDir, state, "codegen");
    }

    // build-skin 逻辑（复用 handler：三门禁打印 + 失败带 details 抛错；
    // 只有打包门禁失败可自愈重试，合同/入口类错误属环境问题直接上抛）
    let buildOutcome: BuildSkinOutcome;
    try {
      buildOutcome = await buildSkinHandler({ siteId: options.siteId, skinsDir: options.skinsDir, minify: true });
    } catch (error) {
      if (!(error instanceof SkinBuildGateError)) {
        throw error;
      }
      roundsUsed += 1;
      if (roundsUsed >= options.maxRounds) {
        throw new CliExitError(
          `构建门禁连续 ${roundsUsed} 轮未通过，已达 --max-rounds=${options.maxRounds} 上限`,
          1,
          formatCompileRepairContext(error),
        );
      }
      repairFeedback = formatCompileRepairContext(error);
      console.log(chalk.yellow(`↻ 构建门禁未通过：重写皮肤源码，进入第 ${roundsUsed + 1}/${options.maxRounds} 轮自愈`));
      state.stages.codegen = false;
      saveCompileState(skinDir, state);
      continue;
    }

    // verify-skin 逻辑（enableVlm=false：流水线内不做视觉评审，不消耗 Vision Token）
    const report = await verifySkinHandler({
      siteId: options.siteId,
      skinsDir: options.skinsDir,
      enableVlm: false,
      ...(options.proxy !== undefined ? { proxy: options.proxy } : {}),
    });
    if (report.passed) {
      markStageDone(skinDir, state, "verify");
      console.log(
        chalk.green(`✓ compile 完成：${options.siteId}（自愈 ${roundsUsed} 轮，LLM tokens=${gateway.getTokensUsed()}）`),
      );
      return {
        report,
        artifactPath,
        sizeKb: buildOutcome.sizeKb,
        roundsUsed,
        tokensUsed: gateway.getTokensUsed(),
      };
    }
    roundsUsed += 1;
    if (roundsUsed >= options.maxRounds) {
      throw new CliExitError(
        `六重门禁连续 ${roundsUsed} 轮未全绿，已达 --max-rounds=${options.maxRounds} 上限`,
        1,
        formatFailedGates(report),
      );
    }
    repairFeedback = formatFailedGates(report);
    console.log(chalk.yellow(`↻ 验证门禁未全绿：重写皮肤源码，进入第 ${roundsUsed + 1}/${options.maxRounds} 轮自愈`));
    state.stages.codegen = false;
    saveCompileState(skinDir, state);
  }
}

export interface DoctorCheck {
  name: string;
  passed: boolean;
  message: string;
}

export async function doctorHandler(): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];

  // 1. Node.js 版本 (>= 22)
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.replace(/^v/, "").split(".")[0] || "0", 10);
  checks.push({
    name: "Node.js 运行时",
    passed: major >= 22,
    message: major >= 22 ? `${nodeVersion} (符合 >= 22 要求)` : `${nodeVersion} (建议升级至 Node 22+)`,
  });

  // 2. Playwright Chromium 浏览器可用性
  let playwrightOk = false;
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    await browser.close();
    playwrightOk = true;
  } catch {
    playwrightOk = false;
  }
  checks.push({
    name: "Playwright Chromium 测绘环境",
    passed: playwrightOk,
    message: playwrightOk ? "Chromium headless 可正常拉起" : "未就绪，可运行 pnpm exec playwright install chromium",
  });

  // 3. 皮肤工作区清单
  const skinsDir = path.resolve("./skins");
  let skinCount = 0;
  if (existsSync(skinsDir)) {
    skinCount = readdirSync(skinsDir).filter((d: string) => {
      const p = path.join(skinsDir, d);
      return statSync(p).isDirectory() && existsSync(path.join(p, "manifest.json"));
    }).length;
  }
  checks.push({
    name: "已上架皮肤产物",
    passed: skinCount > 0,
    message: `检测到 ${skinCount} 个合格皮肤`,
  });

  console.log(chalk.bold("\n🩺 WebRemaster 系统环境诊断报告 (wr doctor)\n"));
  for (const c of checks) {
    const icon = c.passed ? chalk.green("✔") : chalk.red("✖");
    console.log(`  ${icon} ${chalk.bold(c.name)}: ${c.message}`);
  }
  console.log("");
  return checks;
}

export interface ListSitesOptions {
  skinsDir?: string;
  configFile?: string;
}

export interface SiteListItem {
  id: string;
  name: string;
  category: string;
  archetype: string;
  url: string;
  status: "compiled" | "ready" | "pending";
}

function resolveTop40ConfigFile(customPath?: string): string {
  if (customPath) return path.resolve(customPath);
  const candidates = [
    path.resolve("./configs/top40_sites.yaml"),
    path.resolve("../../configs/top40_sites.yaml"),
    path.resolve("../configs/top40_sites.yaml"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0];
}

function resolveSkinsDir(customPath?: string): string {
  if (customPath) return path.resolve(customPath);
  const candidates = [
    path.resolve("./skins"),
    path.resolve("../../skins"),
    path.resolve("../skins"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0];
}

export async function listHandler(options: ListSitesOptions = {}): Promise<SiteListItem[]> {
  const configFile = resolveTop40ConfigFile(options.configFile);
  const skinsDir = resolveSkinsDir(options.skinsDir);

  let sites: Array<{ id: string; name: string; category: string; archetype: string; url: string }> = [];

  if (existsSync(configFile)) {
    try {
      const raw = readFileSync(configFile, "utf8");
      const parsed = yaml.parse(raw);
      if (parsed && Array.isArray(parsed.sites)) {
        sites = parsed.sites;
      }
    } catch {
      /* ignore yaml parse error */
    }
  }


  // 如果 top40 未命中或自定义 skins 目录中有额外皮肤，也合并进来
  const knownIds = new Set(sites.map((s) => s.id));
  if (existsSync(skinsDir)) {
    for (const d of readdirSync(skinsDir)) {
      const p = path.join(skinsDir, d);
      if (statSync(p).isDirectory() && !knownIds.has(d)) {
        sites.push({
          id: d,
          name: d,
          category: "自定义",
          archetype: "custom",
          url: "local",
        });
        knownIds.add(d);
      }
    }
  }

  const result: SiteListItem[] = sites.map((s) => {
    const skinPath = path.join(skinsDir, s.id);
    const hasManifest = existsSync(path.join(skinPath, "manifest.json"));
    const hasBundle = existsSync(path.join(skinPath, `${s.id}.user.js`));
    const isCompiled = hasManifest && hasBundle;
    const isReady =
      existsSync(path.join(skinPath, "02_contract.json")) ||
      existsSync(path.join(skinPath, "src", "entry.tsx"));

    const status: "compiled" | "ready" | "pending" = isCompiled
      ? "compiled"
      : isReady
      ? "ready"
      : "pending";
    return {
      id: s.id,
      name: s.name,
      category: s.category,
      archetype: s.archetype,
      url: s.url,
      status,
    };
  });

  console.log(chalk.bold(`\n📋 WebRemaster 站点重制矩阵与进度清单 (共 ${result.length} 站)\n`));
  const compiledCount = result.filter((r) => r.status === "compiled").length;
  const readyCount = result.filter((r) => r.status === "ready").length;
  const pendingCount = result.filter((r) => r.status === "pending").length;

  console.log(
    `  ${chalk.green("● 已上架 (compiled)")}: ${compiledCount}  |  ` +
      `${chalk.yellow("◐ 开发中 (ready)")}: ${readyCount}  |  ` +
      `${chalk.dim("○ 待开工 (pending)")}: ${pendingCount}\n`,
  );

  for (const s of result) {
    const statusTag =
      s.status === "compiled"
        ? chalk.bgGreen.black(" COMPILED ")
        : s.status === "ready"
        ? chalk.bgYellow.black(" READY ")
        : chalk.bgGray.white(" PENDING ");
    console.log(
      `  ${statusTag} ${chalk.bold(s.id.padEnd(16))} ${s.name.padEnd(26)} ${chalk.dim(s.category.padEnd(10))} ${chalk.cyan(s.archetype)}`,
    );
  }
  console.log("");
  return result;
}

export interface ScaffoldOptions {
  siteId: string;
  url?: string;
  category?: string;
  archetype?: string;
  skinsDir?: string;
}

export async function scaffoldHandler(options: ScaffoldOptions): Promise<{ siteId: string; createdFiles: string[] }> {
  const siteId = options.siteId.trim();
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(siteId)) {
    throw new CliExitError(
      `站点 ID "${siteId}" 不合法，必须为 kebab-case（仅含小写字母、数字和连字符，如 hackernews、sqlite-docs）`,
      1,
    );
  }

  const skinsDir = resolveSkinsDir(options.skinsDir);
  const targetDir = path.join(skinsDir, siteId);
  const srcDir = path.join(targetDir, "src");

  if (existsSync(path.join(targetDir, "02_contract.json"))) {
    throw new CliExitError(`站点目录 skins/${siteId} 已存在重制合同，请勿重复脚手架初始化。`, 1);
  }

  mkdirSync(srcDir, { recursive: true });

  const url = options.url || `https://${siteId}.com/`;
  let origin = "https://example.com";
  try {
    origin = new URL(url).origin;
  } catch {
    origin = "https://example.com";
  }

  const category = options.category || "开发者";
  const rawArch = options.archetype || "doc-reader";
  const archMap: Record<string, string> = {
    "article-reader": "doc-reader",
    "data-table": "data-table-portal",
    "nested-thread": "forum-thread",
  };
  const normalizedArchetype = (archMap[rawArch] || rawArch) as any;

  const contractData: SiteContract = SiteContractSchema.parse({
    siteId,
    siteName: siteId.toUpperCase(),
    matchPatterns: [`${origin}/*`],
    enableTurboNav: true,
    recommendedPowerUps: ["cmd-k-search", "csv-markdown-export"],
    routes: [
      {
        routeId: "main",
        urlRegex: "^" + origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "/.*",
        domFingerprintSelector: "body",
        archetype: normalizedArchetype,
        primaryListContainer: "body",
        primaryItemSelector: "article, .item, tr, li",
        pairingMode: "single",
        itemFields: [
          {
            fieldName: "title",
            fieldType: "string",
            selectors: ["h1", "h2", ".title", "a"],
            relativeTo: "self",
            attribute: "textContent",
            required: true,
          },
        ],
      },
    ],
  });

  const designData: UXDesignSpec = UXDesignSpecSchema.parse({
    siteId,
    themeIdentity: {
      brandAccentHex: "#0ea5e9",
      darkBgHex: "#0b0f17",
      lightBgHex: "#ffffff",
      aestheticStyle: "现代极简、Shadow DOM 高隔离、响应式排版",
    },
    layoutStrategy: "双栏响应式，桌面端展示侧边栏快捷导航，移动端自动抽屉式折叠",
    keyEnhancements: [
      "TurboNav 秒级预取无刷切页",
      "本地高隐私 BookmarkManager 稍后阅读",
      "快捷键 Cmd+K 命令面板与 Vim 模式导航",
      "一键 CSV / Markdown 表格无损导出",
    ],
    componentBlueprint: "RemasterShell 承载整体框架，主体根据不同 archetype 挂载 FeedListCard 或 SmartDataTable",
  });

  const entryCode = `/**
 * ${siteId} 重制皮肤入口
 * Archetype: ${normalizedArchetype}
 * Category: ${category}
 */
import React, { useEffect, useState } from "react";
import { mountShadowApp, createReactiveStore } from "@webremaster/bridge";
import { RemasterShell, FeedListCard } from "@webremaster/ui-kit";
import "./skin.css";

interface ItemData {
  id: string;
  title: string;
}

export function App() {
  const [items, setItems] = useState<ItemData[]>([]);

  useEffect(() => {
    const store = createReactiveStore<ItemData[]>({
      selector: "body",
      extractor: () => {
        const headings = Array.from(document.querySelectorAll("h1, h2, .title, a"));
        return headings.slice(0, 30).map((el, idx) => ({
          id: String(idx + 1),
          title: el.textContent?.trim() || "无标题",
        }));
      },
    });

    const unsubscribe = store.subscribe((data) => {
      if (data) setItems(data);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  return (
    <RemasterShell siteName="${siteId.toUpperCase()}" activeArchetype="${normalizedArchetype}">
      <main className="max-w-4xl mx-auto p-6 space-y-3">
        {items.map((item) => (
          <FeedListCard
            key={item.id}
            item={{
              id: item.id,
              title: item.title,
            }}
          />
        ))}
      </main>
    </RemasterShell>
  );
}

mountShadowApp({
  mountId: "webremaster-skin-${siteId}",
  Component: App,
  styles: "",
});
`;

  const cssCode = `@import "tailwindcss";

:host {
  all: initial;
  display: block;
}
`;

  const createdFiles: string[] = [];

  const contractPath = path.join(targetDir, "02_contract.json");
  writeFileSync(contractPath, `${JSON.stringify(contractData, null, 2)}\n`, "utf8");
  createdFiles.push(contractPath);

  const designPath = path.join(targetDir, "03_design.json");
  writeFileSync(designPath, `${JSON.stringify(designData, null, 2)}\n`, "utf8");
  createdFiles.push(designPath);

  const entryPath = path.join(srcDir, "entry.tsx");
  writeFileSync(entryPath, entryCode, "utf8");
  createdFiles.push(entryPath);

  const cssPath = path.join(srcDir, "skin.css");
  writeFileSync(cssPath, cssCode, "utf8");
  createdFiles.push(cssPath);

  console.log(chalk.bold(`\n🎉 成功脚手架初始化站点皮肤: ${chalk.cyan(siteId)}\n`));
  for (const f of createdFiles) {
    console.log(`  ${chalk.green("+")} ${path.relative(process.cwd(), f)}`);
  }
  console.log(chalk.dim(`\n下一步：运行 wr build-skin ${siteId} 或编辑 skins/${siteId}/src/entry.tsx 开始重制。\n`));

  return { siteId, createdFiles };
}

/* ------------------------------------------------------------------ */
/* devHandler：热重载开发服务器与 Userscript 联调桥（HMR 模式）           */
/* ------------------------------------------------------------------ */

export interface DevHandlerOptions {
  siteId: string;
  port?: number;
  skinsDir?: string;
  dryRun?: boolean;
}

export async function devHandler(opts: DevHandlerOptions): Promise<{
  siteId: string;
  devUserScriptPath: string;
  port: number;
  devServerUrl: string;
}> {
  const { siteId, port = 5173, dryRun = false } = opts;
  const skinsDir = resolveSkinsDir(opts.skinsDir);
  const targetDir = path.join(skinsDir, siteId);

  if (!existsSync(targetDir)) {
    throw new CliExitError(
      `未找到站点目录: ${targetDir}。请先使用 wr scaffold ${siteId} 初始化站点模板。`,
      1,
    );
  }

  const entryPath = path.join(targetDir, "src", "entry.tsx");
  if (!existsSync(entryPath)) {
    throw new CliExitError(
      `未找到皮肤入口代码: ${entryPath}。`,
      1,
    );
  }

  // 读取合同以提取目标站点匹配规则
  let matchPattern = "*://*/*";
  const contractPath = path.join(targetDir, "02_contract.json");
  if (existsSync(contractPath)) {
    try {
      const contract = JSON.parse(readFileSync(contractPath, "utf8"));
      if (contract.targetUrl) {
        const u = new URL(contract.targetUrl);
        matchPattern = `${u.protocol}//${u.host}/*`;
      }
    } catch {
      // ignore
    }
  }

  const devServerUrl = `http://localhost:${port}`;
  const devUserScriptCode = `// ==UserScript==
// @name         WebRemaster Dev: ${siteId} (HMR Live Bridge)
// @namespace    https://webremaster.dev/
// @version      0.1.0-dev
// @description  WebRemaster Instant Live HMR Bridge for ${siteId}
// @match        ${matchPattern}
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @run-at       document-start
// ==/UserScript==

/**
 * WebRemaster Live HMR Dev Loader
 * Automatically attaches Vite HMR client to the target page
 */
(function() {
  'use strict';
  if ((window as any).__WR_DEV_LOADED__) return;
  (window as any).__WR_DEV_LOADED__ = true;

  console.log('[WebRemaster Dev] Attaching live HMR client for ${siteId} -> ${devServerUrl} ...');

  const viteClient = document.createElement('script');
  viteClient.type = 'module';
  viteClient.src = '${devServerUrl}/@vite/client';
  document.head.appendChild(viteClient);

  const skinModule = document.createElement('script');
  skinModule.type = 'module';
  skinModule.src = '${devServerUrl}/src/entry.tsx';
  document.head.appendChild(skinModule);
})();
`;

  const devUserScriptPath = path.join(targetDir, `${siteId}.dev.user.js`);
  writeFileSync(devUserScriptPath, devUserScriptCode, "utf8");

  console.log(chalk.bold(`\n🚀 WebRemaster 实时热重载开发桥已就绪: ${chalk.cyan(siteId)}\n`));
  console.log(`  + 本地服务地址: ${chalk.green(devServerUrl)}`);
  console.log(`  + 联调油猴脚本: ${chalk.green(path.relative(process.cwd(), devUserScriptPath))}`);
  console.log(`  + 监听匹配规则: ${chalk.yellow(matchPattern)}`);
  console.log(chalk.dim(`\n使用说明：`));
  console.log(`  1. 在 Tampermonkey / ScriptCat 中安装上方生成的 .dev.user.js 脚本`);
  console.log(`  2. 浏览器打开目标站点页面`);
  console.log(`  3. 编辑 skins/${siteId}/src/entry.tsx，浏览器将毫秒级热重载！\n`);

  if (!dryRun) {
    try {
      const { createServer } = await import("vite");
      const server = await createServer({
        root: targetDir,
        server: {
          port,
          cors: true,
          headers: {
            "Access-Control-Allow-Origin": "*",
          },
        },
      });
      await server.listen();
      server.printUrls();
    } catch (err) {
      console.warn(`启动本地 Vite 服务遇到提示（可手动启动）:`, err);
    }
  }

  return { siteId, devUserScriptPath, port, devServerUrl };
}



/* ------------------------------------------------------------------ */
/* buildProgram：命令装配（结构锁定）                                    */
/* ------------------------------------------------------------------ */

/** 注册子命令：单参形式返回新子命令，再挂 description 与 exitOverride（双参带 description 会被 commander 当作独立可执行子命令并返回根程序，严禁使用）。 */
function registerCommand(program: Command, name: string, description: string): Command {
  return program.command(name).description(description).exitOverride();
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("wr")
    .description(
      "WebRemaster Agent-Native 零 Key CLI：把老旧网站重制为 Shadow-DOM React 皮肤（测绘 → 合同 → 设计 → 代码 → 打包 → 活体验证 → 上架）",
    )
    .version("0.1.0");

  registerCommand(program, "auth-record", "打开有头浏览器人工登录，保存站点登录态（storageState.json）")
    .argument("<url>", "待登录站点地址（http/https）")
    .option("--out <path>", "登录态输出路径", "./storageState.json")
    .option("--proxy <server>", "代理服务器地址（如 http://127.0.0.1:7897，透传 Chromium）")
    .action(async (url, opts) => {
      await guard(async () => {
        const options: AuthRecordOptions = { url: optString(url, "url"), out: optString(opts.out, "out") };
        const proxy = optOptionalString(opts.proxy);
        if (proxy !== undefined) options.proxy = proxy;
        await authRecordHandler(options);
      });
    });

  registerCommand(program, "inspect", "DOM X-Ray 深度测绘：产出 01_snapshot.json + before.png")
    .argument("<url>", "目标页地址（http/https）")
    .requiredOption("--id <siteId>", "站点 ID（kebab-case，皮肤目录名）")
    .option("--auth <path>", "登录态 storageState.json（auth-record 产物）")
    .option("--out-dir <dir>", "皮肤工作区根目录", "./skins")
    .option("--proxy <server>", "代理服务器地址")
    .action(async (url, opts) => {
      await guard(async () => {
        const options: InspectOptions = {
          url: optString(url, "url"),
          siteId: optString(opts.id, "id"),
          outDir: optString(opts.outDir, "out-dir"),
        };
        const auth = optOptionalString(opts.auth);
        if (auth !== undefined) options.auth = auth;
        const proxy = optOptionalString(opts.proxy);
        if (proxy !== undefined) options.proxy = proxy;
        await inspectHandler(options);
      });
    });

  registerCommand(program, "build-skin", "打包皮肤：tsc / vite / 产物自检三重门禁 → <siteId>.user.js")
    .argument("<siteId>", "站点 ID")
    .option("--skins-dir <dir>", "皮肤工作区根目录", "./skins")
    .option("--no-minify", "关闭压缩（排查用）")
    .action(async (siteId, opts) => {
      await guard(async () => {
        await buildSkinHandler({
          siteId: optString(siteId, "siteId"),
          skinsDir: optString(opts.skinsDir, "skins-dir"),
          minify: optBoolean(opts.minify, true),
        });
      });
    });

  registerCommand(program, "verify-skin", "活体验证：after.png 采集 + 六重门禁（可选 VLM 视觉评审）")
    .argument("<siteId>", "站点 ID")
    .option("--no-vlm", "关闭 VLM 视觉评审（无需 OPENAI_API_KEY）")
    .option("--auth <path>", "登录态 storageState.json")
    .option("--skins-dir <dir>", "皮肤工作区根目录", "./skins")
    .option("--proxy <server>", "代理服务器地址")
    .option("--settle-ms <n>", "页面加载后的稳定等待毫秒数")
    .action(async (siteId, opts) => {
      await guard(async () => {
        const options: VerifySkinOptions = {
          siteId: optString(siteId, "siteId"),
          skinsDir: optString(opts.skinsDir, "skins-dir"),
          enableVlm: optBoolean(opts.vlm, true),
        };
        const auth = optOptionalString(opts.auth);
        if (auth !== undefined) options.auth = auth;
        const proxy = optOptionalString(opts.proxy);
        if (proxy !== undefined) options.proxy = proxy;
        if (opts.settleMs !== undefined) {
          const settleMs = optNumber(opts.settleMs, "settle-ms");
          if (!(settleMs >= 0)) throw new CliExitError(`--settle-ms 必须 ≥ 0（收到 ${settleMs}）`);
          options.settleMs = settleMs;
        }
        const report = await verifySkinHandler(options);
        if (!report.passed) {
          process.exitCode = 1;
        }
      });
    });

  registerCommand(program, "finalize-skin", "上架终审：六门禁全绿 + VLM≥8.5 → 原子生成 manifest.json")
    .argument("<siteId>", "站点 ID")
    .requiredOption("--vlm-score <num>", "VLM 评审分（0~10，≥8.5 才可上架）")
    .requiredOption("--category <cat>", "商店分类")
    .requiredOption("--tagline-zh <str>", "中文标语")
    .requiredOption("--tagline-en <str>", "英文标语")
    .option("--skins-dir <dir>", "皮肤工作区根目录", "./skins")
    .action(async (siteId, opts) => {
      await guard(async () => {
        finalizeSkinHandler({
          siteId: optString(siteId, "siteId"),
          skinsDir: optString(opts.skinsDir, "skins-dir"),
          vlmScore: optNumber(opts.vlmScore, "vlm-score"),
          category: optString(opts.category, "category"),
          taglineZh: optString(opts.taglineZh, "tagline-zh"),
          taglineEn: optString(opts.taglineEn, "tagline-en"),
        });
      });
    });

  registerCommand(program, "compile", "Agent-Native 全自动编译：测绘→合同→设计→代码→打包→验证（门禁自愈重试 + 断点续传）")
    .argument("<url>", "目标页地址（http/https）")
    .requiredOption("--id <siteId>", "站点 ID（kebab-case，皮肤目录名）")
    .option("--skins-dir <dir>", "皮肤工作区根目录", "./skins")
    .option("--max-rounds <n>", "门禁自愈重试上限（轮）", "4")
    .option("--proxy <server>", "代理服务器地址")
    .action(async (url, opts) => {
      await guard(async () => {
        const options: CompileOptions = {
          url: optString(url, "url"),
          siteId: optString(opts.id, "id"),
          skinsDir: optString(opts.skinsDir, "skins-dir"),
          maxRounds: optNumber(opts.maxRounds, "max-rounds", 4),
        };
        const proxy = optOptionalString(opts.proxy);
        if (proxy !== undefined) options.proxy = proxy;
        await compileHandler(options);
      });
    });

  registerCommand(program, "sync-artifacts", "同步合格皮肤产物至 Chrome 扩展与皮肤商店")
    .option("--skins <dir>", "皮肤工作区根目录", "./skins")
    .option("--ext <dir>", "Chrome 扩展目录", "./packages/extension")
    .option("--store <dir>", "皮肤商店目录", "./packages/store")
    .option("--min-vlm-score <num>", "最低准入 VLM 分数", "8.5")
    .action(async (opts) => {
      await guard(async () => {
        await syncArtifactsHandler({
          skinsDir: optString(opts.skins, "skins"),
          extDir: optString(opts.ext, "ext"),
          storeDir: optString(opts.store, "store"),
          minVlmScore: optNumber(opts.minVlmScore, "min-vlm-score", 8.5),
        });
      });
    });

  registerCommand(program, "doctor", "系统环境与依赖就绪体检诊断（Node / Playwright / 皮肤库）")
    .action(async () => {
      await guard(async () => {
        await doctorHandler();
      });
    });

  registerCommand(program, "list", "查看经典网站重制进度与 Top 40 站点矩阵")
    .option("--skins-dir <dir>", "皮肤工作区根目录", "./skins")
    .option("--config <path>", "站点配置文件路径", "./configs/top40_sites.yaml")
    .action(async (opts) => {
      await guard(async () => {
        await listHandler({
          skinsDir: optOptionalString(opts.skinsDir),
          configFile: optOptionalString(opts.config),
        });
      });
    });

  registerCommand(program, "scaffold", "快速脚手架初始化一个新站点皮肤模板（合同、设计、React 组件与样式）")
    .argument("<siteId>", "站点 ID（kebab-case）")
    .option("--url <url>", "目标站点 URL")
    .option("--category <cat>", "站点分类（如 开发者、高校与学术、公共政务）")
    .option("--archetype <archetype>", "页面原型（news-feed / doc-reader / data-table-portal / forum-thread 等）")
    .option("--skins-dir <dir>", "皮肤工作区根目录", "./skins")
    .action(async (siteId, opts) => {
      await guard(async () => {
        await scaffoldHandler({
          siteId: optString(siteId, "siteId"),
          url: optOptionalString(opts.url),
          category: optOptionalString(opts.category),
          archetype: optOptionalString(opts.archetype),
          skinsDir: optOptionalString(opts.skinsDir),
        });
      });
    });

  registerCommand(program, "dev", "启动热重载开发服务器与 Userscript 实时联调桥（HMR 模式）")
    .argument("<siteId>", "站点 ID（kebab-case）")
    .option("--port <port>", "本地 Vite 开发服务器端口", "5173")
    .option("--skins-dir <dir>", "皮肤工作区根目录", "./skins")
    .option("--dry-run", "仅生成 dev.user.js 联调脚本与校验配置，不常驻阻塞终端")
    .action(async (siteId, opts) => {
      await guard(async () => {
        await devHandler({
          siteId: optString(siteId, "siteId"),
          port: optNumber(opts.port, "port", 5173),
          skinsDir: optOptionalString(opts.skinsDir),
          dryRun: Boolean(opts.dryRun),
        });
      });
    });

  return program;


}

/** 命令层错误转换：CliExitError 打印主因 + 灰字细节并置退出码；其余错误按 1 退出。 */
async function guard(run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    if (error instanceof CliExitError) {
      console.error(chalk.red(`✗ ${error.message}`));
      if (error.details !== undefined && error.details.length > 0) {
        console.error(chalk.dim(error.details));
      }
      process.exitCode = error.exitCode;
      return;
    }
    console.error(chalk.red(`✗ ${errorMessage(error)}`));
    process.exitCode = 1;
  }
}

/* ------------------------------------------------------------------ */
/* 直接运行入口（bin: wr）                                              */
/* ------------------------------------------------------------------ */

/** 仅当本模块就是 node 的入口脚本时自动 parse（被 import / 测试加载时不执行）。 */
function isDirectRun(): boolean {
  try {
    const entry = process.argv[1];
    if (entry === undefined) return false;
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  buildProgram()
    .parseAsync(process.argv)
    .catch((error: unknown) => {
      // exitOverride 下 --help / --version / 用法错误以 CommanderError 抛出（消息已由 commander 打印）
      if (error instanceof CommanderError) {
        process.exitCode = error.exitCode;
        return;
      }
      process.exitCode = 1;
    });
}
