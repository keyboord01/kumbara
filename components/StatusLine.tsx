"use client";

import { useEffect, useState } from "react";
import { cn } from "cn";
import { useLocale } from "@/lib/i18n";

type DepName = "anchor" | "relay" | "rpc" | "vault";
interface Health {
  ok: boolean;
  database?: { ok: boolean };
  dependencies?: Partial<Record<DepName, { ok: boolean; slow?: boolean }>> & { error?: string };
}

const POLL_MS = 120_000;

/**
 * The public status line in the footer: one dot and a few words from /api/health (database, anchor, relay,
 * Stellar RPC, vault), so a user who hits trouble can see whether it is them or us. Polls every two minutes
 * while the tab is visible.
 */
export function StatusLine() {
  const { t } = useLocale();
  const [health, setHealth] = useState<Health | null | "error">(null);

  useEffect(() => {
    let alive = true;
    const load = () => {
      if (document.visibilityState !== "visible") return;
      fetch("/api/health", { cache: "no-store" })
        .then((r) => r.json() as Promise<Health>)
        .then((h) => {
          if (alive) setHealth(h);
        })
        .catch(() => {
          if (alive) setHealth("error");
        });
    };
    load();
    const timer = setInterval(load, POLL_MS);
    document.addEventListener("visibilitychange", load);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", load);
    };
  }, []);

  let tone: "ok" | "slow" | "down" | "unknown" = "unknown";
  let text: string = t.status.checking;
  if (health === "error") {
    text = t.status.unknown;
  } else if (health) {
    const deps = health.dependencies ?? {};
    const names = (["anchor", "relay", "rpc", "vault"] as const).filter((d) => deps[d]);
    const down: string[] = names.filter((d) => !deps[d]!.ok).map((d) => t.status.names[d]);
    if (health.database && !health.database.ok) down.unshift(t.status.names.database);
    const slow = names.filter((d) => deps[d]!.ok && deps[d]!.slow).map((d) => t.status.names[d]);
    if (down.length) [tone, text] = ["down", t.status.down.replace("{names}", down.join(", "))];
    else if (slow.length) [tone, text] = ["slow", t.status.slow.replace("{names}", slow.join(", "))];
    else [tone, text] = ["ok", t.status.ok];
  }

  return (
    <p role="status" aria-live="polite" data-testid="status-line" data-tone={tone} className="flex items-center gap-1.5">
      <span className={cn("size-2 rounded-full", tone === "ok" && "bg-mint", tone === "slow" && "bg-amber", tone === "down" && "bg-destructive", tone === "unknown" && "bg-muted-foreground/40")} aria-hidden />
      <span>
        {t.status.label}: {text}
      </span>
    </p>
  );
}
