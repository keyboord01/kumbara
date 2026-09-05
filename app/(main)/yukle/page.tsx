"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toSembolError, usePasskeyWallet, useSignTransaction, type SembolError } from "@sembol/passkey-react";
import { NetworkBadge } from "@/components/NetworkBadge";
import { RequireWallet } from "@/components/RequireWallet";
import { EXPLORER_BASE, NETWORK_LABEL } from "@/lib/config";
import { formatTry, formatUsdc } from "@/lib/format";
import { buildVaultDeposit } from "@/lib/autopilot";
import { useLocale } from "@/lib/i18n";
import { DEFAULT_LIMIT_USDC } from "@/lib/limits";
import { useAnchorInfo } from "@/lib/useAnchorInfo";

type DepositStatus = "awaiting_transfer" | "transfer_received" | "onramp_pending" | "onramp_paid" | "forwarded" | "in_wallet" | "in_vault" | "failed";

interface DepositRecord {
  id: string;
  status: DepositStatus;
  amountTry: string;
  receivedTry?: string;
  indicative: { usdcOut: string; rate: string; spreadBps: number };
  firmQuote?: { usdcOut: string; rate: string };
  instructions: { bankName: string; iban: string; ibanFormatted: string; accountHolder: string; reference: string };
  anchorTxHash?: string;
  forwardTxHash?: string;
  vaultTxHash?: string;
  paidUsdc?: string;
  error?: { code: string; message: string };
  lastError?: { at: string; message: string };
}

const STEP_ORDER: DepositStatus[] = ["awaiting_transfer", "transfer_received", "onramp_pending", "onramp_paid", "forwarded", "in_wallet", "in_vault"];
const FINAL: DepositStatus[] = ["in_vault", "failed"];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const body = (await res.json()) as T & { error?: { code: string; message: string } };
  if (!res.ok) throw new Error(body.error?.message ?? `HTTP ${res.status}`);
  return body;
}

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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autopilot, setAutopilot] = useState<"idle" | "signing" | "needs_tap" | "done">("idle");
  const [autopilotError, setAutopilotError] = useState<SembolError | null>(null);
  const autopilotStarted = useRef(false);

  // Resume an in-flight deposit after a reload.
  useEffect(() => {
    if (!address) return;
    let alive = true;
    api<{ active: DepositRecord | null }>(`/api/deposit?contractId=${address}`)
      .then((res) => {
        if (!alive) return;
        if (res.active) {
          setRecord(res.active);
          setView("waiting");
        } else {
          setView("form");
        }
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setError(err instanceof Error ? err.message : String(err));
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
    const id = setInterval(() => {
      api<DepositRecord>(`/api/deposit/${recordId}`)
        .then((next) => setRecord((current) => (current?.status === "in_vault" ? current : next)))
        .catch(() => undefined);
    }, 3000);
    return () => clearInterval(id);
  }, [recordId, recordStatus]);

  // Arrival autopilot: the USDC is in the smart account; put it in the vault.
  const runAutopilot = useCallback(async () => {
    if (!record || !kit || !info || !address || !record.paidUsdc) return;
    setAutopilot("signing");
    setAutopilotError(null);
    try {
      const tx = await buildVaultDeposit(kit, info.vault.id, address, record.paidUsdc);
      const result = await signAndSubmit(tx);
      const next = await api<DepositRecord>(`/api/deposit/${record.id}/vault`, { method: "POST", body: JSON.stringify({ hash: result.hash, amountUsdc: record.paidUsdc }) });
      setRecord(next);
      setAutopilot("done");
    } catch (err) {
      const sembolError = toSembolError(err);
      console.error("[kumbara] vault deposit failed", sembolError.code, sembolError.message);
      setAutopilotError(sembolError);
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
    setError(null);
    try {
      const created = await api<DepositRecord>("/api/deposit", { method: "POST", body: JSON.stringify({ contractId: address, amountTry: amount }) });
      setRecord(created);
      setView("waiting");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setRecord(null);
    setAutopilot("idle");
    autopilotStarted.current = false;
    setView("form");
  };

  const amountNumber = Number(amount.replace(",", "."));
  const amountValid = Number.isFinite(amountNumber) && amountNumber >= 50 && amountNumber <= 250_000;

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
          {amountValid && amountNumber / 40 > Number(DEFAULT_LIMIT_USDC) && <p className="text-sm text-amber">{t.deposit.limitWarning}</p>}
          {error && (
            <p className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger" role="alert">
              {error}
            </p>
          )}
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

  return (
    <div className="flex flex-col gap-5 py-2">
      <div className="flex items-baseline justify-between">
        <h1 className="text-3xl font-bold tracking-tight">{t.deposit.title}</h1>
        <Link href="/kumbara" className="text-sm text-teal hover:underline">
          {t.deposit.backToSavings}
        </Link>
      </div>

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
        {!record.firmQuote && <p className="mt-1 text-xs text-muted">{t.deposit.indicative}</p>}
      </section>

      {record.status === "awaiting_transfer" && (
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
      )}

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
        {record.status === "failed" && (
          <p className="mt-2 rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger" role="alert">
            {record.error?.message ?? record.lastError?.message}
          </p>
        )}
        {record.status === "in_wallet" && autopilot === "signing" && (
          <p className="mt-2 text-sm text-ink-2" role="status">
            {t.deposit.autopilotSigning}
          </p>
        )}
        {record.status === "in_wallet" && autopilot === "needs_tap" && (
          <div className="mt-3 rounded-xl border border-amber/40 bg-amber/5 p-3">
            <p className="text-sm text-ink-2">{autopilotError?.code === "user_cancelled" ? t.deposit.autopilotNeedsTap : (autopilotError?.userMessage ?? t.deposit.autopilotNeedsTap)}</p>
            <button type="button" onClick={() => void runAutopilot()} className="btn-primary mt-3 min-h-10 px-4 text-sm">
              {t.deposit.autopilotButton}
            </button>
          </div>
        )}
        {(record.anchorTxHash || record.forwardTxHash || record.vaultTxHash) && (
          <div className="mt-4 flex flex-col gap-1">
            {record.anchorTxHash && <TxLink hash={record.anchorTxHash} label={t.deposit.links.anchor} />}
            {record.forwardTxHash && <TxLink hash={record.forwardTxHash} label={t.deposit.links.forward} />}
            {record.vaultTxHash && <TxLink hash={record.vaultTxHash} label={t.deposit.links.vault} />}
          </div>
        )}
      </section>

      <div className="flex flex-col gap-2">
        {record.status === "in_vault" && (
          <Link href="/kumbara" className="btn-primary w-full">
            {t.deposit.backToSavings}
          </Link>
        )}
        {FINAL.includes(record.status) && (
          <button type="button" onClick={reset} className="btn-secondary w-full">
            {t.deposit.newDeposit}
          </button>
        )}
        {record.status === "awaiting_transfer" && <p className="text-center text-xs text-muted">{t.deposit.cancelHint}</p>}
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
