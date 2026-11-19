/**
 * MonkeyBundler —— 零闪烁单文件油猴打包引擎。
 *
 * 把一份「皮肤入口（默认导出挂载函数）+ Tailwind v4 样式」编译成单个可直接安装的
 * `.user.js` 用户脚本，并由引擎自身保证两件事：
 *
 * 1. 零闪烁：`@run-at document-start` 同步安装 @webremaster/bridge 的零闪烁幕帘，
 *    DOMContentLoaded 后经 mountWebRemasterRoot 挂载进 Shadow DOM，finally 无条件揭幕；
 *    幕帘自带 failsafe 兜底，数学上杜绝永久白屏。时序由生成 wrapper 固化，
 *    并通过 wrCurtainAt / wrMountedAt 埋点在产物门禁中复核。
 * 2. 单文件：Vite lib(iife) 全量内联——workspace 包（bridge/schema/ui-kit）解析到
 *    packages 各包的 src 源码 alias（不依赖 dist），资源以 data-uri 内联，Tailwind v4 CSS
 *    构建后回注为脚本内字符串常量（`const __WR_CSS__`），产物自检不允许残留任何
 *    import/require/动态 import。
 *
 * 双门禁：
 * - tsc 门禁：用 TypeScript Program API 对「生成 wrapper + 皮肤源码」全图 strict
 *   类型检查（tsconfig 由引擎生成，workspace 包走源码 paths）。皮肤内联合同以
 *   `const CONTRACT: SiteContract` 标注，合同形状错误在此层即被拦截；语法错误同样
 *   在该层暴露。wrapper 的挂载调用点同时校验皮肤默认导出的挂载协议。
 * - vite 门禁：对构建产物做结构自检——恰好 1 个 JS chunk、无未内联产物、CSS 产物
 *   存在且已编译（无 @import "tailwindcss" / @tailwind / @apply 残留）、JS 自包含、
 *   幕帘埋点先于挂载埋点。
 *
 * 关键取舍：
 * - 引擎自身运行时零 workspace 依赖：@webremaster/schema 不在运行时导入（结构预检 +
 *   tsc 门禁分层兜底），vite / typescript / @vitejs/plugin-react / @tailwindcss/vite
 *   全部动态加载，加载失败抛结构化的 tooling-unavailable。
 * - 构建暂存目录固定在 <compiler>/node_modules/.cache/webremaster-monkey 下：皮肤
 *   源码里的裸导入（react 等）可沿 node_modules 链解析，且该目录天然被 .gitignore
 *   覆盖；成功后即清理，门禁失败时保留现场并在错误 details.stagingDir 给出路径。
 * - 皮肤挂载协议：入口默认导出 `mount(context: { host; shadowRoot; contract })`，
 *   皮肤可把 context 声明为其子集（多余属性经中间变量传递，不触发 excess-property 检查）。
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* ------------------------------------------------------------------ */
/* 公开类型                                                            */
/* ------------------------------------------------------------------ */

/** 引擎读取合同所需的最小结构面（完整形状校验由 tsc 门禁对内联合同执行）。 */
export interface MonkeyContractInput {
  readonly siteId: string;
  readonly siteName: string;
  readonly matchPatterns: readonly string[];
  readonly routes: readonly unknown[];
}

/** 零闪烁幕帘参数（与 @webremaster/bridge 的 ZeroFlashCurtainOptions 结构兼容）。 */
export interface MonkeyCurtainOptions {
  readonly darkBg?: string;
  readonly failsafeMs?: number;
}

/** 零闪烁契约：注入时机固定为 document-start，其他值一律拒绝。 */
export type MonkeyRunAt = "document-start";

export interface UserscriptHeaderOverrides {
  readonly name?: string;
  readonly namespace?: string;
  readonly version?: string;
  readonly description?: string;
  readonly author?: string;
  readonly license?: string;
  /** 覆盖 @match（缺省取 contract.matchPatterns）。 */
  readonly match?: readonly string[];
  /** 覆盖 @grant（缺省 ["none"]，引擎不依赖任何 GM_* API）。 */
  readonly grant?: readonly string[];
  readonly runAt?: MonkeyRunAt | (string & {});
  readonly noframes?: boolean;
}

export interface ResolvedUserscriptHeader {
  readonly name: string;
  readonly namespace: string;
  readonly version: string;
  readonly description: string;
  readonly author: string;
  readonly license: string;
  readonly match: readonly string[];
  readonly grant: readonly string[];
  readonly runAt: MonkeyRunAt;
  readonly noframes: boolean;
}

export interface MonkeyBundleOptions {
  readonly contract: MonkeyContractInput;
  /** 皮肤入口文件（默认导出挂载函数；缺扩展名时按 .ts/.tsx/… 探测）。 */
  readonly entry: string;
  /** 输出 .user.js 路径。 */
  readonly outFile: string;
  /** entry/outFile 的解析基准，缺省 process.cwd()。 */
  readonly cwd?: string;
  readonly userscript?: UserscriptHeaderOverrides;
  readonly curtain?: MonkeyCurtainOptions;
  /** 缺省 true；关闭后产物便于人工排查。 */
  readonly minify?: boolean;
}

