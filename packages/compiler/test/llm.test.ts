import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { computeCacheKey, LlmCache, type LlmImage, type LlmMessage } from "../src/llm/cache.js";
import {
  classifyHttpFailure,
  estimateRequestTokens,
  JSON_REPAIR_INSTRUCTION,
  LlmError,
  LlmGateway,
  TokenBudgetExceededError,
  tryParseJsonLoose,
  type LlmTransportCall,
  type LlmTransportResult,
} from "../src/llm/gateway.js";

const openCaches: LlmCache[] = [];
const createdDirs: string[] = [];

function makeFileCache(ttlMs = 0): LlmCache {
  const dir = mkdtempSync(join(tmpdir(), "wr-llm-cache-"));
  createdDirs.push(dir);
  const cache = new LlmCache({ path: join(dir, "cache.db"), ttlMs });
  openCaches.push(cache);
  return cache;
}

afterEach(() => {
  for (const cache of openCaches.splice(0)) {
    cache.close();
  }
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function userMsg(content: string): LlmMessage {
  return { role: "user", content };
}

describe("LlmCache（SQLite WAL）", () => {
  it("缓存命中：set 后 get 返回同值（含 parsed）并累加 hits，stats/delete/clear 生效", () => {
    const cache = makeFileCache();
    expect(cache.getJournalMode()).toBe("wal");

    const key = computeCacheKey({ messages: [userMsg("hello")] });
    expect(cache.get(key)).toBeNull();

    cache.set(key, {
      text: '{"a":1}',
      parsed: { a: 1 },
      model: "mock-model",
      usage: { promptTokens: 7, completionTokens: 3 },
    });

    const first = cache.get(key);
    expect(first).not.toBeNull();
    expect(first?.text).toBe('{"a":1}');
    expect(first?.parsed).toEqual({ a: 1 });
    expect(first?.model).toBe("mock-model");
    expect(first?.usage).toEqual({ promptTokens: 7, completionTokens: 3 });

    const second = cache.get(key);
    expect(second?.parsed).toEqual({ a: 1 });

    const stats = cache.stats();
    expect(stats.entries).toBe(1);
    expect(stats.totalHits).toBe(2);

    cache.delete(key);
    expect(cache.get(key)).toBeNull();

    cache.set(key, { text: "x", model: "m", usage: { promptTokens: 0, completionTokens: 0 } });
    cache.clear();
    expect(cache.stats()).toEqual({ entries: 0, totalHits: 0 });
  });

  it("TTL 过期后视为未命中并删除条目", async () => {
    const cache = makeFileCache(30);
    const key = computeCacheKey({ messages: [userMsg("ttl")] });
    cache.set(key, { text: "v", model: "m", usage: { promptTokens: 0, completionTokens: 0 } });
    expect(cache.get(key)).not.toBeNull();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 60);
    });
    expect(cache.get(key)).toBeNull();
    expect(cache.stats().entries).toBe(0);
  });

  it("图片 sha256 key：同图同 key、异图异 key，key 不泄漏原图且长度恒定", () => {
    const imgA: LlmImage = { data: Buffer.from("png-bytes-one").toString("base64"), mimeType: "image/png" };
    const imgB: LlmImage = { data: Buffer.from("png-bytes-two").toString("base64"), mimeType: "image/png" };
    const messages = [userMsg("看图作答")];

    const keyA1 = computeCacheKey({ messages, images: [imgA] });
    const keyA2 = computeCacheKey({ messages, images: [{ ...imgA }] });
    const keyB = computeCacheKey({ messages, images: [imgB] });
    const keyNoImg = computeCacheKey({ messages });
    const keyMime = computeCacheKey({ messages, images: [{ data: imgA.data, mimeType: "image/jpeg" }] });

    expect(keyA1).toMatch(/^llmc-v1-[0-9a-f]{64}$/);
    expect(keyA2).toBe(keyA1); // 同一图片内容 → key 稳定
    expect(keyB).not.toBe(keyA1); // 不同图片字节 → 不同 key
    expect(keyNoImg).not.toBe(keyA1);
    expect(keyMime).not.toBe(keyA1); // mimeType 参与语义
    expect(keyA1).not.toContain(imgA.data); // 原图 base64 不进入 key
    expect(keyB.length).toBe(keyA1.length);
  });
});

