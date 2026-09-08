"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Address, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { buildContractCallTransaction, buildTransferTransaction, usePasskeyWallet, useSignTransaction, useSpendingPolicy } from "@sembol/passkey-react";
import { FailureScreen } from "@/components/FailureScreen";
import { NetworkBadge } from "@/components/NetworkBadge";
import { RequireWallet } from "@/components/RequireWallet";
import { ResumeNotice } from "@/components/ResumeNotice";
import { api } from "@/lib/api";
import { EXPLORER_BASE, NETWORK_LABEL, sembolConfig } from "@/lib/config";
import { StepTimeoutError, classifyError, classifyRecordError, withTimeout, type Failure } from "@/lib/failures";
import { formatTry, formatUsdc } from "@/lib/format";
import { useLocale } from "@/lib/i18n";
import { useAnchorInfo } from "@/lib/useAnchorInfo";
import { readVaultPosition, readVaultTotals, sharesForAmount, type VaultPosition } from "@/lib/vault";

type WithdrawalStatus = "created" | "awaiting_usdc" | "usdc_sent" | "paid" | "completed" | "failed";

interface WithdrawalRecord {
  id: string;
  status: WithdrawalStatus;
  amountUsdc: string;
  quote: { tryOut: string; rate: string; spreadBps: number };
  memoId: string;
  payoutIban: string | null;
  landing?: { publicKey: string };
  vaultTxHash?: string;
  transferTxHash?: string;
  paymentTxHash?: string;
  receivedUsdc?: string;
  amountTry?: string;
  payoutId?: string;
  error?: { code: string; message: string };
  lastError?: { at: string; message: string };
}

interface Quote {
  amount: string;
  tryOut: string;
  rate: string;
  spreadBps: number;
  /** When it was fetched (ms); the anchor's quotes are good for 120 s. */
  at: number;
}

const FINAL: WithdrawalStatus[] = ["completed", "failed"];
const QUOTE_TTL_MS = 120_000;
/** A client step (simulation + passkey + relay) that takes longer than this becomes a retryable failure. */
const STEP_TIMEOUT_MS = 120_000;

/** Simulations and reads are safe to repeat; one automatic retry when the first attempt stalls. Signing is never retried here. */
async function retryOnceOnTimeout<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof StepTimeoutError) return run();
    throw err;
  }
}
const AMOUNT_FAILURES = new Set(["invalid_amount", "anchor_rejected", "insufficient_balance"]);
const toStroops = (amount: string): bigint => {
  const [whole = "0", frac = ""] = amount.replace(",", ".").split(".");
  return BigInt(whole || "0") * 10_000_000n + BigInt((frac + "0000000").slice(0, 7));
};
const floor2 = (stroops: bigint): string => {
  const cents = stroops / 100_000n;
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
};

