/**
 * LlmGateway —— 三档熔断 LLM 网关。
 *
 * 「三档」= closed / open / half-open 三态熔断器（与 @webremaster/bridge 的
 * CircuitBreaker 同语义；此处服务端独立实现，避免在 Node 侧引入浏览器包）：
 *   closed    ：正常放行；连续失败达 threshold → open；
 *   open      ：快速失败拒绝请求（缓存命中仍可服务）；resetMs 后自动进入 half-open；
 *   half-open ：仅放行一个探测请求，并发请求快速失败；探测成功 → closed，失败 → open。
 *
 * 内建能力：
 * - SQLite WAL 缓存（命中不消耗 Token 预算、熔断期间仍可服务）；
 * - Token 预算闸：调用前用「4 字符 ≈ 1 token + 每条消息 4 token 元数据 + 图片
 *   IMAGE_TOKEN_ESTIMATE」粗估，已用 + 估算 > 预算则立即抛 TokenBudgetExceededError；
 * - 可恢复错误（429/5xx/网络抖动/JSON 修复失败）按 delay_n = baseDelayMs * 2^n
 *   指数退避重试；不可恢复错误（400/401/403/404/413/422）立即抛出，不重试不退避；
 * - JSON 回炉：json 请求的输出非法时，把坏输出以 assistant 消息附回上下文并追加
 *   修复指令让模型重写，最多 jsonRepairs 次，仍失败按可恢复错误进入重试。
 */
import type { ZodType, ZodTypeDef } from "zod";
import {
  computeCacheKey,
  type LlmCache,
  type LlmCacheEntry,
  type LlmImage,
  type LlmMessage,
  type LlmUsage,
} from "./cache.js";

export type { LlmCache, LlmCacheEntry, LlmImage, LlmMessage, LlmUsage } from "./cache.js";

export type LlmFailureKind = "recoverable" | "unrecoverable";

export class LlmError extends Error {
  readonly kind: LlmFailureKind;
  readonly status?: number;

  constructor(message: string, kind: LlmFailureKind, status?: number) {
    super(message);
    this.name = "LlmError";
    this.kind = kind;
    this.status = status;
  }
}

export class TokenBudgetExceededError extends Error {
  readonly used: number;
  readonly estimate: number;
  readonly budget: number;

  constructor(used: number, estimate: number, budget: number) {
    super(`Token 预算不足：已用 ${used}，本次预估 ${estimate}，预算上限 ${budget}`);
    this.name = "TokenBudgetExceededError";
    this.used = used;
    this.estimate = estimate;
    this.budget = budget;
  }
}

/** 400/401/403/404/413/422 属于参数、鉴权、模型不存在、超长类错误：重试无意义。 */
const UNRECOVERABLE_HTTP_STATUSES: ReadonlySet<number> = new Set([400, 401, 403, 404, 413, 422]);

export function classifyHttpFailure(status: number): LlmFailureKind {
  return UNRECOVERABLE_HTTP_STATUSES.has(status) ? "unrecoverable" : "recoverable";
}

/** 每张图片按输入 token 粗估的上界（保守常数，供预算闸使用）。 */
export const IMAGE_TOKEN_ESTIMATE = 800;

/** 粗估文本 token：4 字符 ≈ 1 token，空串为 0。仅用于预算闸，不代表计费值。 */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}

export function estimateRequestTokens(req: LlmRequest): number {
  let total = 0;
  for (const m of req.messages) {
    total += estimateTokens(m.content) + 4;
  }
  total += (req.images?.length ?? 0) * IMAGE_TOKEN_ESTIMATE;
  return total;
}

export interface LlmRequest {
  messages: readonly LlmMessage[];
  images?: readonly LlmImage[];
  /** 期望 JSON 输出：启用严格解析 + 非法时「回炉」修复；成功后 parsed 写入结果与缓存。 */
  json?: boolean;
  /** 参与缓存 key 的管道名（如 "dom-xray"、"skin-manifest"）。 */
  schemaName?: string;
  /** 默认 0。 */
  temperature?: number;
  maxTokens?: number;
}

export interface LlmResult {
  text: string;
  parsed?: unknown;
  model: string;
  usage: LlmUsage;
  /** true = 来自缓存，未调用 transport、未消耗预算与熔断计数。 */
  fromCache: boolean;
  /** 本次完成累计的 transport 调用次数（含回炉与重试）；缓存命中为 0。 */
  attempts: number;
}

