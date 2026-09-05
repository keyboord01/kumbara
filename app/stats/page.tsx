"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { NetworkBadge } from "@/components/NetworkBadge";
import { EXPLORER_BASE, NETWORK, NETWORK_LABEL, sembolConfig } from "@/lib/config";
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
interface Snapshot {
  generatedAt: string;
  since: number;
  headline: Totals & { usdcInVault: string | null; vaultId: string; strategyId: string | null };
  allTime: Totals;
  feed: FeedItem[];
  buckets: { minutes: number; from: number; to: number; series: Array<{ start: number; accounts: number }> };
  accounts: { byRef: Record<string, number> };
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

function ExplorerLink({ href, label, tv }: { href: string; label: string; tv: boolean }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={`${tv ? "text-base" : "text-sm"} text-teal underline-offset-2 hover:underline`}>
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
  // Before BOOTH_START_TS the "since event start" window is empty by definition: show all-time numbers instead.
  const eventStarted = snapshot ? snapshot.since * 1000 <= updatedAt : true;
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
    <div className={`mx-auto flex w-full ${tv ? "max-w-6xl px-6 py-6" : "max-w-3xl px-4 py-5"} flex-col gap-6`}>
      {!tv ? (
        <header className="flex items-center justify-between gap-3">
          <Link href="/" className="flex items-baseline gap-2">
            <span className="text-lg font-bold tracking-tight text-teal">{t.brand}</span>
            <span className="text-xs text-muted">{t.bySembol}</span>
          </Link>
          <div className="flex items-center gap-2">
            <NetworkBadge />
            <LangToggle />
          </div>
        </header>
      ) : null}

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className={`${tv ? "text-4xl" : "text-3xl"} font-bold tracking-tight text-ink`}>{t.stats.title}</h1>
          <div className="flex items-center gap-3 text-xs text-muted" data-testid="live">
            <span className="inline-flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mint opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-mint" />
              </span>
              {t.stats.live}
            </span>
            {updatedAt ? <span className="tnum">{t.stats.updated} {new Date(updatedAt).toLocaleTimeString(intl)}</span> : null}
          </div>
        </div>
        <p className="text-sm text-ink-2">{t.stats.lead}</p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-full border border-line text-xs font-semibold" role="group" aria-label={t.stats.windowEvent}>
            {(["event", "all"] as const).map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setWindow(w)}
                disabled={w === "event" && !eventStarted}
                aria-pressed={effectiveWindow === w}
                className={`px-3 py-1.5 ${effectiveWindow === w ? "bg-teal text-white" : "bg-white text-ink-2"} disabled:opacity-50`}
                data-testid={`window-${w}`}
              >
                {w === "event" ? t.stats.windowEvent : t.stats.windowAll}
              </button>
            ))}
          </div>
          {snapshot && !eventStarted ? (
            <span className="text-xs text-muted" data-testid="event-not-started">
              {t.stats.eventStarts.replace("{date}", new Date(snapshot.since * 1000).toLocaleDateString(intl, { day: "numeric", month: "long" }))}
            </span>
          ) : null}
        </div>
      </section>

      <section className={`grid gap-3 ${tv ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-3"}`} data-testid="headline" aria-label={t.stats.title}>
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
          <div key={key} className="card flex flex-col gap-1 p-4">
            <p className={`tnum ${key === "tryIn" || key === "tryOut" || key === "usdcInVault" ? (tv ? "text-3xl sm:text-4xl" : "text-2xl") : bigNumber} font-bold leading-none text-ink`} data-testid={`headline-${key}`}>
              {value}
            </p>
            <p className="flex flex-wrap items-center gap-2 text-xs text-ink-2">
              <span>{label}</span>
              {isMoney || key === "accounts" || key === "deposits" || key === "withdrawals" ? <NetworkBadge /> : null}
            </p>
          </div>
        ))}
      </section>

      <div className={`grid gap-6 ${tv ? "grid-cols-2" : "grid-cols-1"}`}>
        <section className="card p-5" aria-label={t.stats.feedTitle} data-testid="feed">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">{t.stats.feedTitle}</h2>
            <NetworkBadge />
          </div>
          {feed.length === 0 ? (
            <p className="mt-3 text-sm text-muted" data-testid="feed-empty">
              {t.stats.feedEmpty}
            </p>
          ) : (
            <ul className="mt-3 flex flex-col divide-y divide-line">
              {feed.slice(0, tv ? 12 : 20).map((item) => (
                <li key={`${item.type}-${item.ts}-${item.hash ?? ""}`} className={`flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2 ${tv ? "text-base" : "text-sm"}`} data-testid="feed-item">
                  <span className="flex items-baseline gap-2">
                    <span className="font-mono text-xs text-ink-2">{item.contractId ? shortAddress(item.contractId, 4) : "–"}</span>
                    <span className="text-ink">{t.stats.feed[item.type]}</span>
                    {item.usdc ? <span className="tnum font-semibold">{formatUsdc(item.usdc, locale)} USDC</span> : null}
                    {item.try ? <span className="tnum text-ink-2">({formatTry(Number(item.try), locale)})</span> : null}
                  </span>
                  <span className="flex items-baseline gap-3 text-xs text-muted">
                    <span className="tnum">{ago(item.ts)}</span>
                    {item.link ? (
                      <a href={item.link} target="_blank" rel="noreferrer" className="text-teal hover:underline">
                        {NETWORK_LABEL} ↗
                      </a>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card p-5" aria-label={t.stats.curveTitle} data-testid="curve">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">{showRefChart ? t.stats.byRef : t.stats.curveTitle}</h2>
            {snapshot ? <p className="text-xs text-muted">{showRefChart ? "" : t.stats.curveHint.replace("{minutes}", String(snapshot.buckets.minutes))}</p> : null}
          </div>
          {showRefChart ? (
            <RefBars byRef={byRef} noRef={t.stats.noRef} intl={intl} tv={tv} />
          ) : (
            <svg viewBox={`0 0 ${Math.max(series.length, 1) * 10} 120`} preserveAspectRatio="none" className={`mt-3 w-full ${tv ? "h-56" : "h-32"}`} role="img" aria-label={t.stats.curveTitle}>
              {series.map((b, i) => {
                const h = (b.accounts / maxBucket) * 110;
                return <rect key={b.start} x={i * 10 + 1} y={115 - h} width={8} height={h} rx={1.5} fill="#0f6b6b" opacity={b.accounts ? 1 : 0.15} />;
              })}
              <line x1={0} y1={116} x2={Math.max(series.length, 1) * 10} y2={116} stroke="#e3dccd" strokeWidth={1} />
            </svg>
          )}
          {!showRefChart && snapshot ? (
            <p className="tnum mt-1 flex justify-between text-[11px] text-muted">
              <span>{new Date(snapshot.buckets.from).toLocaleString(intl, { dateStyle: "short", timeStyle: "short" })}</span>
              <span>{new Date(snapshot.buckets.to).toLocaleString(intl, { dateStyle: "short", timeStyle: "short" })}</span>
            </p>
          ) : null}
          {!tv ? (
            <div className="mt-4">
              <h3 className="microlabel">{t.stats.byRef}</h3>
              <RefBars byRef={byRef} noRef={t.stats.noRef} intl={intl} tv={false} />
            </div>
          ) : null}
        </section>
      </div>

      <section className="card p-5" aria-label={t.stats.timingsTitle} data-testid="timings">
        <h2 className="font-semibold">{t.stats.timingsTitle}</h2>
        <dl className={`mt-3 grid gap-3 ${tv ? "grid-cols-3" : "grid-cols-1 sm:grid-cols-3"}`}>
          {(["tapToReady", "deposit", "withdraw"] as const).map((key) => {
            const timing = snapshot?.timings[key];
            const enough = timing && timing.medianMs !== null;
            return (
              <div key={key} className="rounded-xl bg-paper-2 p-3">
                <dt className="text-sm text-ink-2">{t.stats.timings[key]}</dt>
                <dd className="mt-1">
                  {enough ? (
                    <p className={`tnum ${tv ? "text-3xl" : "text-xl"} font-bold`}>
                      {seconds(timing.medianMs)} <span className="text-xs font-normal text-muted">{t.stats.median}</span>
                      <span className="ml-2 text-sm font-semibold text-ink-2">{seconds(timing.p90Ms)}</span> <span className="text-xs font-normal text-muted">{t.stats.p90}</span>
                    </p>
                  ) : (
                    <p className="text-sm font-semibold text-amber">{t.stats.notEnough}</p>
                  )}
                  <p className="tnum mt-1 text-xs text-muted">
                    {timing ? t.stats.samples.replace("{n}", String(timing.n)) : "–"}
                    {timing && !enough && snapshot ? ` · ${t.stats.minSamples.replace("{n}", String(snapshot.timings.minSamples))}` : ""}
                  </p>
                </dd>
              </div>
            );
          })}
        </dl>
      </section>

      {!tv ? (
        <section className="card p-5" aria-label={t.stats.contractsTitle} data-testid="contracts">
          <h2 className="font-semibold">{t.stats.contractsTitle}</h2>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
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
                {id ? <ExplorerLink href={`${EXPLORER_BASE}/contract/${id}`} label={shortAddress(id, 6)} tv={false} /> : <span className="text-muted">–</span>}
              </li>
            ))}
          </ul>
          <ul className="mt-4 flex flex-col gap-1.5 text-sm text-ink-2">
            {(["anchor", "defindex", "oz", "relay", "reflector"] as const).map((k) => (
              <li key={k}>{t.stats.integrations[k]}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {!tv ? (
        <section className="card p-5" aria-label={t.stats.howTitle} data-testid="how">
          <h2 className="font-semibold">{t.stats.howTitle}</h2>
          <ol className="mt-3 flex flex-col gap-2 text-sm text-ink-2">
            {t.stats.how.map((step, i) => (
              <li key={step} className="flex gap-3">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-teal/10 text-xs font-semibold text-teal">{i + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <a href="https://github.com/keyboord01/kumbara" target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm text-teal hover:underline">
            {t.stats.repo} ↗
          </a>
        </section>
      ) : null}

      {!tv ? (
        <section className="card p-5" aria-label={t.stats.healthTitle} data-testid="health">
          <h2 className="font-semibold">{t.stats.healthTitle}</h2>
          <ul className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            {(["anchor", "relay", "rpc", "vault"] as const).map((name) => {
              const dep = deps?.[name];
              return (
                <li key={name} className="flex items-center gap-2">
                  <span className={`h-3 w-3 rounded-full ${dep ? (dep.ok ? "bg-mint" : "bg-danger") : "bg-line"}`} aria-label={dep ? (dep.ok ? "ok" : "down") : "unknown"} />
                  <span>{t.admin.healthNames[name]}</span>
                </li>
              );
            })}
          </ul>
          <div className="mt-4">
            <p className="text-sm text-ink-2">{t.stats.sponsor}</p>
            <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-paper-2" role="img" aria-label={t.stats.sponsor}>
              <div className={`h-full rounded-full ${health?.sponsor?.ok ? "bg-mint" : "bg-danger"}`} style={{ width: `${sponsorRatio === null ? 0 : Math.min(100, (sponsorRatio / 5) * 100)}%` }} />
            </div>
            <p className="tnum mt-1 text-xs text-muted" data-testid="sponsor-ratio">
              {sponsorRatio === null ? "–" : `${sponsorRatio.toFixed(1)}×`}
            </p>
          </div>
        </section>
      ) : null}

      <footer className="mt-auto flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span>{NETWORK === "testnet" ? t.footer : t.footerMainnet}</span>
        {!tv ? (
          <Link href="/stats?mode=tv" className="hover:text-teal">
            {t.stats.tv} →
          </Link>
        ) : null}
      </footer>
    </div>
  );
}

function RefBars({ byRef, noRef, intl, tv }: { byRef: Array<[string, number]>; noRef: string; intl: string; tv: boolean }) {
  const max = Math.max(1, ...byRef.map(([, n]) => n));
  if (byRef.length === 0) return <p className="mt-2 text-sm text-muted">–</p>;
  return (
    <ul className={`mt-2 flex flex-col gap-1.5 ${tv ? "text-lg" : "text-sm"}`} data-testid="by-ref">
      {byRef.slice(0, 8).map(([ref, n]) => (
        <li key={ref} className="flex items-center gap-3">
          <span className="w-28 shrink-0 truncate font-mono text-xs text-ink-2">{ref === "(none)" ? noRef : ref}</span>
          <span className="h-3 rounded-full bg-teal" style={{ width: `${Math.max(2, (n / max) * 100)}%` }} aria-hidden />
          <span className="tnum font-semibold">{n.toLocaleString(intl)}</span>
        </li>
      ))}
    </ul>
  );
}

function LangToggle() {
  const { locale, setLocale } = useLocale();
  return (
    <div className="flex overflow-hidden rounded-full border border-line text-xs font-semibold" role="group" aria-label="Language">
      {(["tr", "en"] as const).map((l) => (
        <button key={l} type="button" onClick={() => setLocale(l)} aria-pressed={locale === l} className={`px-2.5 py-1 uppercase ${locale === l ? "bg-teal text-white" : "bg-white text-ink-2"}`}>
          {l}
        </button>
      ))}
    </div>
  );
}

export default function StatsPage() {
  return (
    <Suspense fallback={null}>
      <Stats />
    </Suspense>
  );
}
