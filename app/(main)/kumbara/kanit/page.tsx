"use client";

import Link from "next/link";
import { describeLedgerPeriod, usePasskeyWallet, useSigners, useSpendingPolicy } from "@sembol/passkey-react";
import { NetworkBadge } from "@/components/NetworkBadge";
import { RequireWallet } from "@/components/RequireWallet";
import { Skeleton } from "@/components/Skeleton";
import { EXPLORER_BASE, NETWORK_LABEL, sembolConfig } from "@/lib/config";
import { formatUsdc } from "@/lib/format";
import { useLocale } from "@/lib/i18n";
import { useAnchorInfo } from "@/lib/useAnchorInfo";

function ExplorerLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="btn-chip">
      {label} · {NETWORK_LABEL} ↗
    </a>
  );
}

/**
 * Proof screen: what the chain says about this kumbara, read live. Who can
 * sign (the signers of the smart account), that Kumbara holds no key, and the
 * spending limit the policy contract enforces, each with an explorer link so
 * anyone can check without trusting this page.
 */
function Proof() {
  const { t, locale } = useLocale();
  const { address } = usePasskeyWallet();
  const { info } = useAnchorInfo();
  const { signers, isLoading: signersLoading } = useSigners();
  const { policy, isLoading: policyLoading } = useSpendingPolicy(info ? { contractId: info.usdc.contractId } : undefined);
  const passkeys = signers.filter((s) => s.kind === "passkey");
  const recoveryKeys = signers.filter((s) => s.kind === "ed25519");
  const others = signers.filter((s) => s.kind !== "passkey" && s.kind !== "ed25519");
  const yours = passkeys.some((s) => s.isActive);
  const signersLine = signersLoading
    ? null
    : [
        `${t.proof.signers}: ${signers.length}`,
        yours ? t.proof.yourPasskey : null,
        passkeys.length > 1 ? t.proof.backupPasskeys.replace("{n}", String(passkeys.length - 1)) : null,
        recoveryKeys.length ? t.proof.recoveryKeys.replace("{n}", String(recoveryKeys.length)) : null,
        others.length ? t.proof.otherSigners.replace("{n}", String(others.length)) : null,
      ]
        .filter(Boolean)
        .join(", ") + ".";
  const limitLine = policyLoading ? null : policy ? (policy.periodLedgers === 1 ? t.proof.limitPerTx.replace("{amount}", formatUsdc(policy.limit, locale)) : t.proof.limitPerWindow.replace("{amount}", formatUsdc(policy.limit, locale)).replace("{window}", describeLedgerPeriod(policy.periodLedgers))) : t.proof.limitNone;

  return (
    <div className="flex flex-col gap-5 py-2">
      <div className="flex items-baseline justify-between">
        <h1 className="text-3xl font-bold tracking-tight">{t.proof.title}</h1>
        <Link href="/kumbara" className="text-sm text-teal hover:underline">
          {t.security.back}
        </Link>
      </div>
      <p className="text-sm leading-relaxed text-ink-2">{t.proof.lead}</p>

      <section className="card p-5" aria-label={t.proof.title}>
        <div className="flex items-center justify-between">
          <p className="microlabel">{t.proof.onChain}</p>
          <NetworkBadge />
        </div>
        <ul className="mt-3 flex flex-col gap-3">
          <li className="rounded-xl bg-paper-2 p-3">
            <p className="text-base font-semibold text-ink" data-testid="proof-signers">
              {signersLine ?? <Skeleton className="h-5 w-64" />}
            </p>
            <p className="mt-1 text-xs text-ink-2">{t.proof.signersHint}</p>
            {!signersLoading && signers.length > 0 ? (
              <ul className="mt-2 flex flex-col gap-1 font-mono text-xs text-muted">
                {signers.map((s) => (
                  <li key={s.key}>
                    {s.kind} · {s.display}
                    {s.isActive ? ` · ${t.proof.thisDevice}` : ""}
                    {s.nickname ? ` · ${s.nickname}` : ""}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
          <li className="rounded-xl bg-paper-2 p-3">
            <p className="text-base font-semibold text-ink" data-testid="proof-kumbara">
              {signersLoading ? <Skeleton className="h-5 w-40" /> : `${t.proof.kumbara}: ${others.length === 0 ? t.proof.none : t.proof.otherSigners.replace("{n}", String(others.length))}.`}
            </p>
            <p className="mt-1 text-xs text-ink-2">{t.proof.kumbaraHint}</p>
          </li>
          <li className="rounded-xl bg-paper-2 p-3">
            <p className="text-base font-semibold text-ink" data-testid="proof-limit">
              {limitLine ?? <Skeleton className="h-5 w-56" />}
            </p>
            <p className="mt-1 text-xs text-ink-2">{t.proof.limitHint}</p>
          </li>
        </ul>
        <div className="mt-4 flex flex-wrap gap-2" data-testid="proof-links">
          {address ? <ExplorerLink href={`${EXPLORER_BASE}/contract/${address}`} label={t.proof.linkAccount} /> : null}
          <ExplorerLink href={`${EXPLORER_BASE}/contract/${sembolConfig.spendingLimitPolicyAddress}`} label={t.proof.linkPolicy} />
          <ExplorerLink href={`${EXPLORER_BASE}/contract/${sembolConfig.webauthnVerifierAddress}`} label={t.proof.linkVerifier} />
        </div>
        <p className="mt-3 break-all font-mono text-[11px] text-muted">
          {t.proof.wasm}: {sembolConfig.accountWasmHash}
        </p>
      </section>

      <section className="card p-5" aria-label={t.proof.meansTitle}>
        <p className="microlabel">{t.proof.meansTitle}</p>
        <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed text-ink-2">
          {t.proof.means.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <Link href="/kumbara/guvenlik" className="mt-4 inline-block text-sm text-teal hover:underline">
          {t.savings.manage} →
        </Link>
      </section>
    </div>
  );
}

export default function ProofPage() {
  return (
    <RequireWallet>
      <Proof />
    </RequireWallet>
  );
}
