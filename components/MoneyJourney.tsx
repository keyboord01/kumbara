"use client";

import { useEffect, useState } from "react";
import { cn } from "cn";
import { useLocale } from "@/lib/i18n";

/** The five places the money passes through, in order. */
export type JourneyStop = "bank" | "anchor" | "bridge" | "kumbara" | "vault";
const STOPS: JourneyStop[] = ["bank", "anchor", "bridge", "kumbara", "vault"];

/**
 * Where the money is, from the record's status. `reached` is the last stop it
 * has arrived at (−1 before the bank has it); `leg` is the stop it is moving
 * towards, or null when nothing is in flight.
 */
function position(status: string): { reached: number; leg: number | null } {
  switch (status) {
    // Nothing has moved yet: the visitor still has to send the transfer, or a person has to approve it.
    case "awaiting_transfer":
      return { reached: -1, leg: null };
    case "transfer_received":
    case "onramp_pending":
      return { reached: 0, leg: 1 };
    case "onramp_paid":
    case "forwarded":
      return { reached: 1, leg: 2 };
    case "in_wallet":
      return { reached: 2, leg: 3 };
    case "in_vault":
      return { reached: 4, leg: null };
    default:
      // failed, cancelled, abandoned: freeze where it stands, nothing travelling.
      return { reached: -1, leg: null };
  }
}

/** Geometry of the route, in the SVG's own units. One straight line, five stops. */
const VIEW_W = 320;
const VIEW_H = 44;
const X0 = 22;
const X1 = VIEW_W - 22;
const Y = 20;
const GAP = (X1 - X0) / (STOPS.length - 1);
const stopX = (i: number) => X0 + GAP * i;

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

export interface MoneyJourneyProps {
  /** The deposit record's status. */
  status: string;
  /** ISO time the record last moved, for the elapsed counter on the current leg. */
  since?: string | undefined;
  /** Typical seconds for the leg in flight, from the measured round trips. */
  typicalSeconds?: number | undefined;
  className?: string;
}

/**
 * The picture of a deposit: bank → anchor → bridge → kumbara → vault, with a
 * coin riding the leg the money is on right now. The stepper beside it carries
 * the detail; this is so the wait reads as movement rather than a frozen list.
 */
