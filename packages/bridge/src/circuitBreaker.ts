/**
 * CircuitBreaker —— 零崩溃熔断器。
 *
 * 默认 failureThreshold=1（首次失败即熔断）、resetTimeoutMs=0（永不自动复位，
 * 需手动 reset()）；resetTimeoutMs>0 时 open 态超时进入 half-open 允许重试，
 * half-open 中成功则回 closed 并触发 onReset。
 */
export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  resetTimeoutMs?: number;
  onTrip?: (reason: string) => void;
  onReset?: () => void;
}

export class CircuitBreaker {
  private readonly threshold: number;
  private readonly resetTimeoutMs: number;
  private readonly tripCallback?: (reason: string) => void;
  private readonly resetCallback?: () => void;
  private failures = 0;
  private state: CircuitState = "closed";
  private timer?: ReturnType<typeof setTimeout>;

  constructor(opts: CircuitBreakerOptions = {}) {
    this.threshold = Math.max(1, opts.failureThreshold ?? 1);
    this.resetTimeoutMs = Math.max(0, opts.resetTimeoutMs ?? 0);
    this.tripCallback = opts.onTrip;
    this.resetCallback = opts.onReset;
  }

  getState(): CircuitState {
    return this.state;
  }

  isTripped(): boolean {
    return this.state === "open";
  }

  getFailureCount(): number {
    return this.failures;
  }

  recordSuccess(): void {
    this.failures = 0;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.state !== "closed") {
      this.state = "closed";
      try {
        this.resetCallback?.();
      } catch {
        /* 回调异常不影响状态机 */
      }
    }
  }

  recordFailure(reason = "unknown"): void {
    if (this.state === "open") return; // 已熔断：不再重复计数
    this.failures += 1;
    if (this.failures >= this.threshold) {
      this.state = "open";
      try {
        this.tripCallback?.(reason);
      } catch {
        /* onTrip 异常不影响熔断状态 */
      }
      if (this.resetTimeoutMs > 0) {
        this.timer = setTimeout(() => {
          this.state = "half-open";
        }, this.resetTimeoutMs);
      }
    }
  }

  reset(): void {
    this.failures = 0;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.state = "closed";
  }

  dispose(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
}
