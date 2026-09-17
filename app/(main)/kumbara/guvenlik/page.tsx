"use client";

import Link from "next/link";
import { AddSignerButton, RecoverySetup, SignerList, SpendingPolicyForm, usePasskeyWallet } from "@sembol/passkey-react";
import { RequireWallet } from "@/components/RequireWallet";
import { Skeleton } from "@/components/Skeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocale } from "@/lib/i18n";
import { useAnchorInfo } from "@/lib/useAnchorInfo";

/** Recovery and spending-limit management, straight from @sembol/passkey-react. */
function Security() {
  const { t } = useLocale();
  const { address } = usePasskeyWallet();
  const { info } = useAnchorInfo();
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-5 py-2 lg:max-w-2xl">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-3xl font-bold tracking-tight">{t.security.title}</h1>
        <Button variant="link" size="xs" render={<Link href="/kumbara" />}>
          {t.security.back}
        </Button>
      </div>
      <Card className="rise-in" render={<section aria-label={t.security.signers} />}>
        <CardHeader>
          <CardTitle>{t.security.signers}</CardTitle>
          <CardDescription className="text-ink-2">{t.security.signersHint}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <SignerList />
          <AddSignerButton variant="outline" />
        </CardContent>
      </Card>
      <Card className="rise-in" render={<section aria-label={t.security.recovery} />}>
        <CardHeader>
          <CardTitle>{t.security.recovery}</CardTitle>
          <CardDescription className="text-ink-2">{t.security.recoveryHint}</CardDescription>
        </CardHeader>
        <CardContent>
          <RecoverySetup
            onEnrolled={(result) => {
              // A backup passkey cannot derive the kumbara's address; remember which kumbara it opens.
              const credentialId = (result as { credentialId?: string } | undefined)?.credentialId;
              if (credentialId && address) void fetch("/api/registry", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ credentialId, contractId: address }) }).catch(() => undefined);
            }}
          />
        </CardContent>
      </Card>
      <Card className="rise-in" render={<section aria-label={t.security.limit} />}>
        <CardHeader>
          <CardTitle>{t.security.limit}</CardTitle>
          <CardDescription className="text-ink-2">{t.security.limitHint}</CardDescription>
        </CardHeader>
        <CardContent>
          {info ? (
            <SpendingPolicyForm token={{ contractId: info.usdc.contractId }} tokenSymbol="USDC" />
          ) : (
            <div role="status" aria-label={t.savings.loading} className="flex flex-col gap-2">
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-11 w-40" />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function SecurityPage() {
  return (
    <RequireWallet>
      <Security />
    </RequireWallet>
  );
}
