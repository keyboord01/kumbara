"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n";

export interface StepperStep {
  key: string;
  label: string;
  /** Who does this step: the server and the booth driver, or the user's passkey. The outcome step has no owner. */
  owner?: "us" | "you" | undefined;
  state: "done" | "current" | "idle" | "failed";
  /** ISO time the current step started, for the elapsed counter. */
  since?: string | undefined;
  /** Typical wall-clock seconds for this step, from measured round trips; shown as "usually about N s". */
  typicalSeconds?: number | undefined;
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

/**
 * A vertical stepper with a rail: done steps are ticked, the current one
 * breathes and shows how long it has been running against how long it
 * usually takes, later steps are quiet. Each step carries who does it.
 */
export function Stepper({ steps, testId }: { steps: StepperStep[]; testId?: string }) {
  const { t } = useLocale();
  const current = steps.find((s) => s.state === "current");
  const now = useNow(Boolean(current));
  const doneCount = steps.filter((s) => s.state === "done").length;
  const progress = steps.length > 1 ? (doneCount + (current ? 0.5 : 0)) / steps.length : 0;
  return (
    <div data-testid={testId}>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-paper-2" aria-hidden>
        <div className="h-full rounded-full bg-teal transition-[width] duration-700 ease-out" style={{ width: `${Math.max(4, Math.round(progress * 100))}%` }} />
      </div>
      <ol className="mt-4 flex flex-col">
        {steps.map((s, i) => {
          const last = i === steps.length - 1;
          const elapsed = s.state === "current" && s.since ? Math.max(0, Math.round((now - Date.parse(s.since)) / 1000)) : null;
          return (
            <li key={s.key} className="relative flex gap-3 pb-4 last:pb-0" data-step={s.key} data-state={s.state}>
              {!last ? <span className={`absolute left-[11px] top-6 h-[calc(100%-1.25rem)] w-0.5 ${s.state === "done" ? "bg-mint" : "bg-line"}`} aria-hidden /> : null}
              <span
                className={`relative z-[1] mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full text-[11px] font-bold ${
                  s.state === "done" ? "bg-mint text-white" : s.state === "current" ? "step-current bg-coral text-white" : s.state === "failed" ? "bg-danger text-white" : "border border-line-2 bg-white text-muted"
                }`}
                aria-hidden
              >
                {s.state === "done" ? "✓" : s.state === "failed" ? "!" : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className={`text-sm leading-6 ${s.state === "current" ? "font-semibold text-ink" : s.state === "done" ? "text-ink-2" : "text-muted"}`}>{s.label}</p>
                  {s.owner ? <span className={`chip ${s.owner === "you" ? "bg-amber/15 text-amber" : "bg-paper-2 text-muted"}`}>{s.owner === "you" ? t.stepper.you : t.stepper.us}</span> : null}
                </div>
                {s.state === "current" && (elapsed !== null || s.typicalSeconds) ? (
                  <p className="tnum mt-0.5 flex items-center gap-2 text-xs text-muted" data-testid="step-timing">
                    {elapsed !== null ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="spinner h-3 w-3 text-teal" aria-hidden />
                        {t.stepper.elapsed.replace("{s}", String(elapsed))}
                      </span>
                    ) : null}
                    {s.typicalSeconds ? <span>· {t.stepper.typical.replace("{s}", String(s.typicalSeconds))}</span> : null}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