export interface TypecheckDiagnostic {
  readonly file: string;
  readonly line: number;
  readonly character: number;
  readonly code: string;
  readonly message: string;
}

export interface ViteGateFailure {
  readonly check: string;
  readonly detail: string;
}

export interface MonkeyGateReport {
  readonly typecheck: { readonly ok: boolean; readonly durationMs: number; readonly errorCount: number };
  readonly build: { readonly ok: boolean; readonly durationMs: number };
  readonly artifactGate: { readonly ok: boolean; readonly failures: readonly ViteGateFailure[] };
}

export interface MonkeyBundleResult {
  readonly outFile: string;
  readonly code: string;
  readonly header: ResolvedUserscriptHeader;
  readonly sizeBytes: number;
  readonly jsBytes: number;
  readonly cssBytes: number;
  readonly gate: MonkeyGateReport;
  readonly durationMs: number;
}

export type MonkeyBundleErrorCode =
  | "invalid-contract"
  | "invalid-options"
  | "tooling-unavailable"
  | "typecheck-failed"
  | "build-failed"
  | "gate-failed";

export class MonkeyBundleError extends Error {
  readonly code: MonkeyBundleErrorCode;
  readonly details: unknown;

  constructor(code: MonkeyBundleErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "MonkeyBundleError";
    this.code = code;
    this.details = details ?? null;
  }
}

/* ------------------------------------------------------------------ */
/* 内部常量与定位                                                       */
/* ------------------------------------------------------------------ */

/** CSS 回注常量名（构建后拼在用户脚本最前，wrapper 从脚本作用域读取）。 */
const CSS_CONST_NAME = "__WR_CSS__";
/** 引导阶段埋点属性名：属性名不会被压缩改名，可在产物上复核时序。 */
const BOOT_PHASE_PROP = "__WR_BOOT_PHASE__";
const CURTAIN_MARKER = "wrCurtainAt";
const MOUNTED_MARKER = "wrMountedAt";
const MAX_REPORTED_DIAGNOSTICS = 50;

const SITE_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const HEADER_VALUE_FORBIDDEN_RE = /[\r\n]/;
const GENERATED_WRAPPER_NAME = "wr-monkey-entry.ts";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
/** src/bundler → compiler → packages（编译产物 dist/bundler 的相对层级一致）。 */
const PACKAGES_DIR = path.resolve(MODULE_DIR, "..", "..", "..");
const COMPILER_DIR = path.resolve(MODULE_DIR, "..", "..");
const CACHE_ROOT = path.join(COMPILER_DIR, "node_modules", ".cache", "webremaster-monkey");

/** 以 compiler 包为锚点解析依赖（皮肤文件可在任意目录，向上找不到 react 时也能命中）。 */
const compilerRequire = createRequire(path.join(COMPILER_DIR, "package.json"));

/** react / react-dom 运行时包的绝对入口（vite alias 用；打进单文件产物）。 */
function runtimePackageEntries(): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const id of ["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom", "react-dom/client"]) {
    try {
      entries[id] = compilerRequire.resolve(id);
    } catch {
      /* 缺包时跳过（tsc 门禁会报出缺失） */
    }
  }
  return entries;
}

/** react / react-dom 的类型入口（tsc paths 用；react 类型由 @types/* 提供）。 */
function typePackageEntries(): Record<string, string> {
  const entries: Record<string, string> = {};
  try {
    const reactTypesDir = path.dirname(compilerRequire.resolve("@types/react/package.json"));
    entries["react"] = path.join(reactTypesDir, "index.d.ts");
    entries["react/jsx-runtime"] = path.join(reactTypesDir, "jsx-runtime.d.ts");
    entries["react/jsx-dev-runtime"] = path.join(reactTypesDir, "jsx-dev-runtime.d.ts");
  } catch {
    /* @types/react 缺失时跳过 */
  }
  try {
    const domTypesDir = path.dirname(compilerRequire.resolve("@types/react-dom/package.json"));
    entries["react-dom"] = path.join(domTypesDir, "index.d.ts");
    entries["react-dom/client"] = path.join(domTypesDir, "client.d.ts");
  } catch {
    /* @types/react-dom 缺失时跳过 */
  }
  return entries;
}

/** workspace 包源码入口（index 文件）；vite 精确 alias 与 tsc paths 都指向这里。 */
const WORKSPACE_SOURCE_ENTRIES: Readonly<Record<string, string>> = {
  "@webremaster/bridge": path.join(PACKAGES_DIR, "bridge", "src", "index.ts"),
  "@webremaster/schema": path.join(PACKAGES_DIR, "schema", "src", "index.ts"),
  "@webremaster/ui-kit": path.join(PACKAGES_DIR, "ui-kit", "src", "index.ts"),
};

function assertWorkspaceSourcesExist(): void {
  const missing = Object.entries(WORKSPACE_SOURCE_ENTRIES)
    .filter(([, sourcePath]) => !existsSync(sourcePath))
    .map(([specifier, sourcePath]) => `${specifier} -> ${sourcePath}`);
  if (missing.length > 0) {
    throw new MonkeyBundleError("tooling-unavailable", "workspace 包源码入口缺失（monorepo 结构被破坏？）", { missing });
  }
}

