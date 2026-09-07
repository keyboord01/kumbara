"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCreateWallet, usePasskeyWallet } from "@sembol/passkey-react";
import { AddressCard } from "@/components/AddressCard";
import { FailureScreen } from "@/components/FailureScreen";
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
      await createWallet({ userName: "kumbara", fund: false });
      // The kumbara exists: show it now. The spending limit installs from the
      // Savings screen in the background (second passkey approval there).
      setStage("done");
      router.push("/kumbara?setup=limit");
    } catch (err) {
      const classified = classifyError(err, "relay");
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
    <div className="flex flex-col gap-8 py-4">
      <section className="flex flex-col gap-4">
        <h1 className="text-4xl font-bold leading-tight tracking-tight text-ink">{t.onboard.title}</h1>
        <p className="text-base leading-relaxed text-ink-2">{t.onboard.lead}</p>
      </section>

      <section className="card p-5">
        {status === "initializing" ? (
          <p className="text-sm text-muted" role="status">
            {t.savings.loading}
          </p>
        ) : busy ? (
          <div className="flex flex-col gap-3">
            <button type="button" disabled className="btn-primary w-full text-lg" aria-busy>
              {phaseLabel}
            </button>
            <p className="text-center text-sm text-muted" role="status" aria-live="polite">
              {phaseLabel}
            </p>
          </div>
        ) : isConnected && address ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-ink-2">{t.onboard.done}</p>
            <AddressCard />
            {failure ? <FailureScreen failure={failure} compact primary={null} /> : null}
            <Link href="/kumbara" className="btn-primary w-full">
              {t.onboard.existing}
            </Link>
          </div>
        ) : unsupported ? (
          <FailureScreen failure={{ kind: "passkey_unsupported", detail: JSON.stringify(capabilities) }} primary={null} compact />
        ) : (
          <div className="flex flex-col gap-4">
            {infoFailure ? <FailureScreen failure={infoFailure} compact onRetry={retryInfo} /> : null}
            <button type="button" onClick={start} disabled={!info} className="btn-primary w-full text-lg">
              {t.onboard.cta}
            </button>
            {failure ? (
              <FailureScreen
                failure={failure}
                compact
                onRetry={failure.kind === "passkey_lost" ? undefined : start}
                secondary={failure.kind === "passkey_lost" ? null : { label: t.onboard.haveOne, onClick: () => void connectExisting() }}
              />
            ) : null}
            <p className="text-xs leading-relaxed text-muted">{t.onboard.limitNote}</p>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <button type="button" onClick={() => void connectExisting()} className="text-teal underline-offset-2 hover:underline">
                {t.onboard.haveOne}
              </button>
              <Link href="/kurtar" className="text-muted underline-offset-2 hover:underline">
                {t.onboard.lostPasskey}
              </Link>
            </div>
          </div>
        )}
      </section>

      <ol className="grid gap-3 sm:grid-cols-2">
        {t.onboard.steps.map((step, i) => (
          <li key={step} className="card flex items-start gap-3 p-4 text-sm text-ink-2">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-teal/10 font-semibold text-teal">{i + 1}</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
