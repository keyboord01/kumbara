"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

export type ToastVariant = "info" | "success" | "warning" | "error";

export interface ToastInput {
  title: string;
  body?: string;
  variant?: ToastVariant;
  /** Milliseconds before it leaves on its own; errors stay longer. 0 keeps it until dismissed. */
  duration?: number;
  /** Replaces a toast with the same key instead of stacking (progress updates). */
  key?: string;
}

interface Toast extends ToastInput {
  id: number;
  variant: ToastVariant;
}

interface ToastApi {
  toast: (input: ToastInput) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** At most this many on screen; the oldest leaves first. */
const MAX_VISIBLE = 3;
const DEFAULT_MS: Record<ToastVariant, number> = { info: 4000, success: 4000, warning: 6000, error: 8000 };

const STYLE: Record<ToastVariant, { bar: string; icon: string }> = {
  info: { bar: "bg-teal", icon: "i" },
  success: { bar: "bg-mint", icon: "✓" },
  warning: { bar: "bg-amber", icon: "!" },
  error: { bar: "bg-danger", icon: "×" },
};

/**
 * Transient, non-blocking notices: copied, bank played, anchor switched,
 * reconnected, done. Each toast is its own polite live region, so screen
 * readers announce it once; taps dismiss; the stack never exceeds three.
 * Anything that needs a decision or an explanation stays a FailureScreen.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const toast = useCallback(
    (input: ToastInput) => {
      const variant = input.variant ?? "info";
      const id = nextId.current++;
      const duration = input.duration ?? DEFAULT_MS[variant];
      setToasts((list) => {
        const kept = input.key ? list.filter((t) => t.key !== input.key) : list;
        const next = [...kept, { ...input, id, variant }];
        return next.slice(-MAX_VISIBLE);
      });
      if (duration > 0) timers.current.set(id, setTimeout(() => dismiss(id), duration));
    },
    [dismiss],
  );

  useEffect(() => {
    const active = timers.current;
    return () => {
      for (const timer of active.values()) clearTimeout(timer);
      active.clear();
    };
  }, []);

  const api = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+4rem)] z-30 flex flex-col items-center gap-2 px-4" data-testid="toaster">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            aria-live="polite"
            data-testid="toast"
            data-variant={t.variant}
            className="toast-in card-flat pointer-events-auto flex w-full max-w-xl items-start gap-3 overflow-hidden p-3 pr-2 shadow-[var(--shadow-toast)]"
          >
            <span className={`mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full text-[11px] font-bold text-white ${STYLE[t.variant].bar}`} aria-hidden>
              {STYLE[t.variant].icon}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-5 text-ink">{t.title}</p>
              {t.body ? <p className="mt-0.5 text-xs leading-4 text-ink-2">{t.body}</p> : null}
            </div>
            <button type="button" onClick={() => dismiss(t.id)} className="flex h-8 w-8 flex-none items-center justify-center rounded-full text-muted hover:bg-paper-2 hover:text-ink" aria-label="Kapat">
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast needs a ToastProvider");
  return api;
}
