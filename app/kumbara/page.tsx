"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePasskeyWallet, useSigners, useSpendingPolicy, useWalletBalance } from "@sembol/passkey-react";
import { AddressCard } from "@/components/AddressCard";
import { NetworkBadge } from "@/components/NetworkBadge";
import { RequireWallet } from "@/components/RequireWallet";
import { EXPLORER_BASE, NETWORK_LABEL, sembolConfig } from "@/lib/config";
import { formatTry, formatUsdc } from "@/lib/format";
import { useLocale } from "@/lib/i18n";
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
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!vaultId || !address) return;
    try {
      setPosition(await readVaultPosition(sembolConfig.rpcUrl, sembolConfig.networkPassphrase, vaultId, address));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [vaultId, address]);
  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 20_000);
    return () => clearInterval(id);
  }, [refresh, epoch]);
  return { position, error, refresh };
}

function Savings() {
  const { t, locale } = useLocale();
  const { address } = usePasskeyWallet();
  const { info } = useAnchorInfo();
  const rate = useRate();
  const [epoch, setEpoch] = useState(0);
  const { position, refresh } = useVault(info?.vault.id, address, epoch);
  const usdcToken = info ? { contractId: info.usdc.contractId } : ("native" as const);
  const wallet = useWalletBalance({ token: usdcToken, enabled: Boolean(info) });
  const { signers } = useSigners();
  const { policy } = useSpendingPolicy(usdcToken);

  const inVault = position?.usdc ?? null;
  const waiting = info && wallet.raw !== null ? wallet.raw : null;
  const tryValue = (stroops: bigint | null) => (stroops !== null && rate ? (Number(stroops) / 1e7) * rate.usdTry : null);
  const backupCount = Math.max(0, signers.length - 1);
  const perTx = policy ? policy.periodLedgers === 1 : false;

  return (
    <div className="flex flex-col gap-5 py-2">
      <div className="flex items-baseline justify-between">
        <h1 className="text-3xl font-bold tracking-tight">{t.savings.title}</h1>
        <button
          type="button"
          className="text-sm text-teal underline-offset-2 hover:underline"
          onClick={() => {
            setEpoch((e) => e + 1);
            void refresh();
            void wallet.refetch();
          }}
        >
          {t.savings.refresh}
        </button>
      </div>

      <section className="card p-5" aria-label={t.savings.inVault}>
        <div className="flex items-center justify-between">
          <p className="microlabel">{t.savings.inVault}</p>
          <NetworkBadge />
        </div>
        <p className="tnum mt-2 text-4xl font-bold text-ink">
          {inVault === null ? t.savings.loading : `${formatUsdc(inVault, locale)} USDC`}
        </p>
        <p className="tnum mt-1 text-sm text-ink-2">
          {t.savings.tryEquiv} {formatTry(tryValue(inVault), locale)}
          {rate && <span className="text-muted"> · {t.savings.rateSource[rate.source]}</span>}
        </p>
        {waiting !== null && waiting > 0n && (
          <p className="tnum mt-3 rounded-lg bg-paper-2 px-3 py-2 text-sm text-ink-2">
            {t.savings.waiting}: <strong>{formatUsdc(waiting, locale)} USDC</strong> · {t.savings.tryEquiv} {formatTry(tryValue(waiting), locale)}
          </p>
        )}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Link href="/yukle" className="btn-primary">
            {t.savings.deposit}
          </Link>
          <Link href="/cek" className="btn-secondary">
            {t.savings.withdraw}
          </Link>
        </div>
      </section>

      <section className="card p-5" aria-label={t.savings.vault}>
        <div className="flex items-center justify-between gap-2">
          <p className="microlabel">{t.savings.vault}</p>
          {info && (
            <a href={`${EXPLORER_BASE}/contract/${info.vault.id}`} target="_blank" rel="noreferrer" className="text-xs text-teal hover:underline">
              stellar.expert · {NETWORK_LABEL}
            </a>
          )}
        </div>
        <p className="mt-1 font-semibold">{position?.name ?? t.savings.loading}</p>
        <p className="mt-2 text-sm text-ink-2">{t.savings.yieldLine}</p>
        {position && !position.activeStrategy && <p className="mt-1 text-sm text-amber">{t.savings.noStrategy}</p>}
        <p className="mt-2 text-xs leading-relaxed text-muted">{t.savings.risk}</p>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <div className="card p-4">
          <p className="microlabel">{t.savings.recovery}</p>
          <p className={`mt-1 font-semibold ${backupCount > 0 ? "text-mint" : "text-amber"}`}>{backupCount > 0 ? t.savings.recoveryOk : t.savings.recoveryMissing}</p>
          <p className="mt-1 text-xs text-muted">{t.savings.recoveryHint}</p>
          <Link href="/kumbara/guvenlik" className="mt-3 inline-block text-sm text-teal hover:underline">
            {t.savings.manage} →
          </Link>
        </div>
        <div className="card p-4">
          <p className="microlabel">{t.savings.limit}</p>
          <p className="tnum mt-1 font-semibold">
            {policy
              ? `${formatUsdc(policy.limit, locale)} USDC ${perTx ? t.savings.limitPerTx : `${t.savings.limitPer} ${policy.periodLedgers} ${t.savings.ledgers}`}`
              : t.savings.limitNone}
          </p>
          <Link href="/kumbara/guvenlik" className="mt-3 inline-block text-sm text-teal hover:underline">
            {t.savings.manage} →
          </Link>
        </div>
      </section>

      <AddressCard />
    </div>
  );
}

export default function SavingsPage() {
  return (
    <RequireWallet>
      <Savings />
    </RequireWallet>
  );
}