describe("LlmGateway", () => {
  it("缓存命中：同一请求第二次直接读缓存，不再调用 transport、不消耗 Token 预算", async () => {
    const cache = makeFileCache();
    const transport = vi.fn(async (_call: LlmTransportCall): Promise<LlmTransportResult> => ({
      text: '{"ok":true}',
      usage: { promptTokens: 7, completionTokens: 3 },
    }));
    const gateway = new LlmGateway({ model: "mock-model", transport, cache, tokenBudget: 1000 });
    const req = { messages: [userMsg("生成皮肤 JSON")], json: true };

    const first = await gateway.complete(req);
    expect(first.fromCache).toBe(false);
    expect(first.parsed).toEqual({ ok: true });
    expect(first.attempts).toBe(1);
    expect(first.model).toBe("mock-model");
    expect(transport).toHaveBeenCalledTimes(1);
    expect(gateway.getTokensUsed()).toBe(10);

    const second = await gateway.complete(req);
    expect(second.fromCache).toBe(true);
    expect(second.parsed).toEqual({ ok: true });
    expect(second.attempts).toBe(0);
    expect(second.usage).toEqual({ promptTokens: 7, completionTokens: 3 });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(gateway.getTokensUsed()).toBe(10); // 缓存命中不消耗预算

    const third = await gateway.complete({ ...req, messages: [userMsg("另一条请求")] });
    expect(third.fromCache).toBe(false);
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("JSON 回炉：非法输出附回上下文重修，修复结果与累计用量写入缓存", async () => {
    const cache = makeFileCache();
    const transport = vi.fn(async (call: LlmTransportCall): Promise<LlmTransportResult> => {
      const isRepair = call.messages.some((m) => m.role === "user" && m.content === JSON_REPAIR_INSTRUCTION);
      if (isRepair) return { text: '{"a": 1}', usage: { promptTokens: 10, completionTokens: 5 } };
      return { text: '好的，这是结果：{bad json', usage: { promptTokens: 10, completionTokens: 5 } };
    });
    const gateway = new LlmGateway({ model: "mock-model", transport, cache, breakerThreshold: 10 });
    const req = { messages: [userMsg('输出 {"a":1} 形式的 JSON')], json: true };

    const result = await gateway.complete(req);
    expect(result.parsed).toEqual({ a: 1 });
    expect(result.attempts).toBe(2);
    expect(result.usage).toEqual({ promptTokens: 20, completionTokens: 10 });
    expect(transport).toHaveBeenCalledTimes(2);

    const repairCall = transport.mock.calls[1]?.[0] as LlmTransportCall | undefined;
    expect(repairCall?.messages.at(-1)?.content).toBe(JSON_REPAIR_INSTRUCTION);
    expect(repairCall?.messages.at(-2)?.role).toBe("assistant");
    expect(repairCall?.messages.at(-2)?.content).toContain("{bad json");

    const second = await gateway.complete(req);
    expect(second.fromCache).toBe(true);
    expect(second.parsed).toEqual({ a: 1 });
    expect(transport).toHaveBeenCalledTimes(2); // 缓存命中，不再调用

    expect(tryParseJsonLoose('```json\n{"a":1}\n```')).toEqual({ ok: true, value: { a: 1 } });
    expect(tryParseJsonLoose("not json")).toEqual({ ok: false });
  });

  it("Token 预算：超过预算在调用前快速失败，不触发 transport", async () => {
    const usages = [
      { promptTokens: 100, completionTokens: 50 },
      { promptTokens: 150, completionTokens: 100 },
    ];
    let callIndex = 0;
    const transport = vi.fn(async (): Promise<LlmTransportResult> => {
      const usage = usages[callIndex] ?? { promptTokens: 0, completionTokens: 0 };
      callIndex += 1;
      return { text: "ok", usage };
    });
    // estimateRequestTokens([userMsg("hi")]) = ceil(2/4) + 4 = 5，与预算闸同源
    expect(estimateRequestTokens({ messages: [userMsg("hi")] })).toBe(5);
    const gateway = new LlmGateway({ model: "mock-model", transport, tokenBudget: 300, maxRetries: 0 });
    const req = { messages: [userMsg("hi")] };

    await gateway.complete(req);
    expect(gateway.getTokensUsed()).toBe(150);

    await gateway.complete(req);
    expect(gateway.getTokensUsed()).toBe(400);

    const caught: unknown = await gateway.complete(req).catch((e: unknown) => e);
    expect(caught).toBeInstanceOf(TokenBudgetExceededError);
    if (caught instanceof TokenBudgetExceededError) {
      expect(caught.used).toBe(400);
      expect(caught.estimate).toBe(5);
      expect(caught.budget).toBe(300);
    }
    expect(transport).toHaveBeenCalledTimes(2); // 第 3 次在调用前被拦截
    expect(gateway.getRemainingBudget()).toBe(0);
  });

  it("指数退避：可恢复错误按 base * 2^n 重试直至成功", async () => {
    let calls = 0;
    const transport = vi.fn(async (): Promise<LlmTransportResult> => {
      calls += 1;
      if (calls <= 2) throw new LlmError(`rate limit #${calls}`, "recoverable", 429);
      return { text: "pong", usage: { promptTokens: 1, completionTokens: 1 } };
    });
    const delays: number[] = [];
    const gateway = new LlmGateway({
      model: "mock-model",
      transport,
      maxRetries: 2,
      baseDelayMs: 50,
      breakerThreshold: 100,
      breakerResetMs: 0,
      sleep: async (ms: number) => {
        delays.push(ms);
      },
    });

    const result = await gateway.complete({ messages: [userMsg("ping")] });
    expect(result.text).toBe("pong");
    expect(result.attempts).toBe(3);
    expect(delays).toEqual([50, 100]); // 50 * 2^0, 50 * 2^1
    expect(transport).toHaveBeenCalledTimes(3);
    expect(gateway.getBreakerState()).toBe("closed");
  });

  it("不可恢复错误：立即抛出，不重试、不退避；裸异常默认按可恢复处理", async () => {
    const boom = new LlmError("invalid_api_key", "unrecoverable", 401);
    const transport = vi.fn(async (): Promise<LlmTransportResult> => {
      throw boom;
    });
    const delays: number[] = [];
    const gateway = new LlmGateway({
      model: "mock-model",
      transport,
      maxRetries: 3,
      baseDelayMs: 5000,
      breakerThreshold: 10,
      breakerResetMs: 0,
      sleep: async (ms: number) => {
        delays.push(ms);
      },
    });

    const caught: unknown = await gateway.complete({ messages: [userMsg("x")] }).catch((e: unknown) => e);
    expect(caught).toBe(boom);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);

    expect(classifyHttpFailure(400)).toBe("unrecoverable");
    expect(classifyHttpFailure(401)).toBe("unrecoverable");
    expect(classifyHttpFailure(403)).toBe("unrecoverable");
    expect(classifyHttpFailure(404)).toBe("unrecoverable");
    expect(classifyHttpFailure(413)).toBe("unrecoverable");
    expect(classifyHttpFailure(422)).toBe("unrecoverable");
    expect(classifyHttpFailure(429)).toBe("recoverable");
    expect(classifyHttpFailure(500)).toBe("recoverable");
    expect(classifyHttpFailure(503)).toBe("recoverable");

    // 非 LlmError 的裸异常（如网络层 TypeError）无 status，默认可恢复 → 重试一次后成功
    let rawCalls = 0;
    const rawTransport = vi.fn(async (): Promise<LlmTransportResult> => {
      rawCalls += 1;
      if (rawCalls === 1) throw new TypeError("fetch failed");
      return { text: "ok" };
    });
    const rawDelays: number[] = [];
    const rawGateway = new LlmGateway({
      model: "mock-model",
      transport: rawTransport,
      maxRetries: 1,
      baseDelayMs: 10,
      breakerThreshold: 10,
      sleep: async (ms: number) => {
        rawDelays.push(ms);
      },
    });
    const recovered = await rawGateway.complete({ messages: [userMsg("x")] });
    expect(recovered.text).toBe("ok");
    expect(recovered.attempts).toBe(2);
    expect(rawDelays).toEqual([10]);
    expect(rawTransport).toHaveBeenCalledTimes(2);
  });

  it("三档熔断：closed → open 快速失败 → half-open 探测 → closed 恢复", async () => {
    let shouldFail = true;
    const transport = vi.fn(async (): Promise<LlmTransportResult> => {
      if (shouldFail) throw new LlmError("upstream 503", "recoverable", 503);
      return { text: "ok" };
    });
    const onTrip = vi.fn();
    const gateway = new LlmGateway({
      model: "mock-model",
      transport,
      maxRetries: 0,
      breakerThreshold: 2,
      breakerResetMs: 40,
      onTrip,
    });
    const req = { messages: [userMsg("r")] };

    await expect(gateway.complete(req)).rejects.toBeInstanceOf(LlmError);
    expect(gateway.getBreakerState()).toBe("closed"); // 1 次失败未达阈值

    await expect(gateway.complete(req)).rejects.toBeInstanceOf(LlmError);
    expect(gateway.getBreakerState()).toBe("open");
    expect(onTrip).toHaveBeenCalledTimes(1);

    // open：快速失败，transport 不再被调用
    await expect(gateway.complete(req)).rejects.toThrowError(/熔断/);
    expect(transport).toHaveBeenCalledTimes(2);

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 60);
    });
    expect(gateway.getBreakerState()).toBe("half-open");

    // half-open：探测成功 → closed
    shouldFail = false;
    const ok = await gateway.complete(req);
    expect(ok.text).toBe("ok");
    expect(gateway.getBreakerState()).toBe("closed");
    expect(transport).toHaveBeenCalledTimes(3);
    gateway.dispose();
  });
});
