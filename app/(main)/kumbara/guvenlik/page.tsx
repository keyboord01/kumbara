"use client";

import Link from "next/link";
import { AddSignerButton, RecoverySetup, SignerList, SpendingPolicyForm } from "@sembol/passkey-react";
import { RequireWallet } from "@/components/RequireWallet";
import { useLocale } from "@/lib/i18n";
import { useAnchorInfo } from "@/lib/useAnchorInfo";

/** Recovery and spending-limit management, straight from @sembol/passkey-react. */
function Security() {
  const { t } = useLocale();
  const { info } = useAnchorInfo();
  return (
    <div className="flex flex-col gap-5 py-2">
      <div className="flex items-baseline justify-between">
        <h1 className="text-3xl font-bold tracking-tight">{t.security.title}</h1>
        <Link href="/kumbara" className="text-sm text-teal hover:underline">
          {t.security.back}
        </Link>
      </div>
      <section className="card p-5" aria-label={t.security.signers}>
        <h2 className="font-semibold">{t.security.signers}</h2>
        <p className="mt-1 text-sm text-ink-2">{t.security.signersHint}</p>
        <div className="mt-4 flex flex-col gap-4">
          <SignerList />
          <AddSignerButton variant="outline" />
        </div>
      </section>
      <section className="card p-5" aria-label={t.security.recovery}>
        <h2 className="font-semibold">{t.security.recovery}</h2>
        <p className="mt-1 text-sm text-ink-2">{t.security.recoveryHint}</p>
        <div className="mt-4">
          <RecoverySetup />
        </div>
      </section>
      <section className="card p-5" aria-label={t.security.limit}>
        <h2 className="font-semibold">{t.security.limit}</h2>
        <p className="mt-1 text-sm text-ink-2">{t.security.limitHint}</p>
        <div className="mt-4">{info ? <SpendingPolicyForm token={{ contractId: info.usdc.contractId }} tokenSymbol="USDC" /> : <p className="text-sm text-muted">{t.savings.loading}</p>}</div>
      </section>
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