export interface LlmTransportCall {
  model: string;
  messages: readonly LlmMessage[];
  images: readonly LlmImage[];
  temperature: number;
  maxTokens?: number;
  jsonMode: boolean;
}

export interface LlmTransportResult {
  text: string;
  usage?: LlmUsage;
}

export type LlmTransport = (call: LlmTransportCall) => Promise<LlmTransportResult>;

export type JsonParseOutcome = { ok: true; value: unknown } | { ok: false };

/** JSON 回炉时附加在上下文末尾的修复指令（网关与测试共用同一常量）。 */
export const JSON_REPAIR_INSTRUCTION =
  "你的上一条输出不是合法 JSON。请重新输出：只输出修复后的合法 JSON 本身，禁止解释、禁止 Markdown 代码围栏、禁止任何额外文本；保持原有数据结构与字段语义不变。";

/** 宽松解析：剥离 ``` / ```json 围栏后 JSON.parse；失败返回 { ok: false }。 */
export function tryParseJsonLoose(text: string): JsonParseOutcome {
  const stripped = stripJsonFence(text);
  if (stripped.length === 0) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(stripped) as unknown };
  } catch {
    return { ok: false };
  }
}

function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```[a-zA-Z0-9_-]*\s*\n?([\s\S]*?)\n?\s*```$/.exec(trimmed);
  return (fenced !== null ? fenced[1] : trimmed).trim();
}

export type GatewayCircuitState = "closed" | "open" | "half-open";

export interface GatewayBreakerOptions {
  threshold: number;
  /** open → half-open 的自动探测等待毫秒数；0 = 永不自动半开，需手动 reset()。 */
  resetMs: number;
  onTrip?: (reason: string) => void;
}

/** 三档熔断器：closed / open / half-open。 */
export class GatewayBreaker {
  private readonly threshold: number;
  private readonly resetMs: number;
  private readonly tripCallback?: (reason: string) => void;
  private failures = 0;
  private state: GatewayCircuitState = "closed";
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(opts: GatewayBreakerOptions) {
    this.threshold = Math.max(1, Math.floor(opts.threshold));
    this.resetMs = Math.max(0, Math.floor(opts.resetMs));
    this.tripCallback = opts.onTrip;
  }

  getState(): GatewayCircuitState {
    return this.state;
  }

  isTripped(): boolean {
    return this.state === "open";
  }

  recordSuccess(): void {
    this.failures = 0;
    this.clearTimer();
    if (this.state !== "closed") {
      this.state = "closed";
    }
  }

  recordFailure(reason: string): void {
    if (this.state === "open") return; // open 期间不再重复计数
    this.failures += 1;
    if (this.failures >= this.threshold) {
      this.state = "open";
      try {
        this.tripCallback?.(reason);
      } catch {
        /* onTrip 异常不影响熔断状态 */
      }
      if (this.resetMs > 0) {
        this.timer = setTimeout(() => {
          this.state = "half-open";
        }, this.resetMs);
        this.timer.unref();
      }
    }
  }

  reset(): void {
    this.failures = 0;
    this.clearTimer();
    this.state = "closed";
  }

  dispose(): void {
    this.clearTimer();
  }

