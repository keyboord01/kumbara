"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePasskeyWallet, useSignTransaction } from "@sembol/passkey-react";
import { FailureScreen } from "@/components/FailureScreen";
import { NetworkBadge } from "@/components/NetworkBadge";
import { RequireWallet } from "@/components/RequireWallet";
import { ResumeNotice } from "@/components/ResumeNotice";
import { api } from "@/lib/api";
import { buildVaultDeposit } from "@/lib/autopilot";
import { EXPLORER_BASE, NETWORK_LABEL } from "@/lib/config";
import { classifyError, classifyRecordError, withTimeout, type Failure } from "@/lib/failures";
import { formatTry, formatUsdc } from "@/lib/format";
import { useLocale } from "@/lib/i18n";
import { DEFAULT_LIMIT_USDC } from "@/lib/limits";
import { useAnchorInfo } from "@/lib/useAnchorInfo";

type DepositStatus = "awaiting_transfer" | "transfer_received" | "onramp_pending" | "onramp_paid" | "forwarded" | "in_wallet" | "in_vault" | "failed" | "cancelled" | "abandoned";

interface DepositRecord {
  id: string;
  status: DepositStatus;
  createdAt: string;
  updatedAt: string;
  amountTry: string;
  receivedTry?: string;
  indicative: { usdcOut: string; rate: string; spreadBps: number };
  firmQuote?: { usdcOut: string; rate: string };
  instructions: { bankName: string; iban: string; ibanFormatted: string; accountHolder: string; reference: string };
  /** Bridge account the anchor pays; visible so a parked amount can be found. */
  landing?: { publicKey: string };
  transferDeadline?: string;
  anchorTxHash?: string;
  forwardTxHash?: string;
  vaultTxHash?: string;
  paidUsdc?: string;
  error?: { code: string; message: string };
  lastError?: { at: string; message: string; code?: string };
}

const STEP_ORDER: DepositStatus[] = ["awaiting_transfer", "transfer_received", "onramp_pending", "onramp_paid", "forwarded", "in_wallet", "in_vault"];
const FINAL: DepositStatus[] = ["in_vault", "failed", "cancelled", "abandoned"];
const WAIT_EXTENSION_MS = 30 * 60_000;
/** A vault deposit (simulation + passkey + relay) that takes longer than this becomes a retryable failure. */
const STEP_TIMEOUT_MS = 120_000;
/** Form failures where "try again" would only repeat the same amount. */
const AMOUNT_FAILURES = new Set(["invalid_amount", "anchor_rejected", "insufficient_balance"]);

function CopyButton({ value, label, copiedLabel }: { value: string; label: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn-secondary min-h-8 px-2.5 text-xs"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? copiedLabel : label}
    </button>
  );
}

