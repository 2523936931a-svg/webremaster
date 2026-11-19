/**
 * ReactiveStore —— 原站响应式同步 + 熔断联动。
 *
 * observeAllFrames 监听原站（含同源 iframe）变化，debounce 节流重新提取；
 * extract 抛错或 validate 返回 false（空数据）时经 CircuitBreaker 熔断：
 * 自动切回 original 模式 + 温和 Toast 提示，保证永不白屏；熔断后不再提取。
 */
import { observeAllFrames } from "./iframeBridge.js";
import { getSharedOriginManager } from "./originManager.js";
import { CircuitBreaker } from "./circuitBreaker.js";

export interface CreateOriginStoreOptions<T> {
  originRoot: HTMLElement;
  extract: (originRoot: HTMLElement) => T;
  validate?: (snapshot: T) => boolean;
  debounceMs?: number;
  onTripCircuit?: (reason: string, error?: unknown) => void;
}

export interface OriginStore<T> {
  getSnapshot(): T | null;
  subscribe(listener: () => void): () => void;
  refresh(): T | null;
  dispose(): void;
}

const defaultValidate = <T>(snapshot: T): boolean =>
  snapshot !== null && snapshot !== undefined && (!Array.isArray(snapshot) || snapshot.length > 0);

export function createOriginStore<T>(opts: CreateOriginStoreOptions<T>): OriginStore<T> {
  let snapshot: T | null = null;
  let lastError: unknown;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  const debounceMs = Math.max(0, opts.debounceMs ?? 150);

  const emit = (): void => {
    for (const listener of Array.from(listeners)) {
      try {
        listener();
      } catch {
        /* 单个订阅者异常不阻断其余通知 */
      }
    }
  };

  const breaker = new CircuitBreaker({
    failureThreshold: 1, // 首次失败即熔断
    onTrip: (reason: string) => {
      const manager = getSharedOriginManager();
      try {
        manager.setViewMode("original");
        manager.showFallbackToast(`已自动切回原版界面：${reason}`);
      } catch {
        /* 管理器不可用时仍要回调上层 */
      }
      try {
        opts.onTripCircuit?.(reason, lastError);
      } catch {
        /* 上层回调异常忽略 */
      }
    },
  });

  const runExtract = (): { ok: boolean; value?: T; reason?: string } => {
    try {
      const value = opts.extract(opts.originRoot);
      const validate = opts.validate ?? defaultValidate;
      if (!validate(value)) {
        return { ok: false, reason: "提取结果校验未通过（空数据）" };
      }
      return { ok: true, value };
    } catch (error) {
      lastError = error;
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
  };

  const refresh = (): T | null => {
    if (breaker.isTripped()) return snapshot; // 熔断后不再提取，永不白屏
    const result = runExtract();
    if (result.ok && result.value !== undefined) {
      breaker.recordSuccess();
      snapshot = result.value;
      emit();
    } else {
      breaker.recordFailure(result.reason ?? "unknown");
    }
    return snapshot;
  };

  const scheduleRefresh = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      refresh();
    }, debounceMs);
  };

  const unobserve = observeAllFrames(opts.originRoot, scheduleRefresh);
  refresh(); // 创建时立即同步提取一次

  return {
    getSnapshot(): T | null {
      return snapshot;
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh,
    dispose(): void {
      unobserve();
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      listeners.clear();
      breaker.dispose();
    },
  };
}