  private clearTimer(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
}

export interface LlmGatewayOptions {
  model: string;
  /** 缺省时按需惰性创建 OpenAI transport（读取 OPENAI_API_KEY / OPENAI_BASE_URL）。 */
  transport?: LlmTransport;
  /** 传入即启用缓存；熔断/预算判断之前先查缓存。 */
  cache?: LlmCache;
  /** 会话级 Token 预算（prompt + completion 合计），0 = 不限。默认 0。 */
  tokenBudget?: number;
  /** 每次调用的最大重试次数（不含首次）。默认 2。 */
  maxRetries?: number;
  /** 退避基数：delay_n = baseDelayMs * 2^n。默认 200。 */
  baseDelayMs?: number;
  /** 连续失败多少次熔断。默认 3。 */
  breakerThreshold?: number;
  /** 熔断后半开探测等待毫秒数；0 = 永不自动半开。默认 30000。 */
  breakerResetMs?: number;
  /** JSON 回炉修复最大次数。默认 1。 */
  jsonRepairs?: number;
  /** 等待函数，测试注入；默认真实 setTimeout。 */
  sleep?: (ms: number) => Promise<void>;
  /** 熔断触发回调。 */
  onTrip?: (reason: string) => void;
}

interface AttemptCounters {
  transportCalls: number;
  usage: LlmUsage;
}

function extractHttpStatus(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const candidate = (err as { status?: unknown }).status;
  return typeof candidate === "number" ? candidate : undefined;
}

/** LlmError 原样透传；带数字 status 的异常按 HTTP 分类；其余默认可恢复。 */
function toLlmError(err: unknown): LlmError {
  if (err instanceof LlmError) return err;
  const status = extractHttpStatus(err);
  if (status !== undefined) {
    return new LlmError(`LLM HTTP ${status} 错误`, classifyHttpFailure(status), status);
  }
  const message = err instanceof Error ? err.message : String(err);
  return new LlmError(`LLM 调用异常：${message}`, "recoverable");
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

type OpenAiContentPart = {
  type: "text";
  text: string;
} | {
  type: "image_url";
  image_url: { url: string };
};

/** OpenAI 消息编码：图片以 data URL 形式附加到最后一条 user 消息上。 */
function buildOpenAiMessages(call: LlmTransportCall): Array<{
  role: LlmMessage["role"];
  content: string | OpenAiContentPart[];
}> {
  let lastUserIndex = -1;
  for (let i = call.messages.length - 1; i >= 0; i -= 1) {
    if (call.messages[i].role === "user") {
      lastUserIndex = i;
      break;
    }
  }
  return call.messages.map((m, i) => {
    if (i === lastUserIndex && call.images.length > 0) {
      const parts: OpenAiContentPart[] = [{ type: "text", text: m.content }];
      for (const img of call.images) {
        parts.push({ type: "image_url", image_url: { url: `data:${img.mimeType};base64,${img.data}` } });
      }
      return { role: m.role, content: parts };
    }
    return { role: m.role, content: m.content };
  });
}

export interface OpenAiTransportOptions {
  apiKey?: string;
  baseURL?: string;
  /** 单次请求超时毫秒数，默认 120000。 */
  timeoutMs?: number;
}

/** 生产默认 transport：OpenAI Chat Completions。SDK 内部重试关闭，重试策略由网关统一负责。 */
export async function createOpenAiTransport(opts: OpenAiTransportOptions = {}): Promise<LlmTransport> {
  const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
  if (apiKey === undefined || apiKey.length === 0) {
    throw new LlmError("缺少 OpenAI API Key：请设置 OPENAI_API_KEY 或显式传入 transport", "unrecoverable");
  }
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({
    apiKey,
    baseURL: opts.baseURL ?? process.env.OPENAI_BASE_URL,
    maxRetries: 0,
  });
  const timeoutMs = opts.timeoutMs ?? 120_000;
  return async (call) => {
    try {
      const body = {
        model: call.model,
        messages: buildOpenAiMessages(call),
        temperature: call.temperature,
        max_tokens: call.maxTokens,
        response_format: call.jsonMode ? { type: "json_object" as const } : undefined,
      } as unknown as Parameters<typeof client.chat.completions.create>[0];
      // 我们从不传 stream，返回必为非流式 ChatCompletion；结构化收窄避免流式联合类型干扰
      const completion = (await client.chat.completions.create(body, { timeout: timeoutMs })) as unknown as {
        choices: Array<{ message?: { content?: string | null } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
      };
      const text = completion.choices[0]?.message?.content ?? "";
      const rawUsage = completion.usage;
      const usage =
        rawUsage !== undefined && rawUsage !== null
          ? { promptTokens: rawUsage.prompt_tokens ?? 0, completionTokens: rawUsage.completion_tokens ?? 0 }
          : undefined;
      return { text, usage };
    } catch (err) {
      throw toLlmError(err);
    }
  };
}

export class LlmGateway {
  private readonly model: string;
  private readonly transportOverride: LlmTransport | undefined;
  private readonly cache: LlmCache | undefined;
  private readonly tokenBudget: number;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly jsonRepairs: number;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly breaker: GatewayBreaker;
  /** 惰性创建的默认 transport；创建失败后清空，下次调用重新尝试。 */
  private lazyTransport: Promise<LlmTransport> | undefined;
  private tokensUsed = 0;
  private probing = false;

  constructor(opts: LlmGatewayOptions) {
    if (opts.model.trim().length === 0) {
      throw new LlmError("model 不能为空", "unrecoverable");
    }
    this.model = opts.model;
    this.transportOverride = opts.transport;
    this.cache = opts.cache;
    this.tokenBudget = Math.max(0, Math.floor(opts.tokenBudget ?? 0));
    this.maxRetries = Math.max(0, Math.floor(opts.maxRetries ?? 2));
    this.baseDelayMs = Math.max(0, opts.baseDelayMs ?? 200);
    this.jsonRepairs = Math.max(0, Math.floor(opts.jsonRepairs ?? 1));
    this.sleepFn = opts.sleep ?? defaultSleep;
    this.breaker = new GatewayBreaker({
      threshold: opts.breakerThreshold ?? 3,
      resetMs: opts.breakerResetMs ?? 30_000,
      onTrip: opts.onTrip,
    });
    if (this.transportOverride !== undefined) {
      this.lazyTransport = Promise.resolve(this.transportOverride);
    }
  }

  getBreakerState(): GatewayCircuitState {
    return this.breaker.getState();
  }

  getTokensUsed(): number {
    return this.tokensUsed;
  }

  /** 未设预算时返回 Infinity。 */
  getRemainingBudget(): number {
    return this.tokenBudget > 0 ? Math.max(0, this.tokenBudget - this.tokensUsed) : Number.POSITIVE_INFINITY;
  }

  resetBreaker(): void {
    this.breaker.reset();
  }

  dispose(): void {
    this.breaker.dispose();
  }

  /** 结构化通道：强制 JSON 输出 + Zod Schema 校验；校验失败按可恢复错误进入重试/回炉。req 传裸消息数组或完整请求对象均可。 */
  async completeStructured<T>(
    lane: "code" | "vision" | "fast",
    req: LlmMessage[] | Omit<LlmRequest, "json" | "schemaName">,
    schema: ZodType<T, ZodTypeDef, unknown>,
  ): Promise<{ data: T; text: string; tokensUsed: number; attempts: number; fromCache: boolean }> {
    const request: LlmRequest = Array.isArray(req)
      ? { messages: req, json: true, schemaName: `structured:${lane}` }
      : { ...req, json: true, schemaName: `structured:${lane}` };
    const result = await this.complete(request);
    if (result.parsed === undefined) {
      throw new LlmError("结构化通道未返回 parsed JSON 结果", "recoverable");
    }
    const validated = schema.safeParse(result.parsed);
    if (!validated.success) {
      const issues = validated.error.issues
        .slice(0, 5)
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ");
      throw new LlmError(`结构化输出未通过 Schema 校验：${issues}`, "recoverable");
    }
    return {
      data: validated.data,
      text: result.text,
      tokensUsed: result.usage.promptTokens + result.usage.completionTokens,
      attempts: result.attempts,
      fromCache: result.fromCache,
    };
  }

  async complete(req: LlmRequest): Promise<LlmResult> {
    if (req.messages.length === 0) {
      throw new LlmError("messages 不能为空", "unrecoverable");
    }
    const jsonMode = req.json === true;
    const cacheKey =
      this.cache !== undefined
        ? computeCacheKey({
            model: this.model,
            messages: req.messages,
            images: req.images,
            temperature: req.temperature ?? 0,
            maxTokens: req.maxTokens,
            jsonMode,
            schemaName: req.schemaName,
          })
        : null;
    if (this.cache !== undefined && cacheKey !== null) {
      const hit = this.cache.get(cacheKey);
      if (hit !== null) {
        // 缓存命中：不消耗预算、不触发熔断计数；熔断期间仍可服务
        return { text: hit.text, parsed: hit.parsed, model: hit.model, usage: hit.usage, fromCache: true, attempts: 0 };
      }
    }
    const isProbe = this.assertBreakerCanPass();
    try {
      const estimate = estimateRequestTokens(req);
      if (this.tokenBudget > 0 && this.tokensUsed + estimate > this.tokenBudget) {
        throw new TokenBudgetExceededError(this.tokensUsed, estimate, this.tokenBudget);
      }
      const transport = await this.resolveTransport();
      const counters: AttemptCounters = { transportCalls: 0, usage: { promptTokens: 0, completionTokens: 0 } };
      let lastError: LlmError | undefined;
      for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
        try {
          const once = await this.attemptOnce(transport, req, jsonMode, counters);
          this.breaker.recordSuccess();
          this.tokensUsed += counters.usage.promptTokens + counters.usage.completionTokens;
          if (this.cache !== undefined && cacheKey !== null) {
            const entry: LlmCacheEntry = {
              text: once.text,
              parsed: once.parsed,
              model: this.model,
              usage: { ...counters.usage },
            };
            this.cache.set(cacheKey, entry);
          }
          return {
            text: once.text,
            parsed: once.parsed,
            model: this.model,
            usage: { ...counters.usage },
            fromCache: false,
            attempts: counters.transportCalls,
          };
        } catch (err) {
          const failure = toLlmError(err);
          this.breaker.recordFailure(failure.message);
          lastError = failure;
          if (failure.kind === "unrecoverable") throw failure; // 立即抛出：不重试、不退避
          if (this.breaker.isTripped()) throw failure; // 已熔断：停止剩余重试，本次失败原因照抛
          if (attempt < this.maxRetries) {
            await this.sleepFn(this.baseDelayMs * 2 ** attempt);
          }
        }
      }
      throw lastError ?? new LlmError("LLM 调用失败：重试耗尽", "recoverable");
    } finally {
      if (isProbe) this.probing = false;
    }
  }

  /** open 直接拒绝；half-open 仅放行一个探测请求，返回是否为本探测。 */
  private assertBreakerCanPass(): boolean {
    const state = this.breaker.getState();
    if (state === "open") {
      throw new LlmError("LLM 网关熔断中（open）：请求被快速失败，等待自动半开探测或手动 resetBreaker()", "recoverable");
    }
    if (state === "half-open") {
      if (this.probing) {
        throw new LlmError("LLM 网关 half-open 探测进行中：并发请求被快速失败", "recoverable");
      }
      this.probing = true;
      return true;
    }
    return false;
  }

  private resolveTransport(): Promise<LlmTransport> {
    if (this.lazyTransport === undefined) {
      this.lazyTransport = createOpenAiTransport().catch((err: unknown) => {
        // 创建失败（如缺 API Key）不缓存拒绝态：下次调用重新尝试
        this.lazyTransport = undefined;
        throw err;
      });
    }
    return this.lazyTransport;
  }

  private async attemptOnce(
    transport: LlmTransport,
    req: LlmRequest,
    jsonMode: boolean,
    counters: AttemptCounters,
  ): Promise<{ text: string; parsed?: unknown }> {
    const temperature = req.temperature ?? 0;
    const images = req.images ?? [];
    const firstText = await this.callTransport(
      transport,
      { model: this.model, messages: req.messages, images, temperature, maxTokens: req.maxTokens, jsonMode },
      counters,
    );
    if (!jsonMode) return { text: firstText };
    const firstParse = tryParseJsonLoose(firstText);
    if (firstParse.ok) return { text: firstText, parsed: firstParse.value };
    // JSON 回炉：坏输出附回上下文 + 修复指令，最多 jsonRepairs 次
    let badText = firstText;
    for (let repairIndex = 0; repairIndex < this.jsonRepairs; repairIndex += 1) {
      const repairedText = await this.callTransport(
        transport,
        {
          model: this.model,
          messages: [...req.messages, { role: "assistant", content: badText }, { role: "user", content: JSON_REPAIR_INSTRUCTION }],
          images,
          temperature,
          maxTokens: req.maxTokens,
          jsonMode: true,
        },
        counters,
      );
      const repairedParse = tryParseJsonLoose(repairedText);
      if (repairedParse.ok) return { text: repairedText, parsed: repairedParse.value };
      badText = repairedText;
    }
    throw new LlmError(`JSON 回炉 ${this.jsonRepairs} 次后仍不是合法 JSON`, "recoverable");
  }

  private async callTransport(
    transport: LlmTransport,
    call: LlmTransportCall,
    counters: AttemptCounters,
  ): Promise<string> {
    counters.transportCalls += 1;
    const res = await transport(call);
    if (res.usage !== undefined) {
      counters.usage.promptTokens += res.usage.promptTokens;
      counters.usage.completionTokens += res.usage.completionTokens;
    }
    return res.text;
  }
}
