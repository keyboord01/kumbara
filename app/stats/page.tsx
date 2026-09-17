"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { cn } from "cn";
import { NetworkBadge } from "@/components/NetworkBadge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from "@/components/ui/item";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { EXPLORER_BASE, NETWORK, NETWORK_LABEL, SITE_URL, sembolConfig } from "@/lib/config";
import { formatTry, formatUsdc, shortAddress } from "@/lib/format";
import { useLocale } from "@/lib/i18n";

interface Totals {
  accounts: number;
  depositsCompleted: number;
  withdrawalsCompleted: number;
  tryIn: string;
  tryOut: string;
}
interface FeedItem {
  type: "account_created" | "deposit_completed" | "withdrawal_completed";
  ts: number;
  contractId: string | null;
  usdc: string | null;
  try: string | null;
  hash: string | null;
  link: string | null;
}
interface Timing {
  n: number;
  medianMs: number | null;
  p90Ms: number | null;
}
interface FunnelStage {
  stage: string;
  count: number;
  dropOff: number;
  dropPct: number | null;
}
interface Snapshot {
  generatedAt: string;
  since: number;
  headline: Totals & { usdcInVault: string | null; vaultId: string; strategyId: string | null };
  allTime: Totals;
  feed: FeedItem[];
  buckets: { minutes: number; from: number; to: number; series: Array<{ start: number; accounts: number }> };
  accounts: { byRef: Record<string, number>; viaInvites?: number };
  funnel?: { accounts: number; deposits: { stages: FunnelStage[]; exits: Record<string, number> }; withdrawals: { stages: FunnelStage[]; exits: Record<string, number> } };
  timings: { tapToReady: Timing; deposit: Timing; withdraw: Timing; minSamples: number };
}
interface Health {
  ok: boolean;
  dependencies: { anchor: { ok: boolean }; relay: { ok: boolean }; rpc: { ok: boolean }; vault: { ok: boolean } } | { error: string };
  sponsor: { ok: boolean; balanceXlm: number; minXlm: number } | null;
}

const REFRESH_MS = 30_000;
const HEALTH_MS = 60_000;
const TV_CYCLE_MS = 10_000;
const README_ACCOUNT = "CCA3M6MEMU76ATTABWE7LFQI67F7C25PGJCFBJ75WZRQMTN255TTPOXB";

function useSnapshot(window: "event" | "all") {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number>(0);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`/api/metrics${window === "all" ? "?since=1" : ""}`)
        .then((r) => (r.ok ? (r.json() as Promise<Snapshot>) : null))
        .then((s) => {
          if (alive && s) {
            setSnapshot(s);
            setUpdatedAt(Date.now());
          }
        })
        .catch(() => undefined);
    const first = setTimeout(load, 0);
    const id = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearTimeout(first);
      clearInterval(id);
    };
  }, [window]);
  return { snapshot, updatedAt };
}

function useHealth() {
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/health")
        .then((r) => r.json() as Promise<Health>)
        .then((h) => alive && setHealth(h))
        .catch(() => undefined);
    const first = setTimeout(load, 0);
    const id = setInterval(load, HEALTH_MS);
    return () => {
      alive = false;
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);
  return health;
}

/** Ticks every 10 s so relative times and the TV chart cycle move without reading the clock in render. */
function useClock(intervalMs: number): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const first = setTimeout(() => setNow(Date.now()), 0);
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [intervalMs]);
  return now;
}

function seconds(ms: number | null): string {
  return ms === null ? "–" : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}

/** Text link to the explorer; every one carries the network label. */
function ExplorerLink({ href, label, tv }: { href: string; label: string; tv: boolean }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={cn("rounded-sm text-plum underline-offset-4 hover:underline", tv ? "text-base" : "text-sm")}>
      {label} · {NETWORK_LABEL} ↗
    </a>
  );
}

