"use client";

import Link from "next/link";
import { describeLedgerPeriod, usePasskeyWallet, useSigners, useSpendingPolicy } from "@sembol/passkey-react";
import { ArrowRightIcon, ExternalLinkIcon } from "lucide-react";
import { NetworkBadge } from "@/components/NetworkBadge";
import { RequireWallet } from "@/components/RequireWallet";
import { Skeleton } from "@/components/Skeleton";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { EXPLORER_BASE, NETWORK_LABEL, sembolConfig } from "@/lib/config";
import { formatUsdc } from "@/lib/format";
import { useLocale } from "@/lib/i18n";
import { useAnchorInfo } from "@/lib/useAnchorInfo";

function ExplorerLink({ href, label }: { href: string; label: string }) {
  return (
    <Button variant="outline" size="sm" render={<a href={href} target="_blank" rel="noreferrer" />}>
      {label} · {NETWORK_LABEL}
      <ExternalLinkIcon data-icon="inline-end" />
    </Button>
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
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-3xl font-bold tracking-tight">{t.proof.title}</h1>
        <Button variant="link" size="xs" render={<Link href="/kumbara" />}>
          {t.security.back}
        </Button>
      </div>
      <p className="text-sm leading-relaxed text-ink-2">{t.proof.lead}</p>

      <Card render={<section aria-label={t.proof.title} />}>
        <CardHeader>
          <CardTitle className="microlabel">{t.proof.onChain}</CardTitle>
          <CardAction>
            <NetworkBadge />
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ItemGroup className="gap-3">
            <Item variant="muted" role="listitem">
              <ItemContent>
                <ItemTitle className="text-base text-foreground" data-testid="proof-signers">
                  {signersLine ?? <Skeleton className="h-5 w-64" />}
                </ItemTitle>
                <ItemDescription className="text-xs text-ink-2">{t.proof.signersHint}</ItemDescription>
                {!signersLoading && signers.length > 0 ? (
                  <ul className="mt-1 flex flex-col gap-1 font-mono text-xs text-muted-foreground">
                    {signers.map((s) => (
                      <li key={s.key}>
                        {s.kind} · {s.display}
                        {s.isActive ? ` · ${t.proof.thisDevice}` : ""}
                        {s.nickname ? ` · ${s.nickname}` : ""}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </ItemContent>
            </Item>
            <Item variant="muted" role="listitem">
              <ItemContent>
                <ItemTitle className="text-base text-foreground" data-testid="proof-kumbara">
                  {signersLoading ? <Skeleton className="h-5 w-40" /> : `${t.proof.kumbara}: ${others.length === 0 ? t.proof.none : t.proof.otherSigners.replace("{n}", String(others.length))}.`}
                </ItemTitle>
                <ItemDescription className="text-xs text-ink-2">{t.proof.kumbaraHint}</ItemDescription>
              </ItemContent>
            </Item>
            <Item variant="muted" role="listitem">
              <ItemContent>
                <ItemTitle className="text-base text-foreground" data-testid="proof-limit">
                  {limitLine ?? <Skeleton className="h-5 w-56" />}
                </ItemTitle>
                <ItemDescription className="text-xs text-ink-2">{t.proof.limitHint}</ItemDescription>
              </ItemContent>
            </Item>
          </ItemGroup>
          <div className="flex flex-wrap gap-2" data-testid="proof-links">
            {address ? <ExplorerLink href={`${EXPLORER_BASE}/contract/${address}`} label={t.proof.linkAccount} /> : null}
            <ExplorerLink href={`${EXPLORER_BASE}/contract/${sembolConfig.spendingLimitPolicyAddress}`} label={t.proof.linkPolicy} />
            <ExplorerLink href={`${EXPLORER_BASE}/contract/${sembolConfig.webauthnVerifierAddress}`} label={t.proof.linkVerifier} />
          </div>
          <p className="font-mono text-[11px] break-all text-muted-foreground">
            {t.proof.wasm}: {sembolConfig.accountWasmHash}
          </p>
        </CardContent>
      </Card>

      <Card render={<section aria-label={t.proof.meansTitle} />}>
        <CardHeader>
          <CardTitle className="microlabel">{t.proof.meansTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed text-ink-2">
            {t.proof.means.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </CardContent>
        <CardFooter>
          <Button variant="link" size="xs" render={<Link href="/kumbara/guvenlik" />}>
            {t.savings.manage}
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        </CardFooter>
      </Card>
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
