"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePasskeyWallet } from "@sembol/passkey-react";
import { FailureScreen } from "@/components/FailureScreen";
import { Spinner } from "@/components/Spinner";
import { api } from "@/lib/api";
import { classifyError, type Failure } from "@/lib/failures";
import { useLocale } from "@/lib/i18n";

type Stage = "idle" | "finding" | "manual" | "connecting" | "done";

/**
 * Passkey lost, or a new device: one passkey prompt proves a credential, then
 * the kumbara is found by derivation (the address the kit deploys to derives
 * from the credential id), by Kumbara's own registry (backup passkeys enrolled
 * later), or by an address the person types. No third-party indexer.
 */
export default function RecoverPage() {
  const { t } = useLocale();
  const router = useRouter();
  const { kit, connect } = usePasskeyWallet();
  const [stage, setStage] = useState<Stage>("idle");
  const [credentialId, setCredentialId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [failure, setFailure] = useState<Failure | null>(null);

  const finish = async (id: string, contractId?: string) => {
    setStage("connecting");
    const wallet = await connect(contractId ? { credentialId: id, contractId } : { credentialId: id });
    if (!wallet) throw new Error("wallet_not_found: no kumbara answered for this passkey");
    setStage("done");
    router.push("/kumbara");
  };

  const find = async () => {
    if (!kit) return;
    setFailure(null);
    setNote(null);
    setStage("finding");
    let id = credentialId;
    try {
      if (!id) {
        ({ credentialId: id } = await kit.authenticatePasskey());
        setCredentialId(id);
      }
      try {
        await finish(id);
        setNote(t.recover.foundDerived);
        return;
      } catch (derivationErr) {
        console.info("[kumbara] recovery: no kumbara at the derived address", derivationErr instanceof Error ? derivationErr.message : String(derivationErr));
      }
      try {
        const found = await api<{ contractId: string }>(`/api/registry?credential=${encodeURIComponent(id)}`);
        setNote(t.recover.foundRegistry);
        await finish(id, found.contractId);
        return;
      } catch (registryErr) {
        console.info("[kumbara] recovery: registry has no kumbara for this passkey", registryErr instanceof Error ? registryErr.message : String(registryErr));
      }
      setNote(t.recover.notFound);
      setStage("manual");
    } catch (err) {
      const classified = classifyError(err, "passkey");
      console.error("[kumbara] recovery failed", classified.kind, classified.detail);
      setFailure(classified);
      setStage("idle");
    }
  };

  const connectManual = async () => {
    if (!credentialId) return;
    setFailure(null);
    try {
      await finish(credentialId, manual.trim());
    } catch (err) {
      setFailure(classifyError(err, "passkey"));
      setStage("manual");
    }
  };

  const busy = stage === "finding" || stage === "connecting";
  return (
    <div className="flex flex-col gap-5 py-2">
      <div className="flex items-baseline justify-between">
        <h1 className="text-3xl font-bold tracking-tight">{t.recover.title}</h1>
        <Link href="/" className="text-sm text-teal hover:underline">
          {t.recover.back}
        </Link>
      </div>
      <p className="text-sm leading-relaxed text-ink-2">{t.recover.lead}</p>
      <p className="text-sm leading-relaxed text-ink-2">{t.failures.kinds.passkey_lost.body}</p>
      <section className="card flex flex-col gap-4 p-5" aria-label={t.recover.title}>
        {stage === "done" ? (
          <p className="text-sm font-semibold text-mint" role="status" data-testid="recover-done">
            {t.recover.done}
          </p>
        ) : (
          <>
            <button type="button" onClick={() => void find()} disabled={busy || !kit} aria-busy={busy ? "true" : "false"} className="btn-primary w-full text-lg" data-testid="recover-find">
              {busy ? <Spinner /> : null}
              {stage === "finding" ? t.recover.finding : stage === "connecting" ? t.savings.loading : t.recover.find}
            </button>
            {note ? (
              <p className="text-sm text-ink-2" role="status" data-testid="recover-note">
                {note}
              </p>
            ) : null}
            {stage === "manual" ? (
              <form
                className="flex flex-col gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void connectManual();
                }}
              >
                <label className="flex flex-col gap-1 text-sm">
                  <span className="microlabel">{t.recover.manualLabel}</span>
                  <input value={manual} onChange={(e) => setManual(e.target.value)} className="field font-mono text-sm" placeholder="C…" autoComplete="off" spellCheck={false} data-testid="recover-address" />
                </label>
                <p className="text-xs text-muted">{t.recover.manualHint}</p>
                <button type="submit" disabled={!/^C[A-Z2-7]{55}$/.test(manual.trim())} className="btn-secondary w-full">
                  {t.recover.manualSubmit}
                </button>
              </form>
            ) : null}
          </>
        )}
      </section>
      {failure ? <FailureScreen failure={failure} compact primary={null} /> : null}
    </div>
  );
}
