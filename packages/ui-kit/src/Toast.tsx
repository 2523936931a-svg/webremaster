/**
 * Toast 通知系统 —— 运行在 Shadow DOM 内部的高级微交互浮动气泡（借鉴 Sonner / Linear 设计风格）。
 *
 * 特性：
 * 1. 物理隔离：完全渲染在当前 Shadow Root 或应用根节点内，绝不向 document.body 泄露；
 * 2. 堆叠动效：自下而上滑入，支持 success / info / warning / error 四种状态；
 * 3. 自动定时清理 + 交互式单条关闭。
 */

import React, { createContext, useContext, useState, useCallback, type ReactNode, type ReactElement } from "react";
import { CheckCircle2, Info, AlertTriangle, XCircle, X } from "lucide-react";

export type ToastType = "success" | "info" | "warning" | "error";

export interface ToastMessage {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

export interface ToastContextValue {
  show: (message: string, type?: ToastType, duration?: number) => void;
  success: (message: string, duration?: number) => void;
  info: (message: string, duration?: number) => void;
  warning: (message: string, duration?: number) => void;
  error: (message: string, duration?: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider(props: { children: ReactNode }): ReactElement {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (message: string, type: ToastType = "info", duration = 3000) => {
      const id = "toast_" + Math.random().toString(36).slice(2, 9);
      const toast: ToastMessage = { id, type, message, duration };
      setToasts((current) => [...current.slice(-4), toast]); // 最多保持 5 条

      if (duration > 0 && typeof setTimeout !== "undefined") {
        setTimeout(() => {
          removeToast(id);
        }, duration);
      }
    },
    [removeToast],
  );

  const success = useCallback((msg: string, dur?: number) => show(msg, "success", dur), [show]);
  const info = useCallback((msg: string, dur?: number) => show(msg, "info", dur), [show]);
  const warning = useCallback((msg: string, dur?: number) => show(msg, "warning", dur), [show]);
  const error = useCallback((msg: string, dur?: number) => show(msg, "error", dur), [show]);

  return (
    <ToastContext.Provider value={{ show, success, info, warning, error }}>
      {props.children}
      <div
        className="fixed bottom-6 right-6 z-[2147483647] flex flex-col gap-2 pointer-events-none max-w-sm w-full"
        aria-live="polite"
      >
        {toasts.map((t) => {
          const icon =
            t.type === "success" ? (
              <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
            ) : t.type === "error" ? (
              <XCircle size={16} className="text-red-400 shrink-0" />
            ) : t.type === "warning" ? (
              <AlertTriangle size={16} className="text-amber-400 shrink-0" />
            ) : (
              <Info size={16} className="text-sky-400 shrink-0" />
            );

          return (
            <div
              key={t.id}
              className="pointer-events-auto flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-slate-900/95 border border-white/10 text-slate-100 shadow-xl backdrop-blur-md text-sm transition-all"
            >
              <div className="flex items-center gap-2.5">
                {icon}
                <span className="font-medium">{t.message}</span>
              </div>
              <button
                type="button"
                onClick={() => removeToast(t.id)}
                className="text-slate-400 hover:text-slate-200 p-0.5 rounded cursor-pointer transition-colors"
                aria-label="关闭提示"
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // 允许在 Provider 外调用安全空操作回退，保证零报错
    return {
      show: () => {},
      success: () => {},
      info: () => {},
      warning: () => {},
      error: () => {},
    };
  }
  return ctx;
}
