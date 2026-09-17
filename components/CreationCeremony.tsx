"use client";

import { useEffect, useState } from "react";
import { cn } from "cn";
import { CheckIcon, CoinsIcon, FingerprintIcon, LayersIcon, PiggyBankIcon, type LucideIcon } from "lucide-react";
import type { CreateWalletPhase } from "@sembol/passkey-react";
import { useLocale } from "@/lib/i18n";

type BeatKey = "passkey" | "deploy" | "relay" | "ready";
type BeatState = "idle" | "active" | "done";

const BEATS: { key: BeatKey; Icon: LucideIcon }[] = [
  { key: "passkey", Icon: FingerprintIcon },
  { key: "deploy", Icon: LayersIcon },
  { key: "relay", Icon: CoinsIcon },
  { key: "ready", Icon: PiggyBankIcon },
];

/**
 * Where each beat stands, read from the kit's own phase and never from a timer:
 * a beat may show as running early, but it only completes once the phase has
 * moved past it. The relay pays for the very transaction the deploy submits, so
 * the two run and finish together.
 */
function stateOf(beat: BeatKey, phase: CreateWalletPhase, done: boolean): BeatState {
  if (done) return "done";
  switch (beat) {
    case "passkey":
      // null is the moment before the kit reports anything: the prompt is imminent.
      return phase === "deploying" || phase === "funding" ? "done" : "active";
    case "deploy":
    case "relay":
      if (phase === "funding") return "done";
      return phase === "deploying" ? "active" : "idle";
    case "ready":
      return phase === "funding" ? "active" : "idle";
  }
}

/** Seconds on screen since the ceremony began, so the wait has a number on it. */
function useElapsed(): number {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(start);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return Math.max(0, Math.round((now - start) / 1000));
}

/**
 * The eight to sixteen seconds it takes to open a kumbara, shown rather than
 * spun: four beats with what each one actually does, the live one breathing and
 * shimmering, finished ones ticked. Driven by the kit's phase, so it can never
 * claim a step is finished before it is.
 */
export function CreationCeremony({ phase, done = false, className }: { phase: CreateWalletPhase; done?: boolean; className?: string }) {
  const { t } = useLocale();
  const elapsed = useElapsed();
  const copy = t.onboard.ceremony;
  const active = BEATS.find((b) => stateOf(b.key, phase, done) === "active");

  return (
    <div role="status" aria-live="polite" data-testid="ceremony" className={cn("flex flex-col gap-4", className)}>
      <div className="flex flex-col gap-1">
        <p className="text-base font-semibold text-foreground">{copy.title}</p>
        <p className="text-xs text-muted-foreground">{copy.lead}</p>
      </div>

      <ol className="flex flex-col">
        {BEATS.map((beat, i) => {
          const state = stateOf(beat.key, phase, done);
          const last = i === BEATS.length - 1;
          const step = copy.steps[beat.key];
          return (
            <li
              key={beat.key}
              data-beat={beat.key}
              data-state={state}
              className="rise-in relative flex gap-3 pb-4 last:pb-0"
              // A short stagger so the four beats arrive in order; small enough that a reduced-motion
              // reader never waits on it (the media query zeroes durations, not delays).
              style={{ animationDelay: `${i * 60}ms` }}
            >
              {!last ? (
                <svg className="absolute top-8 left-[15px] h-[calc(100%-2rem)] w-0.5" viewBox="0 0 2 100" preserveAspectRatio="none" aria-hidden>
                  <line x1="1" y1="0" x2="1" y2="100" stroke="var(--color-line)" strokeWidth="2" />
                  {state === "done" ? (
                    <line x1="1" y1="0" x2="1" y2="100" stroke="var(--color-mint)" strokeWidth="2" strokeDasharray="100" strokeDashoffset="100" className="draw-in" />
                  ) : null}
                </svg>
              ) : null}

              <span
                className={cn(
                  "relative z-[1] grid size-8 flex-none place-items-center rounded-full",
                  state === "done" && "bg-mint text-white",
                  state === "active" && "breathe bg-rose text-white",
                  state === "idle" && "border border-input bg-card text-muted-foreground",
                )}
                aria-hidden
              >
                {state === "done" ? <CheckIcon className="pop-in size-4" /> : <beat.Icon className="size-4" />}
              </span>

              <div className="min-w-0 flex-1 pt-1">
                <p
                  className={cn(
                    "text-sm leading-5 font-semibold",
                    state === "active" && "sheen",
                    state === "done" && "text-ink-2",
                    state === "idle" && "text-muted-foreground",
                  )}
                >
                  {step.label}
                </p>
                {state !== "idle" ? (
                  <p key={`${beat.key}-${state}`} className="rise-in mt-0.5 text-xs leading-4 text-muted-foreground">
                    {step.detail}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      {/* The wait needs saying out loud: a first-timer does not know a passkey prompt is followed by ten
          seconds of chain work, and a silent screen reads as a screen that has stopped. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-sm font-semibold text-rose">{copy.hold}</p>
        <p className="tnum text-xs text-muted-foreground">
          {copy.elapsed.replace("{s}", String(elapsed))} · {copy.typical}
        </p>
      </div>
      {/* A bar that fills toward the typical duration, so the wait has a shape rather than a number. */}
      <div className="h-1 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
        <div
          className="h-full rounded-full bg-rose transition-[width] duration-1000 ease-linear"
          style={{ width: `${Math.min(96, Math.round((elapsed / 14) * 100))}%` }}
        />
      </div>
      <span className="sr-only">{active ? copy.steps[active.key].label : copy.steps.ready.label}</span>
    </div>
  );
}
