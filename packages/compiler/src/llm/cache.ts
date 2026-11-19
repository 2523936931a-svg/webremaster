/**
 * LlmCache —— SQLite WAL 模式的 LLM 响应缓存（better-sqlite3，同步 API）。
 *
 * - 建库即开启 WAL（journal_mode=wal）+ synchronous=NORMAL + busy_timeout；
 * - 缓存 key 由请求语义决定：消息内容、图片内容 sha256（原图不进库、不进 key）、
 *   temperature、maxTokens、jsonMode、schemaName、model（可选）统一进入规范化
 *   JSON 后做 sha256，格式为 `llmc-v1-<64位hex>`；
 * - 条目损坏（JSON 解析失败 / 字段缺失）按未命中处理并删除该行；
 * - ttlMs > 0 时过期条目视为未命中并删除，0 表示永不过期；
 * - 缓存命中只增加 hits 计数，不产生任何 Token 消耗。
 */
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

export type LlmRole = "system" | "user" | "assistant";

export interface LlmMessage {
  role: LlmRole;
  content: string;
}

/** 图片输入：data 为 base64 编码内容（不带 data: 前缀）。 */
export interface LlmImage {
  data: string;
  mimeType: string;
}

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface LlmCacheEntry {
  text: string;
  /** 仅当请求期望 JSON 输出时存在；可能为 null（模型字面输出 null）。 */
  parsed?: unknown;
  model: string;
  usage: LlmUsage;
}

export interface CacheKeyMaterial {
  /** 命名空间前缀，用于同一库内区分不同业务管道。 */
  prefix?: string;
  /** 是否把模型名纳入 key（网关默认纳入；跨模型共享缓存时不传）。 */
  model?: string;
  messages: readonly LlmMessage[];
  images?: readonly LlmImage[];
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  schemaName?: string;
}

export interface LlmCacheOptions {
  /** SQLite 文件路径；支持 ":memory:"。 */
  path: string;
  /** 条目存活毫秒数，0 = 永不过期。默认 0。 */
  ttlMs?: number;
  /** SQLite busy_timeout 毫秒数。默认 5000。 */
  busyTimeoutMs?: number;
}

const CACHE_KEY_VERSION = 1;

export function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

