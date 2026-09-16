"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePasskeyWallet } from "@sembol/passkey-react";
import { CheckCircle2Icon } from "lucide-react";
import { FailureScreen } from "@/components/FailureScreen";
import { Spinner } from "@/components/Spinner";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-3xl font-bold tracking-tight">{t.recover.title}</h1>
        <Button variant="link" size="xs" render={<Link href="/" />}>
          {t.recover.back}
        </Button>
      </div>
      <p className="text-sm leading-relaxed text-ink-2">{t.recover.lead}</p>
      <p className="text-sm leading-relaxed text-ink-2">{t.failures.kinds.passkey_lost.body}</p>
      <Card render={<section aria-label={t.recover.title} />}>
        <CardContent className="flex flex-col gap-4">
          {stage === "done" ? (
            <Alert role="status" data-testid="recover-done" className="border-mint/30 bg-mint/5">
              <CheckCircle2Icon className="text-mint" />
              <AlertTitle className="text-mint-2">{t.recover.done}</AlertTitle>
            </Alert>
          ) : (
            <>
              <Button size="xl" className="w-full" onClick={() => void find()} disabled={busy || !kit} aria-busy={busy ? "true" : undefined} data-testid="recover-find">
                {busy ? <Spinner data-icon="inline-start" /> : null}
                {stage === "finding" ? t.recover.finding : stage === "connecting" ? t.savings.loading : t.recover.find}
              </Button>
              {note ? (
                <p className="text-sm text-ink-2" role="status" data-testid="recover-note">
                  {note}
                </p>
              ) : null}
              {stage === "manual" ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void connectManual();
                  }}
                >
                  <FieldGroup className="gap-4">
                    <Field>
                      <FieldLabel htmlFor="recover-address" className="microlabel">
                        {t.recover.manualLabel}
                      </FieldLabel>
                      <Input id="recover-address" value={manual} onChange={(e) => setManual(e.target.value)} className="font-mono text-sm" placeholder="C…" autoComplete="off" spellCheck={false} data-testid="recover-address" />
                      <FieldDescription className="text-xs">{t.recover.manualHint}</FieldDescription>
                    </Field>
                    <Button type="submit" variant="outline" className="w-full" disabled={!/^C[A-Z2-7]{55}$/.test(manual.trim())}>
                      {t.recover.manualSubmit}
                    </Button>
                  </FieldGroup>
                </form>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
      {failure ? <FailureScreen failure={failure} compact primary={null} /> : null}
    </div>
  );
}