function Stats() {
  const { t, locale } = useLocale();
  const params = useSearchParams();
  const tv = params.get("mode") === "tv";
  const [window, setWindow] = useState<"event" | "all">("event");
  const { snapshot, updatedAt } = useSnapshot(window);
  const health = useHealth();
  const now = useClock(TV_CYCLE_MS);
  const [cycle, setCycle] = useState(0);
  useEffect(() => {
    if (!tv) return;
    const id = setInterval(() => setCycle((c) => c + 1), TV_CYCLE_MS);
    return () => clearInterval(id);
  }, [tv]);
  const intl = locale === "tr" ? "tr-TR" : "en-US";
  const fmtInt = (n: number | undefined) => (n === undefined ? "–" : n.toLocaleString(intl));
  const ago = (ts: number): string => {
    if (!now) return "";
    const m = Math.max(0, Math.round((now - ts) / 60_000));
    if (m < 1) return t.stats.ago.now;
    if (m < 60) return t.stats.ago.m.replace("{n}", String(m));
    if (m < 60 * 48) return t.stats.ago.h.replace("{n}", String(Math.round(m / 60)));
    return t.stats.ago.d.replace("{n}", String(Math.round(m / 1440)));
  };
  const head = snapshot?.headline;
  // Before BOOTH_START_TS the "since event start" window is empty by definition: switch to
  // all time (numbers, feed and curve alike) until the event begins.
  const eventStarted = snapshot ? snapshot.since * 1000 <= updatedAt : true;
  useEffect(() => {
    if (eventStarted || window === "all") return;
    const kick = setTimeout(() => setWindow("all"), 0);
    return () => clearTimeout(kick);
  }, [eventStarted, window]);
  const effectiveWindow: "event" | "all" = eventStarted ? window : "all";
  const shownTotals: Totals | undefined = effectiveWindow === "all" ? snapshot?.allTime : head;
  const deps = health && "anchor" in health.dependencies ? health.dependencies : null;
  const sponsorRatio = health?.sponsor ? Math.min(5, health.sponsor.balanceXlm / Math.max(1, health.sponsor.minXlm)) : null;
  const series = snapshot?.buckets.series ?? [];
  const maxBucket = Math.max(1, ...series.map((b) => b.accounts));
  const byRef = Object.entries(snapshot?.accounts.byRef ?? {}).sort((a, b) => b[1] - a[1]);
  const showRefChart = tv && cycle % 2 === 1;
  const policyId = (sembolConfig as { spendingLimitPolicyAddress?: string }).spendingLimitPolicyAddress ?? null;
  const exampleAccount = snapshot?.feed.find((f) => f.type === "account_created" && f.contractId)?.contractId ?? README_ACCOUNT;
  const bigNumber = tv ? "text-6xl sm:text-7xl" : "text-4xl";
  const feed = snapshot?.feed ?? [];

  const money = (value: string | undefined, kind: "try" | "usdc") =>
    value === undefined ? "–" : kind === "try" ? formatTry(Number(value), locale) : `${formatUsdc(value, locale)} USDC`;

  return (
    <div className={cn("mx-auto flex w-full flex-col gap-6", tv ? "max-w-6xl px-6 py-6" : "max-w-3xl px-4 py-5")}>
      {!tv ? (
        <header className="flex items-center justify-between gap-3">
          <Link href="/" className="flex items-baseline gap-2 rounded-md">
            <span className="text-lg font-bold tracking-tight text-plum">{t.brand}</span>
            <span className="text-xs text-muted-foreground">{t.bySembol}</span>
          </Link>
          <div className="flex items-center gap-2">
            <NetworkBadge />
            <LangToggle />
          </div>
        </header>
      ) : null}

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className={cn("font-bold tracking-tight text-foreground", tv ? "text-4xl" : "text-3xl")}>{t.stats.title}</h1>
          <div className="flex items-center gap-3 text-xs text-muted-foreground" data-testid="live">
            <span className="inline-flex items-center gap-1.5">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-mint opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-mint" />
              </span>
              {t.stats.live}
            </span>
            {updatedAt ? <span className="tnum">{t.stats.updated} {new Date(updatedAt).toLocaleTimeString(intl)}</span> : null}
          </div>
        </div>
        <p className="text-sm text-ink-2">{t.stats.lead}</p>
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            variant="segment"
            size="xs"
            spacing={0.5}
            value={[effectiveWindow]}
            onValueChange={(value) => {
              const next = value[0];
              if (next === "event" || next === "all") setWindow(next);
            }}
            aria-label={t.stats.windowEvent}
          >
            {(["event", "all"] as const).map((w) => (
              <ToggleGroupItem key={w} value={w} disabled={w === "event" && !eventStarted} className="normal-case" data-testid={`window-${w}`}>
                {w === "event" ? t.stats.windowEvent : t.stats.windowAll}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {snapshot && !eventStarted ? (
            <span className="text-xs text-muted-foreground" data-testid="event-not-started">
              {t.stats.eventStarts.replace("{date}", new Date(snapshot.since * 1000).toLocaleDateString(intl, { day: "numeric", month: "long" }))}
            </span>
          ) : null}
        </div>
      </section>

      <section className={cn("grid gap-3", tv ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-3")} data-testid="headline" aria-label={t.stats.title}>
        {(
          [
            ["accounts", fmtInt(shownTotals?.accounts), t.stats.headline.accounts, false],
            ["deposits", fmtInt(shownTotals?.depositsCompleted), t.stats.headline.deposits, false],
            ["withdrawals", fmtInt(shownTotals?.withdrawalsCompleted), t.stats.headline.withdrawals, false],
            ["tryIn", money(shownTotals?.tryIn, "try"), t.stats.headline.tryIn, true],
            ["tryOut", money(shownTotals?.tryOut, "try"), t.stats.headline.tryOut, true],
            ["usdcInVault", head?.usdcInVault === null ? "–" : money(head?.usdcInVault, "usdc"), t.stats.headline.usdcInVault, true],
          ] as const
        ).map(([key, value, label, isMoney]) => (
          <Card key={key} size="sm">
            <CardContent className="flex flex-col gap-1">
              {/* Keyed on the value so a figure that changed lands; nothing animates until the snapshot is in. */}
              <p className={cn("tnum font-bold leading-none text-foreground", isMoney ? (tv ? "text-3xl sm:text-4xl" : "text-2xl") : bigNumber)} data-testid={`headline-${key}`}>
                {value}
              </p>
              <p className="flex flex-wrap items-center gap-2 text-xs text-ink-2">
                <span>{label}</span>
                {key === "accounts" && snapshot?.accounts.viaInvites ? <span data-testid="headline-via-invites">· {snapshot.accounts.viaInvites} {t.stats.viaInvites}</span> : null}
                {isMoney || key === "accounts" || key === "deposits" || key === "withdrawals" ? <NetworkBadge /> : null}
              </p>
            </CardContent>
          </Card>
        ))}
      </section>

      <div className={cn("grid gap-6", tv ? "grid-cols-2" : "grid-cols-1")}>
        {snapshot?.funnel ? (
          <Card render={<section aria-label={t.stats.funnelTitle} />} data-testid="funnel">
            <CardHeader>
              <CardTitle>{t.stats.funnelTitle}</CardTitle>
              <CardDescription className="text-xs text-ink-2">{t.stats.funnelHint}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              {(
                [
                  ["deposits", t.stats.funnelDeposits, snapshot.funnel.deposits, t.stats.funnelStages.deposit],
                  ["withdrawals", t.stats.funnelWithdrawals, snapshot.funnel.withdrawals, t.stats.funnelStages.withdraw],
                ] as const
              ).map(([key, title, data, labels]) => (
                <div key={key} className="flex flex-col gap-2" data-testid={`funnel-${key}`}>
                  <p className="microlabel">{title}</p>
                  <Table className="tnum">
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="h-8 px-0 text-xs text-muted-foreground">{t.stats.funnelStage}</TableHead>
                        <TableHead className="h-8 px-0 text-right text-xs text-muted-foreground">{t.stats.funnelCount}</TableHead>
                        <TableHead className="h-8 px-0 text-right text-xs text-muted-foreground">{t.stats.funnelDrop}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.stages.map((s, i) => (
                        <TableRow key={s.stage} data-stage={s.stage} style={{ animationDelay: `${i * 45}ms` }} className="rise-in hover:bg-transparent">
                          <TableCell className="px-0 py-1.5 whitespace-normal">{(labels as Record<string, string>)[s.stage] ?? s.stage}</TableCell>
                          <TableCell className="px-0 py-1.5 text-right font-semibold">{fmtInt(s.count)}</TableCell>
                          <TableCell className={cn("px-0 py-1.5 text-right", s.dropOff > 0 ? "text-amber" : "text-muted-foreground")}>{i === 0 ? "—" : s.dropPct === null ? "—" : `−${fmtInt(s.dropOff)} (${s.dropPct}%)`}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {Object.keys(data.exits).length ? (
                    <p className="text-xs text-muted-foreground">
                      {t.stats.funnelExits}: {Object.entries(data.exits).map(([k, v]) => `${(labels as Record<string, string>)[k] ?? k} ${fmtInt(v)}`).join(" · ")}
                    </p>
                  ) : null}
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}

        <Card render={<section aria-label={t.stats.feedTitle} />} data-testid="feed">
          <CardHeader>
            <CardTitle>{t.stats.feedTitle}</CardTitle>
            <CardAction>
              <NetworkBadge />
            </CardAction>
          </CardHeader>
          <CardContent>
            {feed.length === 0 ? (
              <Empty className="p-4" data-testid="feed-empty">
                <EmptyHeader>
                  <EmptyTitle className="text-sm">{t.stats.feedEmpty}</EmptyTitle>
                  <EmptyDescription className="text-xs">{t.stats.lead}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <ItemGroup className="gap-0">
                {feed.slice(0, tv ? 12 : 20).map((item, i) => (
                  <Item key={`${item.type}-${item.ts}-${item.hash ?? ""}`} size="xs" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }} className={cn("rise-in rounded-none border-t border-border px-0 first:border-t-0", tv ? "text-base" : "text-sm")} data-testid="feed-item">
                    <ItemContent>
                      <ItemTitle className="flex-wrap items-baseline gap-2 font-normal">
                        <span className="font-mono text-xs text-ink-2">{item.contractId ? shortAddress(item.contractId, 4) : "–"}</span>
                        <span className="text-foreground">{t.stats.feed[item.type]}</span>
                        {item.usdc ? <span className="tnum font-semibold">{formatUsdc(item.usdc, locale)} USDC</span> : null}
                        {item.try ? <span className="tnum text-ink-2">({formatTry(Number(item.try), locale)})</span> : null}
                      </ItemTitle>
                    </ItemContent>
                    <ItemActions className="items-baseline gap-3 text-xs text-muted-foreground">
                      <span className="tnum">{ago(item.ts)}</span>
                      {item.link ? (
                        <a href={item.link} target="_blank" rel="noreferrer" className="rounded-sm text-plum underline-offset-4 hover:underline">
                          {NETWORK_LABEL} ↗
                        </a>
                      ) : null}
                    </ItemActions>
                  </Item>
                ))}
              </ItemGroup>
            )}
          </CardContent>
        </Card>

        <Card render={<section aria-label={t.stats.curveTitle} />} data-testid="curve">
          <CardHeader>
            <CardTitle>{showRefChart ? t.stats.byRef : t.stats.curveTitle}</CardTitle>
            {snapshot && !showRefChart ? <CardDescription className="text-xs">{t.stats.curveHint.replace("{minutes}", String(snapshot.buckets.minutes))}</CardDescription> : null}
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            {showRefChart ? (
              <RefBars byRef={byRef} noRef={t.stats.noRef} intl={intl} tv={tv} />
            ) : (
              <svg viewBox={`0 0 ${Math.max(series.length, 1) * 10} 120`} preserveAspectRatio="none" className={cn("w-full", tv ? "h-56" : "h-32")} role="img" aria-label={t.stats.curveTitle}>
                {series.map((b, i) => {
                  const h = (b.accounts / maxBucket) * 110;
                  return <rect key={b.start} x={i * 10 + 1} y={115 - h} width={8} height={h} rx={1.5} fill="var(--color-plum)" opacity={b.accounts ? 1 : 0.15} />;
                })}
                <line x1={0} y1={116} x2={Math.max(series.length, 1) * 10} y2={116} stroke="var(--color-border)" strokeWidth={1} />
              </svg>
            )}
            {!showRefChart && snapshot ? (
              <p className="tnum flex justify-between text-[11px] text-muted-foreground">
                <span>{new Date(snapshot.buckets.from).toLocaleString(intl, { dateStyle: "short", timeStyle: "short" })}</span>
                <span>{new Date(snapshot.buckets.to).toLocaleString(intl, { dateStyle: "short", timeStyle: "short" })}</span>
              </p>
            ) : null}
            {!tv ? (
              <div className="mt-3 flex flex-col gap-2">
                <h3 className="microlabel">{t.stats.byRef}</h3>
                <RefBars byRef={byRef} noRef={t.stats.noRef} intl={intl} tv={false} />
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card render={<section aria-label={t.stats.timingsTitle} />} data-testid="timings">
        <CardHeader>
          <CardTitle>{t.stats.timingsTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className={cn("grid gap-3", tv ? "grid-cols-3" : "grid-cols-1 sm:grid-cols-3")}>
            {(["tapToReady", "deposit", "withdraw"] as const).map((key) => {
              const timing = snapshot?.timings[key];
              const enough = timing && timing.medianMs !== null;
              return (
                <div key={key} className="flex flex-col gap-1 rounded-lg bg-muted p-3">
                  <dt className="text-sm text-ink-2">{t.stats.timings[key]}</dt>
                  <dd className="flex flex-col gap-1">
                    {enough ? (
                      <p className={cn("tnum font-bold", tv ? "text-3xl" : "text-xl")}>
                        {seconds(timing.medianMs)} <span className="text-xs font-normal text-muted-foreground">{t.stats.median}</span>
                        <span className="ml-2 text-sm font-semibold text-ink-2">{seconds(timing.p90Ms)}</span> <span className="text-xs font-normal text-muted-foreground">{t.stats.p90}</span>
                      </p>
                    ) : (
                      <p className="text-sm font-semibold text-amber">{t.stats.notEnough}</p>
                    )}
                    <p className="tnum text-xs text-muted-foreground">
                      {timing ? t.stats.samples.replace("{n}", String(timing.n)) : "–"}
                      {timing && !enough && snapshot ? ` · ${t.stats.minSamples.replace("{n}", String(snapshot.timings.minSamples))}` : ""}
                    </p>
                  </dd>
                </div>
              );
            })}
          </dl>
        </CardContent>
      </Card>

      {!tv ? (
        <Card render={<section aria-label={t.stats.contractsTitle} />} data-testid="contracts">
          <CardHeader>
            <CardTitle>{t.stats.contractsTitle}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <ul className="flex flex-col gap-2 text-sm">
              {(
                [
                  [t.stats.contracts.vault, head?.vaultId ?? null],
                  [t.stats.contracts.strategy, head?.strategyId ?? null],
                  [t.stats.contracts.policy, policyId],
                  [t.stats.contracts.account, exampleAccount],
                ] as const
              ).map(([label, id]) => (
                <li key={label} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="text-ink-2">{label}</span>
                  {id ? <ExplorerLink href={`${EXPLORER_BASE}/contract/${id}`} label={shortAddress(id, 6)} tv={false} /> : <span className="text-muted-foreground">–</span>}
                </li>
              ))}
            </ul>
            <ul className="flex flex-col gap-1.5 text-sm text-ink-2">
              {(["anchor", "defindex", "oz", "relay", "reflector"] as const).map((k) => (
                <li key={k}>{t.stats.integrations[k]}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {!tv ? (
        <Card render={<section aria-label={t.stats.howTitle} />} data-testid="how">
          <CardHeader>
            <CardTitle>{t.stats.howTitle}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <ol className="flex flex-col gap-2 text-sm text-ink-2">
              {t.stats.how.map((step, i) => (
                <li key={step} className="flex gap-3">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-plum/10 text-xs font-semibold text-plum">{i + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
            <a href="https://github.com/keyboord01/kumbara" target="_blank" rel="noreferrer" className="w-fit rounded-sm text-sm text-plum underline-offset-4 hover:underline">
              {t.stats.repo} ↗
            </a>
          </CardContent>
        </Card>
      ) : null}

      {!tv ? (
        <Card render={<section aria-label={t.stats.healthTitle} />} data-testid="health">
          <CardHeader>
            <CardTitle>{t.stats.healthTitle}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <ul className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              {(["anchor", "relay", "rpc", "vault"] as const).map((name) => {
                const dep = deps?.[name];
                return (
                  <li key={name} className="flex items-center gap-2">
                    <span role="img" className={cn("size-3 rounded-full", dep ? (dep.ok ? "bg-mint" : "bg-destructive") : "bg-border")} aria-label={dep ? (dep.ok ? "ok" : "down") : "unknown"} />
                    <span>{t.admin.healthNames[name]}</span>
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-col gap-1">
              <p className="text-sm text-ink-2">{t.stats.sponsor}</p>
              <Progress
                value={sponsorRatio === null ? 0 : Math.min(100, (sponsorRatio / 5) * 100)}
                aria-label={t.stats.sponsor}
                className={cn("gap-0 [&_[data-slot=progress-indicator]]:rounded-full [&_[data-slot=progress-track]]:h-2", health?.sponsor?.ok ? "[&_[data-slot=progress-indicator]]:bg-mint" : "[&_[data-slot=progress-indicator]]:bg-destructive")}
              />
              <p className="tnum text-xs text-muted-foreground" data-testid="sponsor-ratio">
                {sponsorRatio === null ? "–" : `${sponsorRatio.toFixed(1)}×`}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <footer className="mt-auto flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{NETWORK === "testnet" ? t.footer : t.footerMainnet}</span>
        {!tv ? (
          <span className="flex gap-4">
            <a href={SITE_URL || "/"} className="rounded-sm hover:text-plum">
              {SITE_URL ? SITE_URL.replace(/^https?:\/\//, "") : "kumbara"}
            </a>
            <a href="https://github.com/keyboord01/kumbara" target="_blank" rel="noreferrer" className="rounded-sm hover:text-plum">
              GitHub
            </a>
            <Link href="/stats?mode=tv" className="rounded-sm hover:text-plum">
              {t.stats.tv} →
            </Link>
          </span>
        ) : null}
      </footer>
    </div>
  );
}

function RefBars({ byRef, noRef, intl, tv }: { byRef: Array<[string, number]>; noRef: string; intl: string; tv: boolean }) {
  const max = Math.max(1, ...byRef.map(([, n]) => n));
  if (byRef.length === 0) return <p className="text-sm text-muted-foreground">–</p>;
  return (
    <ul className={cn("flex flex-col gap-1.5", tv ? "text-lg" : "text-sm")} data-testid="by-ref">
      {byRef.slice(0, 8).map(([ref, n]) => (
        <li key={ref} className="flex items-center gap-3">
          <span className="w-28 shrink-0 truncate font-mono text-xs text-ink-2">{ref === "(none)" ? noRef : ref}</span>
          <span className="h-3 rounded-full bg-plum" style={{ width: `${Math.max(2, (n / max) * 100)}%` }} aria-hidden />
          <span className="tnum font-semibold">{n.toLocaleString(intl)}</span>
        </li>
      ))}
    </ul>
  );
}

function LangToggle() {
  const { locale, setLocale } = useLocale();
  return (
    <ToggleGroup
      variant="segment"
      size="xs"
      spacing={0.5}
      value={[locale]}
      onValueChange={(value) => {
        const next = value[0];
        if (next === "tr" || next === "en") setLocale(next);
      }}
      aria-label="Language"
    >
      {(["tr", "en"] as const).map((l) => (
        <ToggleGroupItem key={l} value={l} aria-label={l}>
          {l}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export default function StatsPage() {
  return (
    <Suspense fallback={null}>
      <Stats />
    </Suspense>
  );
}