/** 图片内容的 sha256：解码 base64 后对原始字节做哈希，与编码细节无关。 */
export function imageSha256(image: LlmImage): string {
  const bytes = Buffer.from(image.data, "base64");
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * 计算缓存 key：所有影响输出的请求语义进入规范化 JSON（键序固定、可复现），
 * 再做 sha256。原图数据只以摘要形式参与，key 长度恒定且不泄漏图片内容。
 */
export function computeCacheKey(material: CacheKeyMaterial): string {
  const canonical = {
    v: CACHE_KEY_VERSION,
    prefix: material.prefix ?? "",
    model: material.model ?? "",
    jsonMode: material.jsonMode === true,
    schemaName: material.schemaName ?? "",
    temperature: typeof material.temperature === "number" ? material.temperature : null,
    maxTokens: typeof material.maxTokens === "number" ? material.maxTokens : null,
    messages: material.messages.map((m) => ({ role: m.role, content: m.content })),
    images: (material.images ?? []).map((img) => ({ mime: img.mimeType, sha256: imageSha256(img) })),
  };
  return `llmc-v${CACHE_KEY_VERSION}-${sha256Hex(JSON.stringify(canonical))}`;
}

interface CacheGetRow {
  response: string;
  created_at: number;
}

interface CacheStatsRow {
  entries: number;
  total_hits: number;
}

function toUsage(raw: unknown): LlmUsage {
  if (typeof raw === "object" && raw !== null) {
    const record = raw as Record<string, unknown>;
    return {
      promptTokens: typeof record.promptTokens === "number" ? record.promptTokens : 0,
      completionTokens: typeof record.completionTokens === "number" ? record.completionTokens : 0,
    };
  }
  return { promptTokens: 0, completionTokens: 0 };
}

export class LlmCache {
  private readonly db: Database.Database;
  private readonly ttlMs: number;
  private readonly stmtGet: Database.Statement;
  private readonly stmtSet: Database.Statement;
  private readonly stmtTouch: Database.Statement;
  private readonly stmtDelete: Database.Statement;
  private readonly stmtClear: Database.Statement;
  private readonly stmtStats: Database.Statement;

  constructor(opts: LlmCacheOptions) {
    this.ttlMs = Math.max(0, Math.floor(opts.ttlMs ?? 0));
    if (opts.path !== ":memory:") {
      mkdirSync(dirname(opts.path), { recursive: true });
    }
    this.db = new Database(opts.path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma(`busy_timeout = ${Math.max(0, Math.floor(opts.busyTimeoutMs ?? 5000))}`);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS llm_cache (
        key TEXT PRIMARY KEY,
        response TEXT NOT NULL,
        model TEXT NOT NULL,
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        hits INTEGER NOT NULL DEFAULT 0
      )
    `);
    this.stmtGet = this.db.prepare("SELECT response, created_at FROM llm_cache WHERE key = ?");
    this.stmtSet = this.db.prepare(`
      INSERT INTO llm_cache (key, response, model, prompt_tokens, completion_tokens, created_at, hits)
      VALUES (?, ?, ?, ?, ?, ?, 0)
      ON CONFLICT(key) DO UPDATE SET
        response = excluded.response,
        model = excluded.model,
        prompt_tokens = excluded.prompt_tokens,
        completion_tokens = excluded.completion_tokens,
        created_at = excluded.created_at,
        hits = 0
    `);
    this.stmtTouch = this.db.prepare("UPDATE llm_cache SET hits = hits + 1 WHERE key = ?");
    this.stmtDelete = this.db.prepare("DELETE FROM llm_cache WHERE key = ?");
    this.stmtClear = this.db.prepare("DELETE FROM llm_cache");
    this.stmtStats = this.db.prepare("SELECT COUNT(*) AS entries, COALESCE(SUM(hits), 0) AS total_hits FROM llm_cache");
  }

  /** 读取当前日志模式；文件库应返回 "wal"。 */
  getJournalMode(): string {
    return this.db.pragma("journal_mode", { simple: true }) as string;
  }

  /** 命中则返回条目并累加 hits；过期/损坏条目按未命中处理并删除。 */
  get(key: string): LlmCacheEntry | null {
    const row = this.stmtGet.get(key) as CacheGetRow | undefined;
    if (row === undefined) return null;
    if (this.ttlMs > 0 && Date.now() - row.created_at > this.ttlMs) {
      this.stmtDelete.run(key);
      return null;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(row.response) as unknown;
    } catch {
      this.stmtDelete.run(key);
      return null;
    }
    if (typeof payload !== "object" || payload === null) {
      this.stmtDelete.run(key);
      return null;
    }
    const record = payload as Record<string, unknown>;
    if (typeof record.text !== "string" || typeof record.model !== "string") {
      this.stmtDelete.run(key);
      return null;
    }
    this.stmtTouch.run(key);
    const entry: LlmCacheEntry = {
      text: record.text,
      model: record.model,
      usage: toUsage(record.usage),
    };
    if (record.parsed !== undefined) entry.parsed = record.parsed;
    return entry;
  }

  /** 写入/覆盖条目（UPSERT，覆盖后 hits 归零）。 */
  set(key: string, entry: LlmCacheEntry): void {
    const payload = JSON.stringify({
      text: entry.text,
      parsed: entry.parsed,
      model: entry.model,
      usage: entry.usage,
    });
    this.stmtSet.run(key, payload, entry.model, entry.usage.promptTokens, entry.usage.completionTokens, Date.now());
  }

  delete(key: string): void {
    this.stmtDelete.run(key);
  }

  clear(): void {
    this.stmtClear.run();
  }

  stats(): { entries: number; totalHits: number } {
    const row = this.stmtStats.get() as CacheStatsRow | undefined;
    if (row === undefined) return { entries: 0, totalHits: 0 };
    return { entries: Number(row.entries), totalHits: Number(row.total_hits) };
  }

  /** 关闭前做一次 WAL checkpoint（其他连接占用时静默忽略），再关闭连接。 */
  close(): void {
    try {
      this.db.pragma("wal_checkpoint(TRUNCATE)");
    } catch {
      /* 并发连接占用 WAL 时 checkpoint 可能失败，忽略后直接关闭 */
    }
    this.db.close();
  }
}
