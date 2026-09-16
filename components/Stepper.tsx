"use client";

import { useEffect, useState } from "react";
import { cn } from "cn";
import { Spinner } from "@/components/Spinner";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
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
      <Progress value={Math.max(4, Math.round(progress * 100))} aria-label={current?.label ?? steps[steps.length - 1]?.label} className="gap-0 [&_[data-slot=progress-indicator]]:rounded-full [&_[data-slot=progress-indicator]]:bg-teal [&_[data-slot=progress-indicator]]:duration-700 [&_[data-slot=progress-track]]:h-1.5" />
      <ol className="mt-4 flex flex-col">
        {steps.map((s, i) => {
          const last = i === steps.length - 1;
          const elapsed = s.state === "current" && s.since ? Math.max(0, Math.round((now - Date.parse(s.since)) / 1000)) : null;
          return (
            <li key={s.key} className="relative flex gap-3 pb-4 last:pb-0" data-step={s.key} data-state={s.state}>
              {!last ? <span className={cn("absolute top-6 left-[11px] h-[calc(100%-1.25rem)] w-0.5", s.state === "done" ? "bg-mint" : "bg-border")} aria-hidden /> : null}
              <span
                className={cn(
                  "relative z-[1] mt-0.5 flex size-6 flex-none items-center justify-center rounded-full text-[11px] font-bold",
                  s.state === "done" && "bg-mint text-white",
                  s.state === "current" && "step-current bg-primary text-primary-foreground",
                  s.state === "failed" && "bg-destructive text-white",
                  s.state === "idle" && "border border-input bg-card text-muted-foreground",
                )}
                aria-hidden
              >
                {s.state === "done" ? "✓" : s.state === "failed" ? "!" : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className={cn("text-sm leading-6", s.state === "current" ? "font-semibold text-foreground" : s.state === "done" ? "text-ink-2" : "text-muted-foreground")}>{s.label}</p>
                  {s.owner ? <Badge variant={s.owner === "you" ? "warning" : "secondary"}>{s.owner === "you" ? t.stepper.you : t.stepper.us}</Badge> : null}
                </div>
                {s.state === "current" && (elapsed !== null || s.typicalSeconds) ? (
                  <p className="tnum mt-0.5 flex items-center gap-2 text-xs text-muted-foreground" data-testid="step-timing">
                    {elapsed !== null ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Spinner className="size-3 text-teal" />
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
