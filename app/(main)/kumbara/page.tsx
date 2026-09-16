"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { usePasskeyWallet, useSigners, useSpendingPolicy, useWalletBalance } from "@sembol/passkey-react";
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { EXPLORER_BASE, NETWORK, NETWORK_LABEL, sembolConfig } from "@/lib/config";
import { classifyError, type Failure } from "@/lib/failures";
import { formatTry, formatUsdc } from "@/lib/format";
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

function Savings() {
  const { t, locale } = useLocale();
  const router = useRouter();
  const setupRequested = useSearchParams().get("setup") === "limit";
  const { address } = usePasskeyWallet();
  const { info } = useAnchorInfo();
  const rate = useRate();
  const [epoch, setEpoch] = useState(0);
  const { position, refresh } = useVault(info?.vault.id, address, epoch);
  const usdcToken = info ? { contractId: info.usdc.contractId } : ("native" as const);
  const wallet = useWalletBalance({ token: usdcToken, enabled: Boolean(info) });
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
  const tryValue = (stroops: bigint | null) => (stroops !== null && rate ? (Number(stroops) / 1e7) * rate.usdTry : null);
  const backupCount = Math.max(0, signers.length - 1);
  const perTx = policy ? policy.periodLedgers === 1 : false;
  const setupActive = setupRequested && setup !== "done" && !policy;
  const depositBlocked = setupActive;

  return (
    <div className="flex flex-col gap-5 py-2">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-3xl font-bold tracking-tight">{t.savings.title}</h1>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setEpoch((e) => e + 1);
            void refresh();
            void wallet.refetch();
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

      <Card render={<section aria-label={t.savings.inVault} />}>
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
          {waiting !== null && waiting > 0n && (
            <p className="tnum mt-2 rounded-lg bg-muted px-3 py-2 text-sm text-ink-2">
              {t.savings.waiting}: <strong>{formatUsdc(waiting, locale)} USDC</strong> · {t.savings.tryEquiv} {formatTry(tryValue(waiting), locale)}
            </p>
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

      <GoalCard inVault={inVault} />

      <Card render={<section aria-label={t.savings.vault} />}>
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

      <section className="grid gap-3 sm:grid-cols-2">
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
                  : t.savings.limitNone}
            </p>
            <div className="mt-2">
              <Button variant="link" size="xs" render={<Link href="/kumbara/guvenlik" />}>
                {t.savings.manage}
                <ArrowRightIcon data-icon="inline-end" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>

      <InviteCard />

      <AddressCard />
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