function TxLink({ hash, label }: { hash: string; label: string }) {
  return (
    <a href={`${EXPLORER_BASE}/tx/${hash}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-teal hover:underline">
      {label} · {NETWORK_LABEL} ↗
    </a>
  );
}

function maskIban(iban: string | null): string {
  if (!iban) return "–";
  return `${iban.slice(0, 4)} …${iban.slice(-4)}`;
}

function Withdraw() {
  const { t, locale } = useLocale();
  const { kit, address } = usePasskeyWallet();
  const { info } = useAnchorInfo();
  const { signAndSubmit } = useSignTransaction();
  const usdcToken = info ? { contractId: info.usdc.contractId } : ("native" as const);
  const { policy } = useSpendingPolicy(usdcToken);
  const [view, setView] = useState<"loading" | "form" | "progress">("loading");
  const [position, setPosition] = useState<VaultPosition | null>(null);
  const [amount, setAmount] = useState("1");
  const [quoteFor, setQuoteFor] = useState<Quote | null>(null);
  const [quoteEpoch, setQuoteEpoch] = useState(0);
  const [quoteAge, setQuoteAge] = useState(0);
  const [record, setRecord] = useState<WithdrawalRecord | null>(null);
  const [resumed, setResumed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [client, setClient] = useState<"idle" | "vault" | "transfer" | "needs_tap" | "done">("idle");
  const [clientFailure, setClientFailure] = useState<Failure | null>(null);
  const vaultTx = useRef<string | null>(null);
  const transferTx = useRef<string | null>(null);
  const running = useRef(false);
  const [vaultTxHash, setVaultTxHash] = useState<string | null>(null);
  const started = useRef(false);
  /** Set when the poll itself stops getting JSON (Vercel's login page): the presenter screen, while polling continues. */
  const [pollFailure, setPollFailure] = useState<Failure | null>(null);

  const loadPosition = useCallback(async () => {
    if (!info || !address) return;
    try {
      setPosition(await readVaultPosition(sembolConfig.rpcUrl, sembolConfig.networkPassphrase, info.vault.id, address));
    } catch {
      /* retried by the next call */
    }
  }, [info, address]);

  // Resume an in-flight withdrawal after a reload. A vault withdrawal that
  // already happened is remembered server-side, so it is never signed twice.
  useEffect(() => {
    if (!address) return;
    let alive = true;
    const first = setTimeout(() => void loadPosition(), 0);
    api<{ active: WithdrawalRecord | null }>(`/api/withdraw?contractId=${address}`)
      .then((res) => {
        if (!alive) return;
        if (res.active) {
          if (res.active.vaultTxHash) {
            vaultTx.current = res.active.vaultTxHash;
            setVaultTxHash(res.active.vaultTxHash);
          }
          setRecord(res.active);
          setResumed(true);
          setView("progress");
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
      clearTimeout(first);
    };
  }, [address, loadPosition]);

  // Indicative sell quote, debounced; shown only while it matches the typed amount.
  useEffect(() => {
    if (view !== "form" || !address) return;
    if (toStroops(amount || "0") < 10_000_000n) return;
    const wanted = amount;
    const handle = setTimeout(() => {
      api<{ tryOut: string; rate: string; spreadBps: number }>(`/api/withdraw/quote?contractId=${address}&amountUsdc=${encodeURIComponent(wanted.replace(",", "."))}`)
        .then((q) => setQuoteFor({ amount: wanted, ...q, at: Date.now() }))
        .catch(() => undefined);
    }, 400);
    return () => clearTimeout(handle);
  }, [amount, address, view, quoteEpoch]);

  // Quotes expire after 120 s: show their age and fetch a fresh one when they do.
  const quoteAt = quoteFor?.at ?? 0;
  useEffect(() => {
    if (!quoteAt || view !== "form") return;
    const id = setInterval(() => {
      const age = Date.now() - quoteAt;
      setQuoteAge(age);
      if (age > QUOTE_TTL_MS) setQuoteEpoch((e) => e + 1);
    }, 5000);
    return () => clearInterval(id);
  }, [quoteAt, view]);
  const quote = quoteFor && quoteFor.amount === amount ? quoteFor : null;

  // Poll while the server side has work to do.
  const recordId = record?.id;
  const recordStatus = record?.status;
  useEffect(() => {
    if (!recordId || !recordStatus || FINAL.includes(recordStatus)) return;
    const id = setInterval(() => {
      api<WithdrawalRecord>(`/api/withdraw/${recordId}`)
        .then((next) => {
          setRecord(next);
          setPollFailure(null);
        })
        .catch((err: unknown) => {
          const classified = classifyError(err, "generic");
          setPollFailure(classified.kind === "deployment_protected" ? classified : null);
        });
    }, 3000);
    return () => clearInterval(id);
  }, [recordId, recordStatus]);

  // The browser's part: vault withdrawal, then the transfer to the landing account.
  const runClientSteps = useCallback(async () => {
    if (!record || !kit || !info || !address) return;
    if (running.current) return; // the poll effect re-kicks every 3 s; never overlap two runs (two transfers)
    running.current = true;
    setClientFailure(null);
    let stepContext: "vault" | "relay" = "vault";
    try {
      const amountStroops = toStroops(record.amountUsdc);
      if (!vaultTx.current) {
        setClient("vault");
        const totals = await retryOnceOnTimeout(() => withTimeout(readVaultTotals(sembolConfig.rpcUrl, sembolConfig.networkPassphrase, info.vault.id), STEP_TIMEOUT_MS, "vault totals"));
        const shares = sharesForAmount(amountStroops, totals);
        const tx = await retryOnceOnTimeout(() => withTimeout(
          buildContractCallTransaction(kit, {
            contractId: info.vault.id,
            method: "withdraw",
            args: [nativeToScVal(shares, { type: "i128" }), xdr.ScVal.scvVec([nativeToScVal(amountStroops, { type: "i128" })]), Address.fromString(address).toScVal()],
          }),
          STEP_TIMEOUT_MS,
          "vault withdrawal simulation",
        ));
        console.info(`[kumbara] withdraw ${record.id}: vault withdrawal simulated, signing`);
        const result = await withTimeout(signAndSubmit(tx), STEP_TIMEOUT_MS, "vault withdrawal");
        vaultTx.current = result.hash;
        setVaultTxHash(result.hash);
        console.info(`[kumbara] withdraw ${record.id}: vault withdrawal ${result.hash.slice(0, 8)} confirmed`);
        // Remember it server-side so a reload never repeats the vault withdrawal.
        await api(`/api/withdraw/${record.id}/vault`, { method: "POST", body: JSON.stringify({ vaultTx: result.hash }) }).catch((err: unknown) => {
          console.warn(`[kumbara] withdraw ${record.id}: could not record the vault withdrawal yet: ${err instanceof Error ? err.message : String(err)}`);
        });
      }
      if (!record.landing) {
        console.info(`[kumbara] withdraw ${record.id}: bridge not ready yet (status ${record.status}); waiting for the next poll`);
        return; // the poll effect re-triggers once the record carries the bridge
      }
      stepContext = "relay";
      setClient("transfer");
      if (!transferTx.current) {
        // Sign the transfer at most once per withdrawal: a retry after a stalled record call must not send the USDC twice.
        console.info(`[kumbara] withdraw ${record.id}: simulating the transfer to the bridge`);
        const transfer = await retryOnceOnTimeout(() => withTimeout(buildTransferTransaction(kit, { tokenContract: info.usdc.contractId, to: record.landing!.publicKey, amount: record.amountUsdc }), STEP_TIMEOUT_MS, "transfer simulation"));
        console.info(`[kumbara] withdraw ${record.id}: transfer simulated, signing`);
        const sent = await withTimeout(signAndSubmit(transfer), STEP_TIMEOUT_MS, "transfer");
        transferTx.current = sent.hash;
        console.info(`[kumbara] withdraw ${record.id}: transfer ${sent.hash.slice(0, 8)} confirmed`);
      }
      const next = await api<WithdrawalRecord>(`/api/withdraw/${record.id}/sent`, { method: "POST", body: JSON.stringify({ vaultTx: vaultTx.current, transferTx: transferTx.current }) });
      if (next.status === "awaiting_usdc") throw new StepTimeoutError("the server did not record the transfer yet; tap to report it again");
      setRecord(next);
      setClient("done");
      console.info(`[kumbara] withdraw ${record.id}: both transactions reported; the server pays the anchor now`);
    } catch (err) {
      const classified = classifyError(err, stepContext);
      console.error("[kumbara] withdraw client step failed", classified.kind, classified.detail);
      setClientFailure(classified);
      setClient("needs_tap");
    } finally {
      running.current = false;
    }
  }, [record, kit, info, address, signAndSubmit]);

  useEffect(() => {
    if (!record || !kit || !info) return;
    let kick: ReturnType<typeof setTimeout> | null = null;
    if (record.status === "created" && !started.current) {
      started.current = true;
      kick = setTimeout(() => void runClientSteps(), 0); // vault withdrawal overlaps with the server building the landing account
    } else if (record.status === "awaiting_usdc" && vaultTxHash && client !== "transfer" && client !== "done" && client !== "needs_tap") {
      kick = setTimeout(() => void runClientSteps(), 0);
    }
    return () => {
      if (kick) clearTimeout(kick);
    };
  }, [record, kit, info, client, vaultTxHash, runClientSteps]);

  const start = async () => {
    if (!address) return;
    setSubmitting(true);
    setFailure(null);
    try {
      const created = await api<WithdrawalRecord>("/api/withdraw", { method: "POST", body: JSON.stringify({ contractId: address, amountUsdc: amount.replace(",", ".") }) });
      setRecord(created);
      setResumed(false);
      setView("progress");
    } catch (err) {
      setFailure(classifyError(err, "anchor"));
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setRecord(null);
    setResumed(false);
    setClient("idle");
    setClientFailure(null);
    setFailure(null);
    vaultTx.current = null;
    setVaultTxHash(null);
    started.current = false;
    void loadPosition();
    setView("form");
  };

  const amountStroops = toStroops(amount || "0");
  const overLimit = policy ? amountStroops > policy.limit : false;
  const overBalance = position ? amountStroops > position.usdc : false;
  const amountValid = amountStroops >= 10_000_000n && !overBalance && !overLimit;

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
          <h1 className="text-3xl font-bold tracking-tight">{t.withdraw.title}</h1>
          <Link href="/kumbara" className="text-sm text-teal hover:underline">
            {t.withdraw.backToSavings}
          </Link>
        </div>
        <form
          className="card flex flex-col gap-4 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (amountValid) void start();
          }}
        >
          <div className="flex items-center justify-between">
            <p className="text-sm text-ink-2">
              {t.withdraw.available}: <strong className="tnum">{position ? `${formatUsdc(position.usdc, locale)} USDC` : "…"}</strong>
            </p>
            <NetworkBadge />
          </div>
          <label className="flex flex-col gap-2">
            <span className="font-semibold">{t.withdraw.lead}</span>
            <span className="microlabel">{t.withdraw.amountLabel}</span>
            <input
              type="number"
              inputMode="decimal"
              min={1}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="tnum rounded-xl border border-line bg-paper px-4 py-3 text-2xl font-semibold outline-none focus:border-teal"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => position && setAmount(floor2(position.usdc))} className="btn-secondary min-h-9 px-3 text-sm" disabled={!position || position.usdc < 10_000_000n}>
              {t.withdraw.all}
            </button>
          </div>
          <p className="text-xs text-muted">{t.withdraw.min}</p>
          {quote ? (
            <div className="rounded-xl bg-paper-2 p-3">
              <p className="microlabel">{t.withdraw.quoteTitle}</p>
              <p className="tnum text-2xl font-bold">{formatTry(Number(quote.tryOut), locale)}</p>
              <p className="tnum text-xs text-ink-2">
                {t.withdraw.rateLine} {Number(quote.rate).toLocaleString(locale === "tr" ? "tr-TR" : "en-US", { maximumFractionDigits: 4 })} ₺/USDC ({quote.spreadBps} bps {t.withdraw.spread}) · {t.withdraw.indicative}
              </p>
              <p className="tnum mt-1 text-xs text-muted" data-testid="quote-age">
                {t.withdraw.quoteAge.replace("{seconds}", String(Math.max(0, Math.round(quoteAge / 1000))))}
              </p>
            </div>
          ) : null}
          {overLimit && policy ? (
            <FailureScreen failure={{ kind: "limit_exceeded", detail: `limit ${formatUsdc(policy.limit, locale)} USDC per transaction` }} compact />
          ) : null}
          {overBalance && position ? (
            <FailureScreen failure={{ kind: "insufficient_balance", detail: `vault position ${formatUsdc(position.usdc, locale)} USDC` }} compact primary={null} />
          ) : null}
          {failure ? <FailureScreen failure={failure} compact primary={AMOUNT_FAILURES.has(failure.kind) ? null : undefined} onRetry={() => void start()} /> : null}
          <p className="text-xs text-muted">{t.withdraw.payoutHint}</p>
          <button type="submit" disabled={!amountValid || submitting || !address} className="btn-primary w-full text-lg">
            {submitting ? t.savings.loading : t.withdraw.continue}
          </button>
        </form>
      </div>
    );
  }

  if (!record) return null;
  const clientLabel = client === "vault" ? t.withdraw.stepVault : client === "transfer" ? t.withdraw.stepTransfer : null;
  const failed = record.status === "failed" ? classifyRecordError(record.error ?? { code: "step_failed", message: record.lastError?.message ?? "unknown" }, { landingAddress: record.landing?.publicKey }) : null;
  const retryLabel = vaultTxHash ? t.withdraw.tapTransfer : t.withdraw.tapVault;

  return (
    <div className="flex flex-col gap-5 py-2">
      <div className="flex items-baseline justify-between">
        <h1 className="text-3xl font-bold tracking-tight">{t.withdraw.title}</h1>
        <Link href="/kumbara" className="text-sm text-teal hover:underline">
          {t.withdraw.backToSavings}
        </Link>
      </div>

      {resumed && !FINAL.includes(record.status) ? <ResumeNotice flow="withdraw" /> : null}
      {pollFailure ? <FailureScreen failure={pollFailure} primary={null} /> : null}

      {failed ? <FailureScreen failure={failed} primary={failed.kind === "usdc_not_received" || failed.kind === "anchor_not_matched" ? undefined : { label: t.withdraw.newWithdrawal, onClick: reset }} secondary={failed.kind === "usdc_not_received" || failed.kind === "anchor_not_matched" ? { label: t.withdraw.newWithdrawal, onClick: reset } : null} /> : null}

      <section className="card p-5" aria-label={t.withdraw.quoteTitle}>
        <div className="flex items-center justify-between">
          <p className="microlabel">{t.withdraw.quoteTitle}</p>
          <NetworkBadge />
        </div>
        <p className="tnum mt-2 text-3xl font-bold">{formatTry(Number(record.amountTry ?? record.quote.tryOut), locale)}</p>
        <p className="tnum mt-1 text-sm text-ink-2">
          {formatUsdc(record.amountUsdc, locale)} USDC · {t.withdraw.rateLine} {Number(record.quote.rate).toLocaleString(locale === "tr" ? "tr-TR" : "en-US", { maximumFractionDigits: 4 })} ₺/USDC
        </p>
        <p className="mt-1 text-sm text-ink-2">
          {t.withdraw.payoutTo}: <span className="font-mono">{maskIban(record.payoutIban)}</span>
        </p>
      </section>

      <section className="card p-5" aria-label={t.deposit.statusTitle}>
        <p className="microlabel">{t.deposit.statusTitle}</p>
        <p className="mt-2 text-base font-semibold" role="status" aria-live="polite" data-testid="withdraw-current">
          {t.withdraw.steps[record.status]}
        </p>
        {clientLabel && record.status !== "completed" ? (
          <p className="mt-1 text-sm text-ink-2" role="status">
            {clientLabel}
          </p>
        ) : null}
        {client === "needs_tap" && !FINAL.includes(record.status) ? (
          clientFailure ? (
            <FailureScreen
              failure={clientFailure}
              compact
              className="mt-3"
              primary={clientFailure.kind === "limit_exceeded" ? undefined : { label: retryLabel, onClick: () => void runClientSteps() }}
              secondary={clientFailure.kind === "limit_exceeded" ? { label: retryLabel, onClick: () => void runClientSteps() } : null}
            />
          ) : (
            <div className="mt-3 rounded-xl border border-amber/40 bg-amber/5 p-3">
              <p className="text-sm text-ink-2">{t.withdraw.needsTap}</p>
              <button type="button" onClick={() => void runClientSteps()} className="btn-primary mt-3 min-h-10 px-4 text-sm">
                {retryLabel}
              </button>
            </div>
          )
        ) : null}
        {record.status === "completed" ? (
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <dt className="text-muted">{t.withdraw.receivedTry}</dt>
            <dd className="tnum text-right font-semibold" data-testid="withdraw-try">
              {formatTry(Number(record.amountTry ?? record.quote.tryOut), locale)}
            </dd>
            <dt className="text-muted">{t.withdraw.payout}</dt>
            <dd className="text-right font-mono text-xs" data-testid="withdraw-payout">
              {record.payoutId ?? "–"}
            </dd>
          </dl>
        ) : null}
        {vaultTxHash || record.vaultTxHash || record.transferTxHash || record.paymentTxHash ? (
          <div className="mt-4 flex flex-col gap-1">
            {record.vaultTxHash ?? vaultTxHash ? <TxLink hash={(record.vaultTxHash ?? vaultTxHash) as string} label={t.withdraw.links.vault} /> : null}
            {record.transferTxHash ? <TxLink hash={record.transferTxHash} label={t.withdraw.links.transfer} /> : null}
            {record.paymentTxHash ? <TxLink hash={record.paymentTxHash} label={t.withdraw.links.payment} /> : null}
          </div>
        ) : null}
      </section>

      {failure ? <FailureScreen failure={failure} compact primary={null} /> : null}
      <div className="flex flex-col gap-2">
        {record.status === "completed" ? (
          <Link href="/kumbara" className="btn-primary w-full">
            {t.withdraw.backToSavings}
          </Link>
        ) : null}
        {record.status === "completed" ? (
          <button type="button" onClick={reset} className="btn-secondary w-full">
            {t.withdraw.newWithdrawal}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default function WithdrawPage() {
  return (
    <RequireWallet>
      <Withdraw />
    </RequireWallet>
  );
}
