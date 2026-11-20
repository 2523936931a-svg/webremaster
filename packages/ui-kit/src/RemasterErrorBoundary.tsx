/**
 * RemasterErrorBoundary —— 重制版容灾保护与降级安全边界（借鉴 Next.js / Sentry / Vite Error Overlay）。
 *
 * 核心设计目标：
 * 1. 杜绝白屏：即使第三方网站的原生 DOM 结构变更或脚本抛出未捕获异常，此边界捕获错误后优雅降级；
 * 2. 现场无损：原网页 DOM 与数据完全保留，提供一键秒切回原版网页能力（Alt+Shift+R）；
 * 3. 开发者友好：结构化收集错误堆栈、页面 URL、时间戳，提供一键复制诊断日志。
 */

import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw, Eye, Copy, Check } from "lucide-react";
import { type OriginManager, getSharedOriginManager } from "@webremaster/bridge";

export interface RemasterErrorBoundaryProps {
  children: ReactNode;
  /** 关联的 OriginManager 实例，用于一键切回原版页面 */
  manager?: OriginManager;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface RemasterErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  copied: boolean;
}

export class RemasterErrorBoundary extends Component<RemasterErrorBoundaryProps, RemasterErrorBoundaryState> {
  constructor(props: RemasterErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      copied: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<RemasterErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    // 控制台输出诊断报告供开发者排查
    if (typeof console !== "undefined" && console.error) {
      console.error("[WebRemaster] 皮肤渲染捕获到未处理异常:", error, errorInfo);
    }
  }

  private handleReset = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null, copied: false });
    this.props.onReset?.();
  };

  private handleSwitchToOriginal = (): void => {
    try {
      const manager = this.props.manager ?? getSharedOriginManager();
      manager.setViewMode("original");
    } catch {
      /* ignore */
    }
  };

  private handleCopyReport = (): void => {
    const report = {
      url: typeof window !== "undefined" ? window.location.href : "unknown",
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
      timestamp: new Date().toISOString(),
      errorName: this.state.error?.name ?? "Error",
      errorMessage: this.state.error?.message ?? "Unknown error",
      componentStack: this.state.errorInfo?.componentStack ?? "",
    };
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(JSON.stringify(report, null, 2)).catch(() => {});
    }
    this.setState({ copied: true });
    setTimeout(() => this.setState({ copied: false }), 2000);
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="min-h-[50vh] flex items-center justify-center p-6 text-center">
        <div className="max-w-lg w-full bg-slate-900 border border-red-500/30 rounded-2xl p-6 shadow-2xl text-slate-100">
          <div className="w-12 h-12 mx-auto rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400 mb-4">
            <AlertTriangle size={24} />
          </div>
          <h2 className="text-xl font-bold mb-2">
            {this.props.fallbackTitle ?? "重制界面触发容灾保护 (Safe Mode)"}
          </h2>
          <p className="text-sm text-slate-400 mb-6">
            原站 DOM 结构或脚本返回了意外数据。为保障您的正常使用，原网页数据已完整保留，您可随时无缝切回原版浏览。
          </p>

          <div className="flex flex-wrap gap-3 justify-center mb-6">
            <button
              type="button"
              onClick={this.handleSwitchToOriginal}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-white font-medium text-sm transition-colors shadow-lg shadow-sky-500/20 cursor-pointer"
            >
              <Eye size={16} />
              切回原版网页 (Alt+Shift+R)
            </button>
            <button
              type="button"
              onClick={this.handleReset}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-medium text-sm transition-colors cursor-pointer"
            >
              <RefreshCw size={16} />
              重试渲染
            </button>
            <button
              type="button"
              onClick={this.handleCopyReport}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-medium text-sm transition-colors cursor-pointer"
            >
              {this.state.copied ? <Check size={16} className="text-emerald-400" /> : <Copy size={16} />}
              {this.state.copied ? "已复制诊断日志" : "复制错误诊断"}
            </button>
          </div>

          {this.state.error && (
            <details className="text-left bg-black/40 rounded-lg p-3 text-xs text-red-300 font-mono overflow-auto max-h-36 border border-white/5">
              <summary className="cursor-pointer text-slate-400 hover:text-slate-200 mb-1 select-none">
                查看错误堆栈细节
              </summary>
              <p className="font-bold">{this.state.error.name}: {this.state.error.message}</p>
              <pre className="mt-1 text-[11px] text-slate-400 whitespace-pre-wrap">
                {this.state.errorInfo?.componentStack || this.state.error.stack}
              </pre>
            </details>
          )}
        </div>
      </div>
    );
  }
}