interface Toolchain {
  ts: typeof import("typescript");
  vite: typeof import("vite");
  reactPlugin: typeof import("@vitejs/plugin-react")["default"];
  tailwindPlugin: typeof import("@tailwindcss/vite")["default"];
}

async function loadToolchain(): Promise<Toolchain> {
  try {
    const [tsModule, viteModule, reactModule, tailwindModule] = await Promise.all([
      import("typescript"),
      import("vite"),
      import("@vitejs/plugin-react"),
      import("@tailwindcss/vite"),
    ]);
    return {
      ts: tsModule,
      vite: viteModule,
      reactPlugin: reactModule.default,
      tailwindPlugin: tailwindModule.default,
    };
  } catch (error) {
    throw new MonkeyBundleError(
      "tooling-unavailable",
      `打包工具链加载失败（需要 vite / typescript / @vitejs/plugin-react / @tailwindcss/vite）：${collectErrorMessages(error).join("; ")}`,
      { causes: collectErrorMessages(error) },
    );
  }
}

/* ------------------------------------------------------------------ */
/* 纯函数：用户脚本头                                                   */
/* ------------------------------------------------------------------ */

export function resolveUserscriptHeader(
  contract: MonkeyContractInput,
  overrides?: UserscriptHeaderOverrides,
): ResolvedUserscriptHeader {
  const singleLine = (value: string, field: string): string => {
    if (value.length === 0) {
      throw new MonkeyBundleError("invalid-options", `userscript.${field} 不能为空`);
    }
    if (HEADER_VALUE_FORBIDDEN_RE.test(value)) {
      throw new MonkeyBundleError("invalid-options", `userscript.${field} 不能包含换行（元数据块按行解析）`);
    }
    return value;
  };

  const match = overrides?.match ?? contract.matchPatterns;
  if (!Array.isArray(match) || match.length === 0) {
    throw new MonkeyBundleError(
      "invalid-options",
      "match 规则不能为空：contract.matchPatterns 或 userscript.match 至少提供一项",
    );
  }
  const matchList = match.map((pattern) => singleLine(pattern, "match"));
  const grantList = (overrides?.grant ?? ["none"]).map((grant) => singleLine(grant, "grant"));

  const runAtOverride = overrides?.runAt;
  if (runAtOverride !== undefined && runAtOverride !== "document-start") {
    throw new MonkeyBundleError(
      "invalid-options",
      `userscript.runAt 只允许 "document-start"（实际：${String(runAtOverride)}）：非 document-start 注入会在幕帘安装前渲染原站，破坏零闪烁契约`,
    );
  }

  return {
    name: overrides?.name === undefined ? `WebRemaster · ${contract.siteName}` : singleLine(overrides.name, "name"),
    namespace: overrides?.namespace === undefined ? "webremaster" : singleLine(overrides.namespace, "namespace"),
    version: overrides?.version === undefined ? "0.1.0" : singleLine(overrides.version, "version"),
    description:
      overrides?.description === undefined
        ? `${contract.siteName} 零闪烁 Shadow-DOM 重制皮肤（${contract.routes.length} 条路由）`
        : singleLine(overrides.description, "description"),
    author: overrides?.author === undefined ? "WebRemaster Compiler" : singleLine(overrides.author, "author"),
    license: overrides?.license === undefined ? "MIT" : singleLine(overrides.license, "license"),
    match: matchList,
    grant: grantList,
    runAt: "document-start",
    noframes: overrides?.noframes === true,
  };
}

