"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { usePasskeyWallet, useSignTransaction, useSigners, useSpendingPolicy, useWalletBalance } from "@sembol/passkey-react";
import { cn } from "cn";
import { ArrowRightIcon, ExternalLinkIcon, RefreshCwIcon } from "lucide-react";
import { AddressCard } from "@/components/AddressCard";
import { GoalCard } from "@/components/GoalCard";
import { InviteCard } from "@/components/InviteCard";
import { FailureScreen } from "@/components/FailureScreen";
import { NetworkBadge } from "@/components/NetworkBadge";
import { Skeleton } from "@/components/Skeleton";
import { RequireWallet } from "@/components/RequireWallet";
import { Spinner } from "@/components/Spinner";
import { useToast } from "@/components/Toaster";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { buildVaultDeposit } from "@/lib/autopilot";
import { EXPLORER_BASE, NETWORK, NETWORK_LABEL, sembolConfig } from "@/lib/config";
import { classifyError, withTimeout, type Failure } from "@/lib/failures";
import { formatStroops, formatTry, formatUsdc } from "@/lib/format";
import { useLocale } from "@/lib/i18n";
import { DEFAULT_LIMIT_PERIOD, DEFAULT_LIMIT_USDC } from "@/lib/limits";
import { useAnchorInfo } from "@/lib/useAnchorInfo";
import { readVaultPosition, type VaultPosition } from "@/lib/vault";

interface Rate {
  usdTry: number;
  source: "reflector" | "anchor";
}

function useRate(): Rate | null {
  const [rate, setRate] = useState<Rate | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/rates")
        .then((r) => (r.ok ? (r.json() as Promise<Rate>) : null))
        .then((r) => alive && r && setRate(r))
        .catch(() => undefined);
    void load();
    const id = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  return rate;
}

function useVault(vaultId: string | undefined, address: string | null, epoch: number) {
  const [position, setPosition] = useState<VaultPosition | null>(null);
  const refresh = useCallback(async () => {
    if (!vaultId || !address) return;
    try {
      setPosition(await readVaultPosition(sembolConfig.rpcUrl, sembolConfig.networkPassphrase, vaultId, address));
    } catch {
      /* keep the previous value; the next tick retries */
    }
  }, [vaultId, address]);
  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0);
    const id = setInterval(() => void refresh(), 20_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [refresh, epoch]);
  return { position, refresh };
}

type SetupState = "idle" | "installing" | "done" | "error";
/** A vault deposit (simulation + passkey + relay) that takes longer than this becomes a retryable failure. */
const STEP_TIMEOUT_MS = 120_000;

/** Below a cent of USDC there is nothing worth a passkey approval, so the "put it in the vault" block stays hidden. */
const MIN_SWEEPABLE_STROOPS = 100_000n;
/** Below half an XLM the native balance is dust from a funding test; above it, say it is there. */
const MIN_VISIBLE_XLM_STROOPS = 5_000_000n;

/** 7-decimal USDC string from stroops, the form `buildVaultDeposit` expects. */
function stroopsToUsdc(stroops: bigint): string {
  return `${stroops / 10_000_000n}.${(stroops % 10_000_000n).toString().padStart(7, "0")}`;
}

