"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { NetworkBadge } from "@/components/NetworkBadge";
import { Spinner } from "@/components/Spinner";
import { StatusLine } from "@/components/StatusLine";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Snapshot {
  since: number;
  errors: { kind: string; count: number; last: number; paths: string[]; browsers: string[]; sample: string }[];
  errorsPerDay: { day: string; count: number }[];
  feedback: { ts: number; message: string; kind: string | null; path: string; browser: string; os: string; mobile: boolean }[];
}

const time = (ts: number) => new Date(ts).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" });

/**
 * Presenter view of what pilot users hit: failure screens and uncaught errors grouped by kind, errors per day, and
 * every problem report with its anonymised context. Presenter tool, English only, same session as /booth/admin.
 */
export default function MonitorAdmin() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    let alive = true;
    fetch("/api/booth/admin/monitor", { credentials: "same-origin", cache: "no-store" })
      .then(async (r) => ({ ok: r.ok, body: (await r.json()) as Snapshot & { error?: { message: string } } }))
      .then(({ ok, body }) => {
        if (!alive) return;
        if (ok) {
          setSnap(body);
          setError(null);
        } else setError(body.error?.message ?? "request failed");
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      });
    const timer = setInterval(() => setEpoch((e) => e + 1), 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [epoch]);

  const max = Math.max(1, ...(snap?.errorsPerDay.map((d) => d.count) ?? [1]));

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6">
      <header className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <Link href="/booth/admin" className="text-xs text-plum underline-offset-4 hover:underline">
            ← Presenter console
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">Errors and feedback</h1>
        </div>
        <div className="flex items-center gap-2">
          <NetworkBadge />
          <Button variant="outline" size="sm" onClick={() => setEpoch((e) => e + 1)}>
            Refresh
          </Button>
        </div>
      </header>

      <Card>
        <CardContent className="text-sm">
          <StatusLine />
        </CardContent>
      </Card>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{error}</AlertTitle>
          <AlertDescription>Sign in on the presenter console first; this page uses the same session.</AlertDescription>
        </Alert>
      ) : null}

      {snap ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="microlabel">Errors per day (UTC, last 7 days)</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1.5" data-testid="monitor-per-day">
              {snap.errorsPerDay.map((d) => (
                <div key={d.day} className="grid grid-cols-[6rem_1fr_3rem] items-center gap-2 text-xs">
                  <span className="font-mono text-muted-foreground">{d.day}</span>
                  <div className="h-3 overflow-hidden rounded-sm bg-muted" aria-hidden>
                    <div className="h-full bg-destructive/70" style={{ width: `${(d.count / max) * 100}%` }} />
                  </div>
                  <span className="text-right tabular-nums">{d.count}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="microlabel">By kind</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm" data-testid="monitor-kinds">
              {snap.errors.length === 0 ? <p className="text-muted-foreground">No errors in the last 7 days.</p> : null}
              {snap.errors.map((e) => (
                <div key={e.kind} className="flex flex-col gap-0.5 border-b border-border pb-2 last:border-0">
                  <p className="flex items-center justify-between gap-2">
                    <span className="font-mono font-semibold">{e.kind}</span>
                    <Badge variant="destructive">{e.count}×</Badge>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    last {time(e.last)} · {e.paths.join(", ")} · {e.browsers.join("; ")}
                  </p>
                  {e.sample ? <p className="truncate font-mono text-xs text-ink-2">{e.sample}</p> : null}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="microlabel">Problem reports</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm" data-testid="monitor-feedback">
              {snap.feedback.length === 0 ? <p className="text-muted-foreground">No reports yet.</p> : null}
              {snap.feedback.map((f) => (
                <div key={f.ts} className="flex flex-col gap-0.5 border-b border-border pb-2 last:border-0">
                  <p className="text-xs text-muted-foreground">
                    {time(f.ts)} · {f.path} · {f.browser} / {f.os}
                    {f.mobile ? " (phone)" : ""}
                    {f.kind ? ` · on ${f.kind}` : ""}
                  </p>
                  <p>{f.message || <span className="text-muted-foreground">(no note)</span>}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      ) : !error ? (
        <Spinner />
      ) : null}
    </div>
  );
}