export function renderUserscriptHeader(header: ResolvedUserscriptHeader): string {
  const lines: string[] = ["// ==UserScript=="];
  const push = (key: string, value?: string): void => {
    const padded = `@${key}`.padEnd(14);
    lines.push(value === undefined ? `// ${padded}`.trimEnd() : `// ${padded}${value}`);
  };
  push("name", header.name);
  push("namespace", header.namespace);
  push("version", header.version);
  push("description", header.description);
  push("author", header.author);
  push("license", header.license);
  for (const pattern of header.match) {
    push("match", pattern);
  }
  for (const grant of header.grant) {
    push("grant", grant);
  }
  push("run-at", header.runAt);
  if (header.noframes) {
    push("noframes");
  }
  lines.push("// ==/UserScript==");
  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/* 纯函数：字符串剥离与产物门禁                                          */
/* ------------------------------------------------------------------ */

/**
 * 去除 JS 源文本中的字符串字面量与注释，用于自包含扫描。
 * 保守策略：模板字面量按整体字符串处理（${} 表达式一并移除），已知局限记录在注释，
 * 不会把字符串里的 "import(" 误报为真实引用；正则字面量内的引号可能引起少量误吞，
 * 因此时序埋点检查直接扫原文（埋点为属性名，永不落入字符串/注释）。
 */
export function stripJsStringsAndComments(source: string): string {
  let out = "";
  let i = 0;
  const length = source.length;
  while (i < length) {
    const ch = source[i];
    const next = i + 1 < length ? source[i + 1] : "";
    if (ch === "/" && next === "/") {
      while (i < length && source[i] !== "\n") {
        i += 1;
      }
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < length && !(source[i] === "*" && i + 1 < length && source[i + 1] === "/")) {
        i += 1;
      }
      i = Math.min(i + 2, length);
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i += 1;
      while (i < length) {
        const current = source[i];
        if (current === "\\") {
          i += 2;
          continue;
        }
        if (current === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      out += " ";
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

export interface ArtifactGateInput {
  readonly jsChunkFileNames: readonly string[];
  readonly assetFileNames: readonly string[];
  readonly jsCode: string;
  readonly cssCode: string | null;
}

export function evaluateArtifactGate(input: ArtifactGateInput): ViteGateFailure[] {
  const failures: ViteGateFailure[] = [];

  if (input.jsChunkFileNames.length !== 1) {
    failures.push({
      check: "single-js-chunk",
      detail: `lib(iife) 单文件要求恰好 1 个 JS chunk，实际 ${input.jsChunkFileNames.length} 个（${input.jsChunkFileNames.join(", ") || "无"}）`,
    });
  }

  const unexpected = [...input.jsChunkFileNames, ...input.assetFileNames].filter(
    (name) => !/\.js$/.test(name) && !/\.css$/.test(name),
  );
  if (unexpected.length > 0) {
    failures.push({
      check: "artifact-set",
      detail: `产物只允许 1 个 JS chunk 与 1 个 CSS 资产，出现未内联产物：${unexpected.join(", ")}`,
    });
  }

  if (input.cssCode === null) {
    failures.push({
      check: "css-present",
      detail: "未找到任何 CSS 产物：皮肤入口必须 import 样式文件（Tailwind v4 入口）",
    });
  } else if (input.cssCode.trim().length === 0) {
    failures.push({ check: "css-compiled", detail: "CSS 产物为空" });
  } else {
    if (/@import\s+["'][^"']*tailwindcss/i.test(input.cssCode)) {
      failures.push({
        check: "css-compiled",
        detail: 'CSS 中残留 @import "tailwindcss" 原始声明，Tailwind v4 未执行',
      });
    }
    if (/@tailwind\s/.test(input.cssCode)) {
      failures.push({ check: "css-compiled", detail: "CSS 中残留 @tailwind 指令，Tailwind 未处理该样式" });
    }
    if (/@apply\b/.test(input.cssCode)) {
      failures.push({ check: "css-compiled", detail: "CSS 中残留 @apply 声明，Tailwind 未处理该样式" });
    }
  }

  const stripped = stripJsStringsAndComments(input.jsCode);
  const selfContainedPatterns: ReadonlyArray<{ label: string; regex: RegExp }> = [
    { label: "动态 import(", regex: /\bimport\s*\(/ },
    { label: "require(", regex: /\brequire\s*\(/ },
    { label: "静态 import/export 语句", regex: /(?:^|[;{}])\s*(?:import|export)\b/ },
  ];
  for (const { label, regex } of selfContainedPatterns) {
    const match = regex.exec(stripped);
    if (match !== null) {
      const start = Math.max(0, match.index - 40);
      const snippet = stripped
        .slice(start, match.index + 60)
        .replace(/\s+/g, " ")
        .trim();
      failures.push({
        check: "js-self-contained",
        detail: `打包产物不是自包含 JS：检测到${label}（片段：…${snippet}…）`,
      });
    }
  }

  const curtainIndex = input.jsCode.indexOf(CURTAIN_MARKER);
  const mountedIndex = input.jsCode.indexOf(MOUNTED_MARKER);
  if (curtainIndex < 0 || mountedIndex < 0) {
    failures.push({
      check: "boot-order",
      detail: `打包产物缺少零闪烁引导埋点（${CURTAIN_MARKER} / ${MOUNTED_MARKER}），生成 wrapper 可能未进入构建`,
    });
  } else if (curtainIndex > mountedIndex) {
    failures.push({ check: "boot-order", detail: "零闪烁时序被破坏：幕帘埋点出现在挂载埋点之后" });
  }

  return failures;
}

/* ------------------------------------------------------------------ */
/* 纯函数：生成 wrapper 与门禁 tsconfig                                  */
/* ------------------------------------------------------------------ */

export interface WrapperModuleInput {
  /** wrapper 对皮肤入口的相对导入说明符（posix 相对路径，含扩展名）。 */
  readonly entrySpecifier: string;
  /** 合同的 JSON 文本（内联为对象字面量，tsc 门禁按 SiteContract 结构校验）。 */
  readonly contractJson: string;
  readonly appId: string;
  /** 幕帘参数 JSON 文本（无覆盖时为 "{}"，bridge 侧取默认值）。 */
  readonly curtainJson: string;
}

export function buildWrapperModule(input: WrapperModuleInput): string {
  return `/**
 * <auto-generated by @webremaster/compiler monkeyBundler —— 构建期生成，请勿手改>
 * 零闪烁引导：document-start 同步安装幕帘 → DOMContentLoaded 后经 Shadow DOM 挂载皮肤 →
 * finally 无条件揭幕（幕帘自身另有 failsafe 兜底）。
 * 皮肤协议：入口模块默认导出 mount(context)，context 为
 * { host: HTMLElement; shadowRoot: ShadowRoot; contract: SiteContract } 的超集，
 * 皮肤可以把参数声明为其子集类型。
 */
import { createOriginManager, installZeroFlashCurtain, mountWebRemasterRoot, type ViewMode } from "@webremaster/bridge";
import type { SiteContract } from "@webremaster/schema";
import mountSkin from "${input.entrySpecifier}";

declare const ${CSS_CONST_NAME}: unknown;

const CONTRACT: SiteContract = ${input.contractJson};
const APP_ID = ${JSON.stringify(input.appId)};
const CURTAIN_OPTS = ${input.curtainJson};
const skinCss = typeof ${CSS_CONST_NAME} === "string" ? ${CSS_CONST_NAME} : "";

interface WrBootPhase {
  ${CURTAIN_MARKER}?: number;
  ${MOUNTED_MARKER}?: number;
}
/** 自动化验收采集的只读诊断句柄（Gate 3/5/6 依赖）。 */
interface WrDebugHandle {
  getMode(): ViewMode;
  setMode(mode: ViewMode): void;
  getHealth(): unknown;
  bootPhase: WrBootPhase;
}
declare global {
  interface Window {
    ${BOOT_PHASE_PROP}?: WrBootPhase;
    __WR_DEBUG__?: WrDebugHandle;
  }
}
const bootPhase: WrBootPhase = {};
window.${BOOT_PHASE_PROP} = bootPhase;

const liftCurtain = installZeroFlashCurtain(CURTAIN_OPTS);
bootPhase.${CURTAIN_MARKER} = Date.now();

const boot = async (): Promise<void> => {
  let mounted: { host: HTMLElement; shadowRoot: ShadowRoot } | null = null;
  const manager = createOriginManager();
  const diagnostics: { healthSummary?: () => unknown; features?: { commandPalette?: boolean; diagnosticsDrawer?: boolean } } = {};
  try {
    const originWrapper = manager.captureAndHideOrigin();
    mounted = mountWebRemasterRoot(APP_ID, skinCss);
    const context = {
      host: mounted.host,
      shadowRoot: mounted.shadowRoot,
      contract: CONTRACT,
      originManager: manager,
      originWrapper,
      diagnostics,
    };
    await mountSkin(context);
    bootPhase.${MOUNTED_MARKER} = Date.now();
    const debugHandle: WrDebugHandle = {
      getMode: (): ViewMode => manager.getViewMode(),
      setMode: (mode: ViewMode): void => {
        manager.setViewMode(mode);
      },
      getHealth: (): unknown => diagnostics.healthSummary?.() ?? null,
      bootPhase,
    };
    window.__WR_DEBUG__ = debugHandle;
  } catch (error) {
    console.error("[webremaster] 皮肤挂载失败，幕帘已揭起，回退原站：", error);
    if (mounted !== null) {
      try {
        mounted.host.remove();
      } catch {
        /* host 已被外部移除时忽略 */
      }
    }
  } finally {
    liftCurtain();
  }
};

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    () => {
      void boot();
    },
    { once: true },
  );
} else {
  void boot();
}
`;
}

export interface GateTsconfig {
  readonly compilerOptions: Record<string, unknown>;
  readonly include: readonly string[];
}

export function buildGateTsconfig(aliasPaths: Readonly<Record<string, string>>): GateTsconfig {
  const paths: Record<string, string[]> = {};
  for (const [specifier, target] of Object.entries(aliasPaths)) {
    paths[specifier] = [target];
    if (!specifier.endsWith("/*")) {
      // 子路径映射：把 "…/index.ts" 还原为目录再挂通配
      const dir = target.replace(/\/index\.(ts|tsx)$/, "");
      paths[`${specifier}/*`] = [`${dir}/*`];
    }
  }
  return {
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "Bundler",
      jsx: "react-jsx",
      lib: ["ES2022", "DOM", "DOM.Iterable"],
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      esModuleInterop: true,
      allowImportingTsExtensions: true,
      isolatedModules: true,
      forceConsistentCasingInFileNames: true,
      noFallthroughCasesInSwitch: true,
      types: [],
      baseUrl: ".",
      paths,
    },
    include: ["**/*.ts", "**/*.tsx"],
  };
}

/* ------------------------------------------------------------------ */
/* 内部工具                                                             */
/* ------------------------------------------------------------------ */

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

function relativeSpecifier(fromDir: string, targetFile: string): string {
  const rel = toPosix(path.relative(fromDir, targetFile));
  return rel.startsWith(".") ? rel : `./${rel}`;
}

const ENTRY_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".jsx", ".js"] as const;

function resolveEntryFile(entry: string, cwd: string): string {
  const trimmed = entry.trim();
  if (trimmed.length === 0) {
    throw new MonkeyBundleError("invalid-options", "entry 不能为空");
  }
  const base = path.resolve(cwd, trimmed);
  const candidates = [base, ...ENTRY_EXTENSIONS.map((extension) => `${base}${extension}`)];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate;
    }
  }
  throw new MonkeyBundleError(
    "invalid-options",
    `皮肤入口不存在：${entry}（已尝试：${candidates.join(", ")}）`,
    { tried: candidates },
  );
}

function resolveOutputFile(outFile: string, cwd: string): string {
  const trimmed = outFile.trim();
  if (trimmed.length === 0) {
    throw new MonkeyBundleError("invalid-options", "outFile 不能为空");
  }
  return path.resolve(cwd, trimmed);
}

function assertValidContract(contract: MonkeyContractInput): void {
  if (typeof contract !== "object" || contract === null) {
    throw new MonkeyBundleError("invalid-contract", "contract 必须是 SiteContract 形状的对象");
  }
  if (typeof contract.siteId !== "string" || !SITE_ID_RE.test(contract.siteId)) {
    throw new MonkeyBundleError(
      "invalid-contract",
      `contract.siteId 必须为 kebab-case（${SITE_ID_RE}），实际：${String(contract.siteId)}`,
    );
  }
  if (typeof contract.siteName !== "string" || contract.siteName.length === 0) {
    throw new MonkeyBundleError("invalid-contract", "contract.siteName 必须是非空字符串");
  }
  if (!Array.isArray(contract.matchPatterns) || contract.matchPatterns.length === 0) {
    throw new MonkeyBundleError("invalid-contract", "contract.matchPatterns 必须是非空字符串数组");
  }
  if (!Array.isArray(contract.routes) || contract.routes.length === 0) {
    throw new MonkeyBundleError(
      "invalid-contract",
      "contract.routes 必须是非空数组（路由内完整结构由 tsc 门禁对内联合同校验）",
    );
  }
}

function collectErrorMessages(error: unknown): string[] {
  const messages: string[] = [];
  const visit = (value: unknown, depth: number): void => {
    if (typeof value === "string") {
      if (value.trim().length > 0) {
        messages.push(value);
      }
      return;
    }
    if (value instanceof Error) {
      messages.push(value.message);
      return;
    }
    if (Array.isArray(value)) {
      if (depth < 4) {
        for (const item of value) {
          visit(item, depth + 1);
        }
      }
      return;
    }
    if (typeof value === "object" && value !== null) {
      const holder = value as { message?: unknown; errors?: unknown };
      if (typeof holder.message === "string" && holder.message.trim().length > 0) {
        messages.push(holder.message);
      }
      if (Array.isArray(holder.errors) && depth < 4) {
        for (const item of holder.errors) {
          visit(item, depth + 1);
        }
      }
      return;
    }
    if (value !== undefined && value !== null) {
      messages.push(String(value));
    }
  };
  visit(error, 0);
  if (messages.length === 0) {
    messages.push("未知错误（原始错误对象未携带可读消息）");
  }
  return messages;
}

/* ------------------------------------------------------------------ */
/* tsc 门禁                                                             */
/* ------------------------------------------------------------------ */

interface TypecheckOutcome {
  ok: boolean;
  durationMs: number;
  errorCount: number;
  errors: TypecheckDiagnostic[];
}

function runTypecheckGate(toolchain: Toolchain, stagingDir: string): TypecheckOutcome {
  const started = performance.now();
  const ts = toolchain.ts;
  const configPath = path.join(stagingDir, "tsconfig.json");
  const configText = readFileSync(configPath, "utf8");
  const configJson = JSON.parse(configText) as Record<string, unknown>;
  const parsed = ts.parseJsonConfigFileContent(configJson, ts.sys, stagingDir, undefined, configPath);
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  const errors = diagnostics.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  const mapped = errors.slice(0, MAX_REPORTED_DIAGNOSTICS).map((diagnostic): TypecheckDiagnostic => {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
    const file = diagnostic.file;
    if (file === undefined || diagnostic.start === undefined) {
      return { file: "<program>", line: 0, character: 0, code: `TS${diagnostic.code}`, message };
    }
    const position = file.getLineAndCharacterOfPosition(diagnostic.start);
    return {
      file: file.fileName,
      line: position.line + 1,
      character: position.character + 1,
      code: `TS${diagnostic.code}`,
      message,
    };
  });
  return {
    ok: errors.length === 0,
    durationMs: Math.round(performance.now() - started),
    errorCount: errors.length,
    errors: mapped,
  };
}

/* ------------------------------------------------------------------ */
/* Vite 构建                                                            */
/* ------------------------------------------------------------------ */

interface BuildOutcome {
  ok: boolean;
  durationMs: number;
  jsChunkFileNames: string[];
  assetFileNames: string[];
  jsCode: string;
  cssCode: string | null;
}

interface ViteBuildInput {
  stagingDir: string;
  wrapperPath: string;
  globalName: string;
  minify: boolean;
}

function buildViteAliases(): Array<{ find: RegExp; replacement: string }> {
  const aliases: Array<{ find: RegExp; replacement: string }> = [];
  for (const [specifier, indexFile] of Object.entries(WORKSPACE_SOURCE_ENTRIES)) {
    const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    aliases.push({ find: new RegExp(`^${escaped}$`), replacement: indexFile });
    aliases.push({ find: new RegExp(`^${escaped}/`), replacement: `${path.dirname(indexFile)}/` });
  }
  // react / react-dom 运行时：皮肤文件可能在任意目录，必须显式锚定到 compiler 的依赖
  for (const [specifier, target] of Object.entries(runtimePackageEntries())) {
    const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    aliases.push({ find: new RegExp(`^${escaped}$`), replacement: target });
  }
  return aliases;
}

async function runViteBuild(toolchain: Toolchain, input: ViteBuildInput): Promise<BuildOutcome> {
  const started = performance.now();
  let buildResult: Awaited<ReturnType<Toolchain["vite"]["build"]>>;
  try {
    buildResult = await toolchain.vite.build({
      configFile: false,
      root: input.stagingDir,
      mode: "production",
      logLevel: "silent",
      esbuild: { jsx: "automatic", jsxImportSource: "react" },
      resolve: { alias: buildViteAliases() },
      // 浏览器产物零 process：替换 CJS 依赖（React 19 等）内的 NODE_ENV 分支，
      // 否则 lib 模式下依赖内的 process.env.NODE_ENV 原样保留，document-start 即 ReferenceError
      define: {
        "process.env.NODE_ENV": JSON.stringify("production"),
      },
      plugins: [toolchain.reactPlugin(), toolchain.tailwindPlugin()],
      build: {
        sourcemap: false,
        minify: input.minify,
        target: "es2020",
        cssCodeSplit: false,
        assetsInlineLimit: 100_000_000,
        write: false,
        lib: {
          entry: toPosix(input.wrapperPath),
          formats: ["iife"],
          name: input.globalName,
          fileName: () => "skin.js",
          // vite 6.4+ lib 产物含 CSS 且项目根无 package.json name 时必须显式指定
          cssFileName: "skin",
        },
      },
    });
  } catch (error) {
    throw new MonkeyBundleError(
      "build-failed",
      `Vite 构建失败：${collectErrorMessages(error)[0] ?? "未知错误"}`,
      { buildErrors: collectErrorMessages(error), stagingDir: input.stagingDir },
    );
  }

  // vite 6.x lib+write:false 返回 RollupOutput[]（每个 lib format 一个元素，元素.output 才是产物列表）
  type BuildOutput = { type: string; fileName: string; code?: string; source?: string | Uint8Array };
  const bundles: unknown[] = Array.isArray(buildResult) ? [...(buildResult as unknown[])] : [buildResult];
  const entries: unknown[] = [];
  for (const bundle of bundles) {
    if (bundle !== null && typeof bundle === "object" && "output" in (bundle as Record<string, unknown>)) {
      const inner = (bundle as { output: unknown }).output;
      if (Array.isArray(inner)) entries.push(...inner);
      else entries.push(inner);
    } else {
      entries.push(bundle); // 兼容已是产物级对象的形态
    }
  }
  const outputs = entries as unknown as BuildOutput[];
  const jsChunkFileNames: string[] = [];
  const assetFileNames: string[] = [];
  let jsCode = "";
  let cssCode: string | null = null;
  for (const output of outputs) {
    if (output.type === "chunk") {
      jsChunkFileNames.push(output.fileName);
      jsCode = output.code ?? "";
    } else {
      assetFileNames.push(output.fileName);
      if (/\.css$/.test(output.fileName)) {
        const source = output.source;
        cssCode = typeof source === "string" ? source : new TextDecoder("utf-8").decode(source);
      }
    }
  }
  return {
    ok: true,
    durationMs: Math.round(performance.now() - started),
    jsChunkFileNames,
    assetFileNames,
    jsCode,
    cssCode,
  };
}

/* ------------------------------------------------------------------ */
/* 暂存目录                                                             */
/* ------------------------------------------------------------------ */

const STAGING_GLOBALS_DTS = [
  "/** <auto-generated> 打包期环境垫片：tsc 门禁下资源导入的类型面（与 Vite 资源语义一致）。 */",
  'declare module "*.css" {',
  "  const css: string;",
  "  export default css;",
  "}",
  'declare module "*.svg" {',
  "  const url: string;",
  "  export default url;",
  "}",
  'declare module "*.png" {',
  "  const url: string;",
  "  export default url;",
  "}",
  'declare module "*.jpg" {',
  "  const url: string;",
  "  export default url;",
  "}",
  'declare module "*.jpeg" {',
  "  const url: string;",
  "  export default url;",
  "}",
  'declare module "*.webp" {',
  "  const url: string;",
  "  export default url;",
  "}",
  'declare module "*.gif" {',
  "  const url: string;",
  "  export default url;",
  "}",
  'declare module "*.woff" {',
  "  const url: string;",
  "  export default url;",
  "}",
  'declare module "*.woff2" {',
  "  const url: string;",
  "  export default url;",
  "}",
].join("\n");

async function createStaging(): Promise<string> {
  await mkdir(CACHE_ROOT, { recursive: true });
  return mkdtemp(path.join(CACHE_ROOT, "bundle-"));
}

async function writeStagingFiles(stagingDir: string, wrapperModule: string, tsconfig: GateTsconfig): Promise<void> {
  await Promise.all([
    writeFile(path.join(stagingDir, GENERATED_WRAPPER_NAME), wrapperModule, "utf8"),
    writeFile(path.join(stagingDir, "wr-globals.d.ts"), STAGING_GLOBALS_DTS, "utf8"),
    writeFile(path.join(stagingDir, "tsconfig.json"), JSON.stringify(tsconfig, null, 2), "utf8"),
  ]);
}

/* ------------------------------------------------------------------ */
/* 主流程                                                               */
/* ------------------------------------------------------------------ */

function buildGlobalName(siteId: string): string {
  return `__WR_SKIN_${siteId.replace(/[^A-Za-z0-9]/g, "_").toUpperCase()}__`;
}

export async function bundleMonkeySkin(options: MonkeyBundleOptions): Promise<MonkeyBundleResult> {
  const startedAt = performance.now();
  const cwd = options.cwd ?? process.cwd();

  assertValidContract(options.contract);
  const entryAbs = resolveEntryFile(options.entry, cwd);
  const outFileAbs = resolveOutputFile(options.outFile, cwd);
  const header = resolveUserscriptHeader(options.contract, options.userscript);

  assertWorkspaceSourcesExist();
  const toolchain = await loadToolchain();

  const minify = options.minify ?? true;
  const stagingDir = await createStaging();
  try {
    const wrapperModule = buildWrapperModule({
      entrySpecifier: relativeSpecifier(stagingDir, entryAbs),
      contractJson: JSON.stringify(options.contract),
      appId: options.contract.siteId,
      curtainJson: JSON.stringify(options.curtain ?? {}),
    });
    const aliasPaths: Record<string, string> = {};
    for (const [specifier, sourcePath] of Object.entries(WORKSPACE_SOURCE_ENTRIES)) {
      aliasPaths[specifier] = toPosix(path.relative(stagingDir, sourcePath));
    }
    // react 类型映射用绝对路径（tsc paths 支持绝对；皮肤任意位置均可解析）
    for (const [specifier, typePath] of Object.entries(typePackageEntries())) {
      aliasPaths[specifier] = toPosix(typePath);
    }
    await writeStagingFiles(stagingDir, wrapperModule, buildGateTsconfig(aliasPaths));

    const typecheck = runTypecheckGate(toolchain, stagingDir);
    if (!typecheck.ok) {
      throw new MonkeyBundleError(
        "typecheck-failed",
        `tsc 门禁未通过：${typecheck.errorCount} 个错误（暂存现场保留于 ${stagingDir}）`,
        { errors: typecheck.errors, totalErrorCount: typecheck.errorCount, stagingDir },
      );
    }

    const build = await runViteBuild(toolchain, {
      stagingDir,
      wrapperPath: path.join(stagingDir, GENERATED_WRAPPER_NAME),
      globalName: buildGlobalName(options.contract.siteId),
      minify,
    });

    const failures = evaluateArtifactGate({
      jsChunkFileNames: build.jsChunkFileNames,
      assetFileNames: build.assetFileNames,
      jsCode: build.jsCode,
      cssCode: build.cssCode,
    });
    if (failures.length > 0) {
      throw new MonkeyBundleError(
        "gate-failed",
        `vite 产物门禁未通过：${failures.map((failure) => failure.check).join("、")}`,
        { failures, stagingDir },
      );
    }

    const jsCode = build.jsCode;
    const cssCode = build.cssCode;
    if (cssCode === null) {
      // css-present 门禁已保证非空，此处为防御性兜底
      throw new MonkeyBundleError("gate-failed", "内部错误：css-present 门禁通过但 CSS 产物缺失", { stagingDir });
    }

    const finalCode = [
      renderUserscriptHeader(header),
      "",
      `const ${CSS_CONST_NAME} = ${JSON.stringify(cssCode)};`,
      "",
      jsCode.trimEnd(),
      "",
    ].join("\n");

    await mkdir(path.dirname(outFileAbs), { recursive: true });
    await writeFile(outFileAbs, finalCode, "utf8");

    // 成功即清理暂存；失败路径保留现场供排查（见各错误 details.stagingDir）
    await rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);

    return {
      outFile: outFileAbs,
      code: finalCode,
      header,
      sizeBytes: Buffer.byteLength(finalCode, "utf8"),
      jsBytes: Buffer.byteLength(jsCode, "utf8"),
      cssBytes: Buffer.byteLength(cssCode, "utf8"),
      gate: {
        typecheck: { ok: typecheck.ok, durationMs: typecheck.durationMs, errorCount: typecheck.errorCount },
        build: { ok: build.ok, durationMs: build.durationMs },
        artifactGate: { ok: true, failures: [] },
      },
      durationMs: Math.round(performance.now() - startedAt),
    };
  } catch (error) {
    if (error instanceof MonkeyBundleError) {
      throw error;
    }
    throw new MonkeyBundleError(
      "build-failed",
      `打包过程出现未预期错误：${collectErrorMessages(error)[0] ?? "未知错误"}`,
      { stagingDir, causes: collectErrorMessages(error) },
    );
  }
}
