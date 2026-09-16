"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCreateWallet, usePasskeyWallet } from "@sembol/passkey-react";
import { AddressCard } from "@/components/AddressCard";
import { FailureScreen } from "@/components/FailureScreen";
import { Skeleton } from "@/components/Skeleton";
import { Spinner } from "@/components/Spinner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Item, ItemContent, ItemMedia, ItemTitle } from "@/components/ui/item";
import { api } from "@/lib/api";
import { classifyError, type Failure } from "@/lib/failures";
import { useLocale } from "@/lib/i18n";
import { useAnchorInfo } from "@/lib/useAnchorInfo";

/** idle → creating (passkey + deploy) | connecting (existing passkey) → done (navigating to Savings) */
type Stage = "idle" | "creating" | "connecting" | "done";

/** Onboard: one button. Passkey (Face ID, Touch ID or a password manager) → smart account via the relay → spending limit → Savings. */
export default function OnboardPage() {
  const { t } = useLocale();
  const router = useRouter();
  const { status, isConnected, address, capabilities, connect } = usePasskeyWallet();
  const { createWallet, phase: createPhase } = useCreateWallet();
  const { info, failure: infoFailure, retry: retryInfo } = useAnchorInfo();
  const [stage, setStage] = useState<Stage>("idle");
  const [failure, setFailure] = useState<Failure | null>(null);

  // Booth ref: remembered only so the counter can attribute the account.
  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get("ref");
    if (ref) document.cookie = `kumbara_ref=${encodeURIComponent(ref.slice(0, 64))}; path=/; max-age=86400; SameSite=Lax`;
  }, []);

  const start = async () => {
    setFailure(null);
    setStage("creating");
    // Tap time, read by /api/relay when the deployment confirms, for the public
    // tap-to-kumbara timing. A timestamp only; it expires in ten minutes.
    document.cookie = `kumbara_tap=${Date.now()}; path=/; max-age=600; SameSite=Lax`;
    try {
      // Discoverable credential with user verification: what Firefox's passkey providers, iCloud Keychain and
      // password managers such as 1Password create, and what the passkey-only connect path relies on.
      await createWallet({ userName: "kumbara", fund: false, authenticatorSelection: { residentKey: "required", userVerification: "required" } });
      // The kumbara exists: show it now. One approval was enough; the safety
      // limit is set at the first withdrawal (or earlier from the limit card).
      setStage("done");
      router.push("/kumbara");
    } catch (err) {
      const raw = classifyError(err, "relay");
      // Passkey failures carry the browser's WebAuthn capability snapshot in Details, so a report from Firefox or a phone says what was available.
      const classified = raw.kind.startsWith("passkey_") ? { ...raw, detail: `${raw.detail ?? ""} · webauthn ${JSON.stringify(capabilities)}` } : raw;
      console.error("[kumbara] wallet creation failed", classified.kind, classified.detail);
      setFailure(classified);
      setStage("idle");
    }
  };

  const connectExisting = async () => {
    setFailure(null);
    setStage("connecting");
    try {
      const wallet = await connect();
      if (!wallet) {
        setFailure({ kind: "passkey_lost", code: "wallet_not_found", detail: "connect() found no wallet for this passkey" });
        setStage("idle");
        return;
      }
      setStage("done");
      router.push("/kumbara");
    } catch (err) {
      // The address derived from this passkey holds no kumbara: a backup passkey enrolled later. Kumbara's own
      // registry may know which kumbara it belongs to (the primary passkey never needs this: its address derives).
      const credentialId = /for credential ([A-Za-z0-9_-]+)/.exec(err instanceof Error ? err.message : String(err))?.[1];
      if (credentialId) {
        try {
          const found = await api<{ contractId: string }>(`/api/registry?credential=${encodeURIComponent(credentialId)}`);
          const wallet = await connect({ credentialId, contractId: found.contractId });
          if (wallet) {
            setStage("done");
            router.push("/kumbara");
            return;
          }
        } catch (lookupErr) {
          console.info("[kumbara] registry lookup did not resolve this passkey", lookupErr instanceof Error ? lookupErr.message : String(lookupErr));
        }
      }
      const classified = classifyError(err, "passkey");
      console.error("[kumbara] connect failed", classified.kind, classified.detail);
      setFailure(classified);
      setStage("idle");
    }
  };

  const busy = stage !== "idle";
  const phaseLabel = stage === "connecting" ? t.onboard.connecting : stage === "creating" ? (createPhase === "deploying" ? t.onboard.phaseDeploy : t.onboard.phasePasskey) : t.onboard.phaseDeploy;
  const unsupported = capabilities !== null && capabilities.supported === false;

  return (
    <div className="flex flex-col gap-8 py-4 lg:grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-start lg:gap-x-14 lg:py-12">
      <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <h1 className="text-4xl leading-tight font-bold tracking-tight text-foreground lg:text-5xl">{t.onboard.title}</h1>
        <p className="text-base leading-relaxed text-ink-2 lg:text-lg">{t.onboard.lead}</p>
      </section>

      <Card>
        <CardContent className="flex flex-col gap-4">
          {status === "initializing" ? (
            <div role="status" aria-live="polite" aria-label={t.savings.loading} className="flex flex-col gap-3">
              <Skeleton className="h-13 w-full rounded-full" />
              <Skeleton className="mx-auto h-4 w-48" />
              <span className="sr-only">{t.savings.loading}</span>
            </div>
          ) : busy ? (
            <>
              <Button size="xl" className="w-full" disabled aria-busy="true">
                <Spinner data-icon="inline-start" />
                {phaseLabel}
              </Button>
              <p className="text-center text-sm text-muted-foreground" role="status" aria-live="polite">
                {phaseLabel}
              </p>
            </>
          ) : isConnected && address ? (
            <>
              <p className="text-sm text-ink-2">{t.onboard.done}</p>
              <AddressCard />
              {failure ? <FailureScreen failure={failure} compact primary={null} /> : null}
              <Button size="xl" className="w-full" render={<Link href="/kumbara" />}>
                {t.onboard.existing}
              </Button>
            </>
          ) : unsupported ? (
            <FailureScreen failure={{ kind: "passkey_unsupported", detail: JSON.stringify(capabilities) }} primary={null} compact />
          ) : (
            <>
              {infoFailure ? <FailureScreen failure={infoFailure} compact onRetry={retryInfo} /> : null}
              <Button size="xl" className="w-full" onClick={start} disabled={!info}>
                {t.onboard.cta}
              </Button>
              {failure ? (
                <FailureScreen
                  failure={failure}
                  compact
                  onRetry={failure.kind === "passkey_lost" ? undefined : start}
                  secondary={failure.kind === "passkey_lost" ? null : { label: t.onboard.haveOne, onClick: () => void connectExisting() }}
                />
              ) : null}
              <p className="text-xs leading-relaxed text-muted-foreground">{t.onboard.limitNote}</p>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button variant="link" size="xs" onClick={() => void connectExisting()}>
                  {t.onboard.haveOne}
                </Button>
                <Button variant="link" size="xs" className="text-muted-foreground" render={<Link href="/kurtar" />}>
                  {t.onboard.lostPasskey}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
      </div>

      <Card render={<ol aria-label={t.onboard.title} />} className="gap-0 py-0 shadow-none lg:mt-3">
        {t.onboard.steps.map((step, i) => (
          <Item key={step} render={<li />} size="sm" className="rounded-none not-last:border-b-border">
            <ItemMedia>
              <span className="grid size-7 place-items-center rounded-full bg-teal/10 text-xs font-bold text-teal" aria-hidden>
                {i + 1}
              </span>
            </ItemMedia>
            <ItemContent>
              <ItemTitle className="font-normal text-ink-2">{step}</ItemTitle>
            </ItemContent>
          </Item>
        ))}
      </Card>
    </div>
  );
}