export function MoneyJourney({ status, since, typicalSeconds, className }: MoneyJourneyProps) {
  const { t } = useLocale();
  const { reached, leg } = position(status);
  const arrived = status === "in_vault";
  const now = useNow(leg !== null && Boolean(since));
  const elapsed = leg !== null && since ? Math.max(0, Math.round((now - Date.parse(since)) / 1000)) : null;
  const labels: Record<JourneyStop, string> = {
    bank: t.deposit.journey.bank,
    anchor: t.deposit.journey.anchor,
    bridge: t.deposit.journey.bridge,
    kumbara: t.deposit.journey.kumbara,
    vault: t.deposit.journey.vault,
  };
  const legLabel = leg !== null ? `${labels[STOPS[Math.max(0, leg - 1)]!]} → ${labels[STOPS[leg]!]}` : arrived ? labels.vault : labels.bank;
  // The coin rides only the leg in flight, so the path it follows is that segment alone.
  const legPath = leg !== null ? `M ${stopX(leg - 1)} ${Y} L ${stopX(leg)} ${Y}` : "";

  return (
    <div className={cn("flex flex-col gap-2", className)} data-testid="journey">
      <div className="-mx-1 overflow-x-auto px-1">
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="h-auto w-full min-w-[300px]"
          role="img"
          aria-label={`${t.deposit.journey.title}: ${legLabel}`}
        >
          {/* The route: a quiet rail, with the part already travelled drawn over it. */}
          <line x1={X0} y1={Y} x2={X1} y2={Y} stroke="var(--color-line-2)" strokeWidth="2" strokeLinecap="round" />
          {reached > 0 || arrived ? (
            <line
              x1={X0}
              y1={Y}
              x2={stopX(arrived ? STOPS.length - 1 : reached)}
              y2={Y}
              stroke="var(--color-mint)"
              strokeWidth="2"
              strokeLinecap="round"
            />
          ) : null}
          {/* The leg in flight: dashed, with a coin on it. */}
          {leg !== null ? (
            <>
              <line
                x1={stopX(leg - 1)}
                y1={Y}
                x2={stopX(leg)}
                y2={Y}
                stroke="var(--color-rose)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeDasharray="3 4"
                opacity="0.5"
              />
              <circle
                r="4.5"
                fill="var(--color-rose)"
                className="travel"
                style={{ offsetPath: `path("${legPath}")`, offsetRotate: "0deg" }}
              />
            </>
          ) : null}
          {STOPS.map((stop, i) => {
            const state = arrived || i <= reached ? "done" : leg === i ? "active" : "idle";
            return (
              <g key={stop} data-stop={stop} data-state={state}>
                <circle
                  cx={stopX(i)}
                  cy={Y}
                  r={state === "idle" ? 4 : 6}
                  fill={state === "idle" ? "var(--color-paper)" : state === "active" ? "var(--color-rose)" : "var(--color-mint)"}
                  stroke={state === "idle" ? "var(--color-line-2)" : "transparent"}
                  strokeWidth="2"
                  className={cn(state === "active" && "breathe", state === "done" && arrived && i === STOPS.length - 1 && "pop-in")}
                  style={{ transformOrigin: `${stopX(i)}px ${Y}px` }}
                />
                <text
                  x={stopX(i)}
                  y={VIEW_H - 3}
                  textAnchor="middle"
                  fontSize="8"
                  fill={state === "idle" ? "var(--muted-foreground)" : "var(--color-ink-2)"}
                  fontWeight={state === "active" ? 700 : 500}
                >
                  {labels[stop]}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <p className="tnum flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        <span className={cn("font-semibold", arrived ? "text-mint-2" : "text-ink-2")}>{legLabel}</span>
        {elapsed !== null ? <span>{t.stepper.elapsed.replace("{s}", String(elapsed))}</span> : null}
        {typicalSeconds && leg !== null ? <span>· {t.stepper.typical.replace("{s}", String(typicalSeconds))}</span> : null}
      </p>
    </div>
  );
}

export interface ApprovalWaitProps {
  /** ISO time the deposit was created, for the timer. */
  createdAt: string;
  /** True once the deposit has moved past awaiting_transfer. */
  approved: boolean;
}

/**
 * Deposits above the automatic threshold wait for a person. Rather than a
 * still "waiting for your transfer" line, this says who is doing what and how
 * long it has been, then turns into a tick when they approve it.
 */
export function ApprovalWait({ createdAt, approved }: ApprovalWaitProps) {
  const { t } = useLocale();
  const now = useNow(!approved);
  const waited = Math.max(0, Math.round((now - Date.parse(createdAt)) / 1000));
  if (approved) {
    return (
      <p className="pop-in flex items-center gap-2 text-sm font-semibold text-mint-2" data-testid="approval-wait" data-approved="true">
        <span className="flex size-5 items-center justify-center rounded-full bg-mint text-[11px] font-bold text-white" aria-hidden>
          ✓
        </span>
        {t.deposit.journey.approved}
      </p>
    );
  }
  return (
    <div className="rise-in flex flex-col gap-1 rounded-lg bg-amber/5 p-3" data-testid="approval-wait" data-approved="false">
      <p className="sheen text-sm font-semibold">{t.deposit.journey.waitingApproval}</p>
      <p className="text-xs text-ink-2">{t.deposit.journey.waitingApprovalHint}</p>
      <p className="tnum text-xs text-muted-foreground">{t.deposit.journey.waited.replace("{s}", String(waited))}</p>
    </div>
  );
}
