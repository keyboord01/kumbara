"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLinkIcon } from "lucide-react";
import { NetworkBadge } from "@/components/NetworkBadge";
import { Spinner } from "@/components/Spinner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EXPLORER_BASE } from "@/lib/config";
import { shortAddress } from "@/lib/format";

interface PoolStatus {
  configured: boolean;
  network: string;
  address: string | null;
  usdc: string | null;
  xlm: string | null;
  limits: { grantUsdc: number; perAccount: number; cooldownHours: number; perDay: number; perIpHour: number };
  grantsToday: number;
  grantsTotal: number;
  refusedToday: number;
  perDay: { day: string; grants: number; refused: number }[];
  recent: { ts: number; contractId: string; hash: string; usdc: string }[];
  refusals: { ts: number; contractId: string; code: string }[];
}

const time = (ts: number) => new Date(ts).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" });

/**
 * Presenter view of the test-funds pool (testnet): balance, grants per day, the latest grants and refusals, and the
 * one-step refill. Presenter tool, English only, behind the same session as /booth/admin.
 */
export default function FundsAdmin() {
  const [status, setStatus] = useState<PoolStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [xlm, setXlm] = useState("1000");
  const [refilling, setRefilling] = useState(false);
  const [refill, setRefill] = useState<{ hashes: string[]; usdcAfter: string | null } | null>(null);
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    let alive = true;
    fetch("/api/booth/admin/testfunds", { credentials: "same-origin", cache: "no-store" })
      .then(async (r) => ({ ok: r.ok, body: (await r.json()) as PoolStatus & { error?: { message: string } } }))
      .then(({ ok, body }) => {
        if (!alive) return;
        if (ok) {
          setStatus(body);
          setError(null);
        } else setError(body.error?.message ?? "request failed");
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, [epoch]);

  const doRefill = useCallback(async () => {
    setRefilling(true);
    setRefill(null);
    try {
      const res = await fetch("/api/booth/admin/testfunds/refill", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ xlm: Number(xlm) }) });
      const body = (await res.json()) as { hashes: string[]; usdcAfter: string | null; error?: { message: string } };
      if (!res.ok) throw new Error(body.error?.message ?? `HTTP ${res.status}`);
      setRefill(body);
      setEpoch((e) => e + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefilling(false);
    }
  }, [xlm]);

  const max = Math.max(1, ...(status?.perDay.map((d) => d.grants + d.refused) ?? [1]));
  const low = status?.usdc !== null && status?.usdc !== undefined && Number(status.usdc) < (status.limits.grantUsdc ?? 10) * 5;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6">
      <header className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <Link href="/booth/admin" className="text-xs text-plum underline-offset-4 hover:underline">
            ← Presenter console
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">Test-funds pool</h1>
        </div>
        <NetworkBadge />
      </header>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{error}</AlertTitle>
          <AlertDescription>Sign in on the presenter console first; this page uses the same session.</AlertDescription>
        </Alert>
      ) : null}

      {status && !status.configured ? (
        <Alert>
          <AlertTitle>The pool is not configured.</AlertTitle>
          <AlertDescription>Set TESTFUNDS_SECRET (any new testnet secret key), then use Refill once: it creates the account, adds the USDC trustline and swaps XLM into USDC.</AlertDescription>
        </Alert>
      ) : null}

      {status ? (
        <>
          <Card data-testid="pool-card">
            <CardHeader>
              <CardTitle className="microlabel">Pool</CardTitle>
              <CardDescription>
                {status.address ? (
                  <a href={`${EXPLORER_BASE}/account/${status.address}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-plum">
                    {shortAddress(status.address, 8)} <ExternalLinkIcon className="size-3.5" aria-hidden />
                  </a>
                ) : (
                  "no account"
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="USDC in pool" value={status.usdc ?? "—"} tone={low ? "warn" : "plain"} testId="pool-usdc" />
              <Stat label="XLM in pool" value={status.xlm ? Number(status.xlm).toFixed(0) : "—"} />
              <Stat label="Grants today" value={`${status.grantsToday} / ${status.limits.perDay}`} testId="pool-today" />
              <Stat label="Refused today" value={String(status.refusedToday)} />
            </CardContent>
            <CardContent className="text-xs text-muted-foreground">
              {status.limits.grantUsdc} USDC per grant · at most {status.limits.perAccount} per kumbara, {status.limits.cooldownHours} h apart · {status.limits.perDay} per day · {status.limits.perIpHour} requests per IP per hour · {status.grantsTotal} grants in total
            </CardContent>
            <CardFooter className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-xs">
                XLM to swap
                <Input value={xlm} onChange={(e) => setXlm(e.target.value)} inputMode="numeric" className="w-28" />
              </label>
              <Button onClick={() => void doRefill()} disabled={refilling} data-testid="pool-refill">
                {refilling ? <Spinner data-icon="inline-start" /> : null}
                Refill
              </Button>
              <span className="text-xs text-muted-foreground">Friendbot XLM when low, then XLM → USDC on the testnet DEX.</span>
            </CardFooter>
            {refill ? (
              <CardContent className="text-xs">
                Refilled: pool now holds {refill.usdcAfter ?? "?"} USDC.{" "}
                {refill.hashes.map((h) => (
                  <a key={h} href={`${EXPLORER_BASE}/tx/${h}`} target="_blank" rel="noreferrer" className="mr-2 font-mono text-plum">
                    {h.slice(0, 8)}…
                  </a>
                ))}
              </CardContent>
            ) : null}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="microlabel">Grants per day (UTC, last 7 days)</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1.5" data-testid="pool-per-day">
              {status.perDay.map((d) => (
                <div key={d.day} className="grid grid-cols-[6rem_1fr_5rem] items-center gap-2 text-xs">
                  <span className="font-mono text-muted-foreground">{d.day}</span>
                  <div className="flex h-3 overflow-hidden rounded-sm bg-muted" aria-hidden>
                    <div className="bg-mint" style={{ width: `${(d.grants / max) * 100}%` }} />
                    <div className="bg-destructive/60" style={{ width: `${(d.refused / max) * 100}%` }} />
                  </div>
                  <span className="text-right tabular-nums">
                    {d.grants} sent{d.refused ? ` · ${d.refused} refused` : ""}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="microlabel">Latest grants</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-1 text-xs">
                {status.recent.length === 0 ? <p className="text-muted-foreground">None yet.</p> : null}
                {status.recent.map((g) => (
                  <p key={g.hash} className="flex justify-between gap-2">
                    <span className="text-muted-foreground">{time(g.ts)}</span>
                    <span className="font-mono">{shortAddress(g.contractId, 5)}</span>
                    <a href={`${EXPLORER_BASE}/tx/${g.hash}`} target="_blank" rel="noreferrer" className="font-mono text-plum">
                      {g.usdc} USDC ↗
                    </a>
                  </p>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="microlabel">Latest refusals</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-1 text-xs" data-testid="pool-refusals">
                {status.refusals.length === 0 ? <p className="text-muted-foreground">None.</p> : null}
                {status.refusals.map((r) => (
                  <p key={`${r.ts}-${r.contractId}`} className="flex justify-between gap-2">
                    <span className="text-muted-foreground">{time(r.ts)}</span>
                    <span className="font-mono">{shortAddress(r.contractId, 5)}</span>
                    <Badge variant="destructive">{r.code}</Badge>
                  </p>
                ))}
              </CardContent>
            </Card>
          </div>
        </>
      ) : !error ? (
        <Spinner />
      ) : null}
    </div>
  );
}

function Stat({ label, value, tone = "plain", testId }: { label: string; value: string; tone?: "plain" | "warn"; testId?: string }) {
  return (
    <div className="flex flex-col">
      <span className="microlabel text-muted-foreground">{label}</span>
      <span className={tone === "warn" ? "text-xl font-bold text-amber" : "text-xl font-bold"} data-testid={testId}>
        {value}
      </span>
    </div>
  );
}
