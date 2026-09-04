"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toSembolError, useCreateWallet, usePasskeyWallet, useSpendingPolicy, type SembolError } from "@sembol/passkey-react";
import { AddressCard } from "@/components/AddressCard";
import { useLocale } from "@/lib/i18n";
import { DEFAULT_LIMIT_PERIOD, DEFAULT_LIMIT_USDC } from "@/lib/limits";
import { useAnchorInfo } from "@/lib/useAnchorInfo";

/** idle → creating (passkey + deploy) → limit (waiting for the connection) → installing → done */
type Stage = "idle" | "creating" | "limit" | "installing" | "done";

/** Onboard: one button. Face ID → smart account via the relay → spending limit → Savings. */
export default function OnboardPage() {
  const { t } = useLocale();
  const router = useRouter();
  const { status, isConnected, address, credentialId } = usePasskeyWallet();
  const { createWallet, phase: createPhase } = useCreateWallet();
  const { info } = useAnchorInfo();
  const usdcToken = info ? { contractId: info.usdc.contractId } : ("native" as const);
  const { setLimit, policy } = useSpendingPolicy(usdcToken);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<SembolError | null>(null);

  // Booth ref: remembered only so the counter can attribute the account.
  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get("ref");
    if (ref) document.cookie = `kumbara_ref=${encodeURIComponent(ref.slice(0, 64))}; path=/; max-age=86400; SameSite=Lax`;
  }, []);

  // Step 2 runs once the provider reports the new wallet as connected, so the
  // spending-policy hook sees the fresh credential.
  useEffect(() => {
    if (stage !== "limit" || !isConnected || !credentialId || !info) return;
    setStage("installing");
    setLimit({ limit: DEFAULT_LIMIT_USDC, period: DEFAULT_LIMIT_PERIOD, token: { contractId: info.usdc.contractId } })
      .then(() => {
        setStage("done");
        router.push("/kumbara");
      })
      .catch((err: unknown) => {
        const sembolError = toSembolError(err);
        console.error("[kumbara] spending limit install failed", sembolError.code, sembolError.message);
        setError(sembolError);
        setStage("idle");
      });
  }, [stage, isConnected, credentialId, info, setLimit, router]);

  const start = async () => {
    setError(null);
    setStage("creating");
    try {
      await createWallet({ userName: "kumbara", fund: false });
      setStage("limit");
    } catch (err) {
      const sembolError = toSembolError(err);
      console.error("[kumbara] wallet creation failed", sembolError.code, sembolError.message);
      setError(sembolError);
      setStage("idle");
    }
  };

  const busy = stage === "creating" || stage === "limit" || stage === "installing";
  const phaseLabel =
    stage === "creating" ? (createPhase === "deploying" ? t.onboard.phaseDeploy : t.onboard.phasePasskey) : stage === "limit" || stage === "installing" ? t.onboard.phaseLimit : null;
  const errorText = error
    ? error.code === "user_cancelled"
      ? t.errors.cancelled
      : error.code === "submission_failed" || error.code === "network_error"
        ? t.errors.relay
        : error.userMessage
    : null;

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
            {errorText && (
              <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm" role="alert">
                <p className="font-semibold text-danger">{t.onboard.errorTitle}</p>
                <p className="mt-1 text-ink-2">{errorText}</p>
                {!policy && (
                  <button type="button" onClick={() => setStage("limit")} className="btn-secondary mt-3 min-h-9 px-3 text-xs">
                    {t.onboard.retry}
                  </button>
                )}
              </div>
            )}
            <Link href="/kumbara" className="btn-primary w-full">
              {t.onboard.existing}
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <button type="button" onClick={start} disabled={!info} className="btn-primary w-full text-lg">
              {t.onboard.cta}
            </button>
            {errorText && (
              <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm" role="alert">
                <p className="font-semibold text-danger">{t.onboard.errorTitle}</p>
                <p className="mt-1 text-ink-2">{errorText}</p>
              </div>
            )}
            <p className="text-xs leading-relaxed text-muted">{t.onboard.limitNote}</p>
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