function TxLink({ hash, label }: { hash: string; label: string }) {
  return (
    <a href={`${EXPLORER_BASE}/tx/${hash}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-teal hover:underline">
      {label} · {NETWORK_LABEL} ↗
    </a>
  );
}

function Deposit() {
  const { t, locale } = useLocale();
  const { kit, address } = usePasskeyWallet();
  const { info } = useAnchorInfo();
  const { signAndSubmit } = useSignTransaction();
  const [view, setView] = useState<"loading" | "form" | "waiting">("loading");
  const [amount, setAmount] = useState("100");
  const [record, setRecord] = useState<DepositRecord | null>(null);
  const [resumed, setResumed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [autopilot, setAutopilot] = useState<"idle" | "signing" | "needs_tap" | "done">("idle");
  const [autopilotFailure, setAutopilotFailure] = useState<Failure | null>(null);
  const autopilotStarted = useRef(false);
  const [usdTry, setUsdTry] = useState<number | null>(null);
  const [cancelling, setCancelling] = useState(false);
  /** True once an on-ramp has sat at the anchor for more than 90 s (set from the poll, not during render). */
  const [anchorWaiting, setAnchorWaiting] = useState(false);
  /** Wall clock as seen by the last poll tick; drives the transfer-timeout screen without reading Date.now() in render. */
  const [now, setNow] = useState(0);
  const [waitUntil, setWaitUntil] = useState(0);
  /** Set when the poll itself stops getting JSON (Vercel's login page): the presenter screen, while polling continues. */
  const [pollFailure, setPollFailure] = useState<Failure | null>(null);

  useEffect(() => {
    fetch("/api/rates")
      .then((r) => (r.ok ? (r.json() as Promise<{ usdTry: number }>) : null))
      .then((r) => r && setUsdTry(r.usdTry))
      .catch(() => undefined);
  }, []);

  const cancel = async () => {
    if (!record) return;
    setCancelling(true);
    try {
      const next = await api<DepositRecord>(`/api/deposit/${record.id}/cancel`, { method: "POST", body: "{}" });
      setRecord(next);
    } catch (err) {
      setFailure(classifyError(err, "generic"));
    } finally {
      setCancelling(false);
    }
  };

  // Resume an in-flight deposit after a reload (the phone locked, the tab was closed…).
  useEffect(() => {
    if (!address) return;
    let alive = true;
    api<{ active: DepositRecord | null }>(`/api/deposit?contractId=${address}`)
      .then((res) => {
        if (!alive) return;
        if (res.active) {
          setRecord(res.active);
          setResumed(true);
          setView("waiting");
        } else {
          setView("form");
        }
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setFailure(classifyError(err, "generic"));
        setView("form");
      });
    return () => {
      alive = false;
    };
  }, [address]);

  // Poll until the pipeline hands the USDC to the browser or finishes.
  const recordId = record?.id;
  const recordStatus = record?.status;
  useEffect(() => {
    if (!recordId || !recordStatus || FINAL.includes(recordStatus)) return;
    const tick = () => {
      setNow(Date.now());
      api<DepositRecord>(`/api/deposit/${recordId}`)
        .then((next) => {
          setRecord((current) => (current?.status === "in_vault" ? current : next));
          setAnchorWaiting(next.status === "onramp_pending" && Date.now() - Date.parse(next.updatedAt) > 90_000);
          setPollFailure(null);
        })
        .catch((err: unknown) => {
          const classified = classifyError(err, "generic");
          setPollFailure(classified.kind === "deployment_protected" ? classified : null);
        });
    };
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 3000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [recordId, recordStatus]);

  // Arrival autopilot: the USDC is in the smart account; put it in the vault.
  const runAutopilot = useCallback(async () => {
    if (!record || !kit || !info || !address || !record.paidUsdc) return;
    setAutopilot("signing");
    setAutopilotFailure(null);
    try {
      const tx = await withTimeout(buildVaultDeposit(kit, info.vault.id, address, record.paidUsdc), STEP_TIMEOUT_MS, "vault deposit simulation");
      const result = await withTimeout(signAndSubmit(tx), STEP_TIMEOUT_MS, "vault deposit");
      const next = await api<DepositRecord>(`/api/deposit/${record.id}/vault`, { method: "POST", body: JSON.stringify({ hash: result.hash, amountUsdc: record.paidUsdc }) });
      setRecord(next);
      setAutopilot("done");
    } catch (err) {
      const classified = classifyError(err, "vault");
      console.error("[kumbara] vault deposit failed", classified.kind, classified.detail);
      setAutopilotFailure(classified);
      setAutopilot("needs_tap");
    }
  }, [record, kit, info, address, signAndSubmit]);

  useEffect(() => {
    if (recordStatus !== "in_wallet" || autopilotStarted.current || !kit || !info) return;
    autopilotStarted.current = true;
    const kick = setTimeout(() => void runAutopilot(), 0);
    return () => clearTimeout(kick);
  }, [recordStatus, kit, info, runAutopilot]);

  const start = async () => {
    if (!address) return;
    setSubmitting(true);
    setFailure(null);
    try {
      const created = await api<DepositRecord>("/api/deposit", { method: "POST", body: JSON.stringify({ contractId: address, amountTry: amount }) });
      setRecord(created);
      setResumed(false);
      setView("waiting");
    } catch (err) {
      setFailure(classifyError(err, "anchor"));
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setRecord(null);
    setResumed(false);
    setAutopilot("idle");
    setAutopilotFailure(null);
    setFailure(null);
    setWaitUntil(0);
    autopilotStarted.current = false;
    setView("form");
  };

  const amountNumber = Number(amount.replace(",", "."));
  const treasuryUsdc = info?.treasuryUsdc ? Number(info.treasuryUsdc) : null;
  const estimatedUsdc = usdTry ? amountNumber / (usdTry * 1.005) : null;
  const overTreasury = treasuryUsdc !== null && estimatedUsdc !== null && estimatedUsdc > treasuryUsdc * 0.9;
  const amountValid = Number.isFinite(amountNumber) && amountNumber >= 50 && amountNumber <= 250_000 && !overTreasury;

  if (view === "loading") {
    return (
      <p className="py-16 text-center text-sm text-muted" role="status">
        {t.savings.loading}
      </p>
    );
  }

  if (view === "form") {
    return (
      <div className="flex flex-col gap-5 py-2">
        <div className="flex items-baseline justify-between">
          <h1 className="text-3xl font-bold tracking-tight">{t.deposit.title}</h1>
          <Link href="/kumbara" className="text-sm text-teal hover:underline">
            {t.deposit.backToSavings}
          </Link>
        </div>
        <form
          className="card flex flex-col gap-4 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (amountValid) void start();
          }}
        >
          <label className="flex flex-col gap-2">
            <span className="font-semibold">{t.deposit.lead}</span>
            <span className="microlabel">{t.deposit.amountLabel}</span>
            <input
              type="number"
              inputMode="decimal"
              min={50}
              max={250000}
              step="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="tnum rounded-xl border border-line bg-paper px-4 py-3 text-2xl font-semibold outline-none focus:border-teal"
              aria-describedby="deposit-limits"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            {t.deposit.quick.map((q) => (
              <button key={q} type="button" onClick={() => setAmount(String(q))} className="btn-secondary min-h-9 px-3 text-sm">
                ₺{q.toLocaleString(locale === "tr" ? "tr-TR" : "en-US")}
              </button>
            ))}
          </div>
          <p id="deposit-limits" className="text-xs text-muted">
            {t.deposit.limits}
          </p>
          {amountValid && amountNumber / 40 > Number(DEFAULT_LIMIT_USDC) ? <p className="text-sm text-amber">{t.deposit.limitWarning}</p> : null}
          {overTreasury && treasuryUsdc !== null ? (
            <p className="rounded-xl border border-amber/40 bg-amber/5 p-3 text-sm text-ink-2" role="alert">
              {t.deposit.treasuryCap.replace("{usdc}", Math.floor(treasuryUsdc).toLocaleString(locale === "tr" ? "tr-TR" : "en-US"))}
            </p>
          ) : null}
          {failure ? <FailureScreen failure={failure} compact primary={AMOUNT_FAILURES.has(failure.kind) ? null : undefined} onRetry={() => void start()} /> : null}
          <button type="submit" disabled={!amountValid || submitting || !address} className="btn-primary w-full text-lg">
            {submitting ? t.savings.loading : t.deposit.continue}
          </button>
        </form>
      </div>
    );
  }

  if (!record) return null;
  const currentIndex = STEP_ORDER.indexOf(record.status);
  const quote = record.firmQuote ?? record.indicative;
  const tryShown = record.receivedTry ?? record.amountTry;
  const deadline = record.transferDeadline ? Date.parse(record.transferDeadline) : null;
  const timedOut = record.status === "awaiting_transfer" && deadline !== null && now > 0 && now > Math.max(deadline, waitUntil);
  const waitedMinutes = now > 0 ? Math.max(1, Math.round((now - Date.parse(record.createdAt)) / 60_000)) : 0;
  const quoteRefreshing = record.status === "transfer_received" && record.lastError?.code === "quote_expired";
  const failed =
    record.status === "failed"
      ? classifyRecordError(record.error ?? { code: "step_failed", message: record.lastError?.message ?? "unknown" }, {
          landingAddress: record.landing?.publicKey,
          expected: record.firmQuote?.usdcOut,
          actual: record.paidUsdc,
        })
      : null;
  const parked = failed?.kind === "amount_mismatch" || failed?.kind === "usdc_not_received";

  return (
    <div className="flex flex-col gap-5 py-2">
      <div className="flex items-baseline justify-between">
        <h1 className="text-3xl font-bold tracking-tight">{t.deposit.title}</h1>
        <Link href="/kumbara" className="text-sm text-teal hover:underline">
          {t.deposit.backToSavings}
        </Link>
      </div>

      {resumed && !FINAL.includes(record.status) ? <ResumeNotice flow="deposit" /> : null}
      {pollFailure ? <FailureScreen failure={pollFailure} primary={null} /> : null}

      {failed ? (
        <FailureScreen
          failure={failed}
          primary={parked ? undefined : { label: t.deposit.newDeposit, onClick: reset }}
          secondary={parked ? { label: t.deposit.newDeposit, onClick: reset } : null}
        />
      ) : null}

      {timedOut ? (
        <FailureScreen
          failure={{ kind: "transfer_timeout", values: { minutes: String(waitedMinutes) }, detail: `reference ${record.instructions.reference}; deadline ${record.transferDeadline ?? "?"}` }}
          primary={{ label: t.failures.kinds.transfer_timeout.action, onClick: () => setWaitUntil(now + WAIT_EXTENSION_MS) }}
          secondary={{ label: t.failures.kinds.transfer_timeout.secondary, onClick: () => void cancel(), busy: cancelling }}
        />
      ) : null}

      <section className="card p-5" aria-label={t.deposit.quoteTitle}>
        <div className="flex items-center justify-between">
          <p className="microlabel">{t.deposit.quoteTitle}</p>
          <NetworkBadge />
        </div>
        <p className="tnum mt-2 text-3xl font-bold">
          {formatUsdc(quote.usdcOut, locale)} USDC
        </p>
        <p className="tnum mt-1 text-sm text-ink-2">
          {formatTry(Number(tryShown), locale)} · {t.deposit.rateLine} {Number(quote.rate).toLocaleString(locale === "tr" ? "tr-TR" : "en-US", { maximumFractionDigits: 4 })} ₺/USDC ({record.indicative.spreadBps} bps {t.deposit.spread})
        </p>
        {!record.firmQuote ? <p className="mt-1 text-xs text-muted">{t.deposit.indicative}</p> : null}
      </section>

      {record.status === "awaiting_transfer" ? (
        <section className="card p-5" aria-label={t.deposit.transferTitle}>
          <p className="microlabel">{t.deposit.transferTitle}</p>
          <dl className="mt-3 flex flex-col gap-3 text-sm">
            <div className="flex items-start justify-between gap-3">
              <dt className="text-muted">{t.deposit.bank}</dt>
              <dd className="text-right font-medium">{record.instructions.bankName}</dd>
            </div>
            <div className="flex items-start justify-between gap-3">
              <dt className="text-muted">{t.deposit.iban}</dt>
              <dd className="flex items-center gap-2 text-right">
                <span className="tnum font-mono text-sm font-medium">{record.instructions.ibanFormatted}</span>
                <CopyButton value={record.instructions.iban} label={t.deposit.copy} copiedLabel={t.deposit.copied} />
              </dd>
            </div>
            <div className="flex items-start justify-between gap-3">
              <dt className="text-muted">{t.deposit.recipient}</dt>
              <dd className="text-right font-medium">{record.instructions.accountHolder}</dd>
            </div>
            <div className="flex items-start justify-between gap-3">
              <dt className="text-muted">{t.deposit.amount}</dt>
              <dd className="tnum text-right font-medium">{formatTry(Number(record.amountTry), locale)}</dd>
            </div>
            <div className="flex items-start justify-between gap-3 rounded-xl bg-teal/5 p-3">
              <dt className="font-semibold text-teal">{t.deposit.description}</dt>
              <dd className="flex items-center gap-2 text-right">
                <span className="font-mono text-base font-bold" data-testid="deposit-reference">
                  {record.instructions.reference}
                </span>
                <CopyButton value={record.instructions.reference} label={t.deposit.copy} copiedLabel={t.deposit.copied} />
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-ink-2">{t.deposit.descriptionHint}</p>
          <p className="mt-2 text-xs text-muted">{t.deposit.sandbox}</p>
        </section>
      ) : null}

      <section className="card p-5" aria-label={t.deposit.statusTitle}>
        <p className="microlabel">{t.deposit.statusTitle}</p>
        <ol className="mt-3 flex flex-col gap-2" data-testid="deposit-status">
          {STEP_ORDER.filter((s) => ["awaiting_transfer", "transfer_received", "onramp_paid", "in_wallet", "in_vault"].includes(s)).map((s) => {
            const idx = STEP_ORDER.indexOf(s);
            const state = record.status === "failed" ? "idle" : idx < currentIndex ? "done" : idx === currentIndex || (s === "in_wallet" && record.status === "in_wallet") ? "current" : "idle";
            const active = record.status === s || (s === "transfer_received" && ["onramp_pending"].includes(record.status)) || (s === "onramp_paid" && record.status === "forwarded");
            return (
              <li key={s} className={`flex items-center gap-3 text-sm ${state === "done" ? "text-mint" : active || state === "current" ? "font-semibold text-ink" : "text-muted"}`}>
                <span className={`h-2.5 w-2.5 rounded-full ${state === "done" ? "bg-mint" : active || state === "current" ? "bg-coral" : "bg-line"}`} aria-hidden />
                {t.deposit.steps[s]}
              </li>
            );
          })}
        </ol>
        <p className="mt-3 text-base font-semibold" role="status" aria-live="polite" data-testid="deposit-current">
          {t.deposit.steps[record.status]}
        </p>
        {quoteRefreshing ? (
          <p className="mt-1 text-sm text-amber" role="status">
            {t.failures.quoteRefreshing}
          </p>
        ) : null}
        {record.status === "in_wallet" && autopilot === "signing" ? (
          <p className="mt-2 text-sm text-ink-2" role="status">
            {t.deposit.autopilotSigning}
          </p>
        ) : null}
        {record.status === "in_wallet" && autopilot === "needs_tap" ? (
          autopilotFailure ? (
            <FailureScreen
              failure={autopilotFailure}
              compact
              className="mt-3"
              primary={autopilotFailure.kind === "limit_exceeded" ? undefined : { label: t.deposit.autopilotButton, onClick: () => void runAutopilot() }}
              secondary={autopilotFailure.kind === "limit_exceeded" ? { label: t.deposit.autopilotButton, onClick: () => void runAutopilot() } : null}
            />
          ) : (
            <div className="mt-3 rounded-xl border border-amber/40 bg-amber/5 p-3">
              <p className="text-sm text-ink-2">{t.deposit.autopilotNeedsTap}</p>
              <button type="button" onClick={() => void runAutopilot()} className="btn-primary mt-3 min-h-10 px-4 text-sm">
                {t.deposit.autopilotButton}
              </button>
            </div>
          )
        ) : null}
        {record.anchorTxHash || record.forwardTxHash || record.vaultTxHash ? (
          <div className="mt-4 flex flex-col gap-1">
            {record.anchorTxHash ? <TxLink hash={record.anchorTxHash} label={t.deposit.links.anchor} /> : null}
            {record.forwardTxHash ? <TxLink hash={record.forwardTxHash} label={t.deposit.links.forward} /> : null}
            {record.vaultTxHash ? <TxLink hash={record.vaultTxHash} label={t.deposit.links.vault} /> : null}
          </div>
        ) : null}
      </section>

      {record.status === "onramp_pending" && anchorWaiting ? (
        <section className="card border-amber/40 bg-amber/5 p-4" aria-label={t.deposit.abandonTitle}>
          <p className="font-semibold text-ink">{t.deposit.abandonTitle}</p>
          <p className="mt-1 text-sm text-ink-2">{t.deposit.abandonBody}</p>
          <button type="button" onClick={() => void cancel()} disabled={cancelling} className="btn-secondary mt-3 w-full">
            {cancelling ? t.savings.loading : t.deposit.abandon}
          </button>
        </section>
      ) : null}
      {failure && record.status !== "failed" ? <FailureScreen failure={failure} compact primary={null} /> : null}
      <div className="flex flex-col gap-2">
        {record.status === "in_vault" ? (
          <Link href="/kumbara" className="btn-primary w-full">
            {t.deposit.backToSavings}
          </Link>
        ) : null}
        {record.status === "abandoned" ? <p className="text-center text-sm text-ink-2">{t.deposit.abandoned}</p> : null}
        {FINAL.includes(record.status) && record.status !== "failed" ? (
          <button type="button" onClick={reset} className="btn-secondary w-full">
            {t.deposit.newDeposit}
          </button>
        ) : null}
        {record.status === "awaiting_transfer" && !timedOut ? (
          <>
            <button type="button" onClick={() => void cancel()} disabled={cancelling} className="btn-secondary w-full">
              {cancelling ? t.savings.loading : t.deposit.cancel}
            </button>
            <p className="text-center text-xs text-muted">{t.deposit.cancelHint}</p>
          </>
        ) : null}
      </div>
    </div>
  );
}

export default function DepositPage() {
  return (
    <RequireWallet>
      <Deposit />
    </RequireWallet>
  );
}