function Savings() {
  const { t, locale } = useLocale();
  const router = useRouter();
  const setupRequested = useSearchParams().get("setup") === "limit";
  const { kit, address } = usePasskeyWallet();
  const { signAndSubmit } = useSignTransaction();
  const { toast } = useToast();
  const { info } = useAnchorInfo();
  const rate = useRate();
  const [epoch, setEpoch] = useState(0);
  const { position, refresh } = useVault(info?.vault.id, address, epoch);
  const usdcToken = info ? { contractId: info.usdc.contractId } : ("native" as const);
  const wallet = useWalletBalance({ token: usdcToken, enabled: Boolean(info) });
  // XLM someone sent to the kumbara: shown so it is not invisible, never acted on (Kumbara saves in USDC and the relay pays the fees).
  const walletXlm = useWalletBalance({ token: "native", enabled: Boolean(address) });
  const { signers } = useSigners();
  const { policy, isLoading: policyLoading, setLimit } = useSpendingPolicy(usdcToken);

  // Background spending-limit install after onboarding (?setup=limit).
  const [setup, setSetup] = useState<SetupState>("idle");
  const [setupFailure, setSetupFailure] = useState<Failure | null>(null);
  const started = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // The first policy read completes when isLoading has been true and drops back to false.
  const seenLoading = useRef(false);
  useEffect(() => {
    if (policyLoading) seenLoading.current = true;
  }, [policyLoading]);

  const install = useCallback(async () => {
    if (!info) return;
    setSetup("installing");
    setSetupFailure(null);
    try {
      await setLimit({ limit: DEFAULT_LIMIT_USDC, period: DEFAULT_LIMIT_PERIOD, token: { contractId: info.usdc.contractId } });
      setSetup("done");
      // The install runs in the background; if the visitor already tapped Yükle, do not pull them back here.
      if (mounted.current && window.location.pathname === "/kumbara") router.replace("/kumbara");
    } catch (err) {
      const classified = classifyError(err, "relay");
      console.error("[kumbara] spending limit install failed", classified.kind, classified.detail);
      setSetupFailure(classified);
      setSetup("error");
    }
  }, [info, setLimit, router]);

  useEffect(() => {
    if (!setupRequested || started.current || !info || policyLoading || !seenLoading.current) return;
    started.current = true;
    const kick = setTimeout(() => {
      if (policy) {
        setSetup("done");
        if (window.location.pathname === "/kumbara") router.replace("/kumbara");
      } else {
        void install();
      }
    }, 0);
    return () => clearTimeout(kick);
  }, [setupRequested, info, policyLoading, policy, install, router]);

  const inVault = position?.usdc ?? null;
  const waiting = info && wallet.raw !== null ? wallet.raw : null;
  const sweepable = waiting !== null && waiting >= MIN_SWEEPABLE_STROOPS;
  const xlm = walletXlm.raw !== null && walletXlm.raw >= MIN_VISIBLE_XLM_STROOPS ? walletXlm.raw : null;

  // USDC already in the kumbara (sent to its address, or left by an interrupted deposit): one approval puts it in the vault.
  const [sweep, setSweep] = useState<"idle" | "signing">("idle");
  const [sweepFailure, setSweepFailure] = useState<Failure | null>(null);
  const sweepTx = useRef<string | null>(null);
  const putInVault = useCallback(async () => {
    if (!kit || !info || !address || waiting === null || waiting < MIN_SWEEPABLE_STROOPS) return;
    const amountUsdc = stroopsToUsdc(waiting);
    setSweep("signing");
    setSweepFailure(null);
    try {
      if (!sweepTx.current) {
        // Sign at most once per amount: a failed report re-sends the hash, not the USDC.
        const tx = await withTimeout(buildVaultDeposit(kit, info.vault.id, address, amountUsdc), STEP_TIMEOUT_MS, "vault deposit simulation");
        const result = await withTimeout(signAndSubmit(tx), STEP_TIMEOUT_MS, "vault deposit");
        sweepTx.current = result.hash;
        console.info(`[kumbara] direct vault deposit ${result.hash.slice(0, 8)} confirmed for ${amountUsdc} USDC`);
      }
      // Feed only; the chain is the record, so a failed report never blocks the user.
      await api("/api/vault/direct", { method: "POST", body: JSON.stringify({ contractId: address, hash: sweepTx.current, usdc: amountUsdc }) }).catch(() => undefined);
      sweepTx.current = null;
      toast({ title: t.savings.putInVaultDone, body: `${formatUsdc(waiting, locale)} USDC`, variant: "success", key: "sweep" });
      setEpoch((e) => e + 1);
      void refresh();
      void wallet.refetch();
    } catch (err) {
      const classified = classifyError(err, "vault");
      console.error("[kumbara] direct vault deposit failed", classified.kind, classified.detail);
      setSweepFailure(classified);
    } finally {
      setSweep("idle");
    }
  }, [kit, info, address, waiting, signAndSubmit, toast, t, locale, refresh, wallet]);
  const tryValue = (stroops: bigint | null) => (stroops !== null && rate ? (Number(stroops) / 1e7) * rate.usdTry : null);
  const backupCount = Math.max(0, signers.length - 1);
  const perTx = policy ? policy.periodLedgers === 1 : false;
  const setupActive = setupRequested && setup !== "done" && !policy;
  // Deposits never wait for the limit: it protects what leaves the kumbara, and the first withdrawal sets it.
  const depositBlocked = false;

  return (
    <div className="flex flex-col gap-5 py-2 lg:gap-6">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-3xl font-bold tracking-tight">{t.savings.title}</h1>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setEpoch((e) => e + 1);
            void refresh();
            void wallet.refetch();
            void walletXlm.refetch();
          }}
        >
          <RefreshCwIcon data-icon="inline-start" />
          {t.savings.refresh}
        </Button>
      </div>

      {setupActive &&
        (setup === "error" ? (
          <div className="flex flex-col gap-2" aria-label={t.savings.limit}>
            <Alert variant="destructive">
              <AlertTitle>{t.savings.limitSetupFailed}</AlertTitle>
            </Alert>
            {setupFailure ? <FailureScreen failure={setupFailure} compact primary={{ label: t.savings.limitSetupConfirm, onClick: () => void install() }} /> : null}
          </div>
        ) : (
          <Alert role="status" aria-live="polite" aria-label={t.savings.limit} className="border-teal/30 bg-teal/5">
            <Spinner className="text-teal" />
            <AlertTitle className="text-teal">{t.savings.limitSetup}</AlertTitle>
            <AlertDescription className="text-ink-2">{t.savings.limitSetupHint}</AlertDescription>
          </Alert>
        ))}

      {/* Two independent stacks on a laptop, so a short card never leaves a gap beside a tall one; on a phone
          `contents` flattens both into the single column and `order` keeps the reading order. */}
      <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start lg:gap-6">
        <div className="contents lg:flex lg:flex-col lg:gap-6">
          <Card render={<section aria-label={t.savings.inVault} />} className="max-lg:order-1 lg:order-none">
        <CardHeader>
          <CardTitle className="microlabel">{t.savings.inVault}</CardTitle>
          <CardAction>
            <NetworkBadge />
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          <p className="tnum text-4xl font-bold text-foreground">{inVault === null ? <Skeleton className="h-10 w-44" /> : `${formatUsdc(inVault, locale)} USDC`}</p>
          <p className="tnum text-sm text-ink-2">
            {t.savings.tryEquiv} {formatTry(tryValue(inVault), locale)}
            {rate && <span className="text-muted-foreground"> · {t.savings.rateSource[rate.source]}</span>}
          </p>
          {sweepable && waiting !== null && (
            <div className="mt-2 flex flex-col gap-2 rounded-lg bg-muted px-3 py-3">
              <p className="text-sm text-ink-2">
                {t.savings.waiting}:{" "}
                <strong className="tnum text-foreground" data-testid="wallet-usdc">
                  {formatUsdc(waiting, locale)} USDC
                </strong>
                <span className="tnum">
                  {" "}
                  · {t.savings.tryEquiv} {formatTry(tryValue(waiting), locale)}
                </span>
              </p>
              <p className="text-xs text-muted-foreground">{t.savings.putInVaultHint}</p>
              <Button className="w-full sm:w-fit" onClick={() => void putInVault()} disabled={sweep === "signing" || !kit || !info} aria-busy={sweep === "signing" ? "true" : undefined} data-testid="put-in-vault">
                {sweep === "signing" ? <Spinner data-icon="inline-start" /> : null}
                {t.savings.putInVault}
              </Button>
              {sweepFailure ? <FailureScreen failure={sweepFailure} compact onRetry={() => void putInVault()} /> : null}
            </div>
          )}
          {xlm !== null && (
            <div className="mt-2 flex flex-col gap-0.5">
              {/* The sentence carries the amount in both languages, so it is split around the placeholder. */}
              <p className="text-sm text-ink-2">
                {t.savings.xlmLine.split("{amount}")[0]}
                <strong className="tnum text-foreground" data-testid="wallet-xlm">
                  {formatStroops(xlm, locale)}
                </strong>
                {t.savings.xlmLine.split("{amount}")[1]}
              </p>
              <p className="text-xs text-muted-foreground">{t.savings.xlmHint}</p>
            </div>
          )}
        </CardContent>
        <CardFooter className="grid grid-cols-2 gap-2">
          {depositBlocked ? (
            <Button size="xl" disabled title={t.savings.limitSetup}>
              {t.savings.deposit}
            </Button>
          ) : (
            <Button size="xl" render={<Link href="/yukle" />}>
              {t.savings.deposit}
            </Button>
          )}
          <Button variant="outline" size="xl" render={<Link href="/cek" />}>
            {t.savings.withdraw}
          </Button>
        </CardFooter>
      </Card>

          <Card render={<section aria-label={t.savings.vault} />} className="max-lg:order-3 lg:order-none">
        <CardHeader>
          <CardTitle className="microlabel">{t.savings.vault}</CardTitle>
          <CardDescription className="font-semibold text-foreground">{position?.name ?? <Skeleton className="h-4 w-40" />}</CardDescription>
          {info && (
            <CardAction>
              <Button variant="link" size="xs" render={<a href={`${EXPLORER_BASE}/contract/${info.vault.id}`} target="_blank" rel="noreferrer" />}>
                stellar.expert · {NETWORK_LABEL}
                <ExternalLinkIcon data-icon="inline-end" />
              </Button>
            </CardAction>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          <p className="text-sm text-ink-2">{t.savings.yieldLine}</p>
          {NETWORK === "testnet" && <p className="text-sm text-amber">{t.savings.noYield}</p>}
          <p className="text-xs leading-relaxed text-muted-foreground">{t.savings.risk}</p>
        </CardContent>
      </Card>

          <section className="grid gap-3 max-lg:order-4 sm:grid-cols-2 lg:order-none">
        <Card size="sm">
          <CardHeader>
            <CardTitle className="microlabel">{t.savings.recovery}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            <p className={cn("font-semibold", backupCount > 0 ? "text-mint-2" : "text-amber")}>{backupCount > 0 ? t.savings.recoveryOk : t.savings.recoveryMissing}</p>
            <p className="text-xs text-muted-foreground">{t.savings.recoveryHint}</p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              <Button variant="link" size="xs" render={<Link href="/kumbara/guvenlik" />}>
                {t.savings.manage}
                <ArrowRightIcon data-icon="inline-end" />
              </Button>
              <Button variant="link" size="xs" render={<Link href="/kumbara/kanit" />} data-testid="proof-link">
                {t.savings.proofLink}
                <ArrowRightIcon data-icon="inline-end" />
              </Button>
            </div>
          </CardContent>
        </Card>
        <Card size="sm" data-testid="limit-card">
          <CardHeader>
            <CardTitle className="microlabel">{t.savings.limit}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            <p className="tnum font-semibold">
              {policy
                ? `${formatUsdc(policy.limit, locale)} USDC ${perTx ? t.savings.limitPerTx : `${t.savings.limitPer} ${policy.periodLedgers} ${t.savings.ledgers}`}`
                : setupActive
                  ? t.savings.limitSetup
                  : t.savings.limitDeferred}
            </p>
            {!policy && !setupActive ? <p className="text-xs text-muted-foreground">{t.savings.limitDeferredHint}</p> : null}
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {!policy && !setupActive ? (
                <Button variant="link" size="xs" render={<Link href="/kumbara?setup=limit" />} data-testid="limit-set-now">
                  {t.savings.limitSetNow}
                  <ArrowRightIcon data-icon="inline-end" />
                </Button>
              ) : null}
              <Button variant="link" size="xs" render={<Link href="/kumbara/guvenlik" />}>
                {t.savings.manage}
                <ArrowRightIcon data-icon="inline-end" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>

        </div>

        <div className="contents lg:flex lg:flex-col lg:gap-6">
          <div className="max-lg:order-2 lg:order-none">
            <GoalCard inVault={inVault} />
          </div>
          <div className="max-lg:order-5 lg:order-none">
            <InviteCard />
          </div>
          <div className="max-lg:order-6 lg:order-none">
            <AddressCard />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SavingsPage() {
  return (
    <RequireWallet>
      <Suspense fallback={null}>
        <Savings />
      </Suspense>
    </RequireWallet>
  );
}
