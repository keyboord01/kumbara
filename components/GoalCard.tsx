"use client";

import { useEffect, useState } from "react";
import { usePasskeyWallet } from "@sembol/passkey-react";
import { Skeleton } from "@/components/Skeleton";
import { Spinner } from "@/components/Spinner";
import { useToast } from "@/components/Toaster";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { api } from "@/lib/api";
import { formatUsdc } from "@/lib/format";
import { useLocale } from "@/lib/i18n";

interface Profile {
  contractId: string;
  name: string;
  goalUsdc: string | null;
}

/** A ring from 0 to 100 %, drawn once, no library. */
function Ring({ fraction, label }: { fraction: number; label: string }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const done = Math.max(0, Math.min(1, fraction));
  return (
    <svg viewBox="0 0 84 84" className="size-24 flex-none" role="img" aria-label={label}>
      <circle cx="42" cy="42" r={r} fill="none" stroke="var(--color-paper-3)" strokeWidth="8" />
      <circle cx="42" cy="42" r={r} fill="none" stroke="var(--color-teal)" strokeWidth="8" strokeLinecap="round" strokeDasharray={`${c}`} strokeDashoffset={`${c * (1 - done)}`} transform="rotate(-90 42 42)" style={{ transition: "stroke-dashoffset 700ms cubic-bezier(0.16, 1, 0.3, 1)" }} />
      <text x="42" y="47" textAnchor="middle" fontSize="16" fontWeight="700" fill="var(--color-ink)" style={{ fontVariantNumeric: "tabular-nums" }}>
        {Math.round(done * 100)}%
      </text>
    </svg>
  );
}

/**
 * Name and goal for this kumbara, kept per contract on the server (a nickname
 * and a number, no personal data). The ring compares what is in the vault
 * with the goal. Saving needs the passkey credential the registry maps to
 * this kumbara, which only this browser has.
 */
export function GoalCard({ inVault }: { inVault: bigint | null }) {
  const { t, locale } = useLocale();
  const { address, credentialId } = usePasskeyWallet();
  const { toast } = useToast();
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!address) return;
    let alive = true;
    api<{ profile: Profile | null }>(`/api/profile?contractId=${address}`)
      .then((res) => {
        if (!alive) return;
        setProfile(res.profile);
        setName(res.profile?.name ?? "");
        setGoal(res.profile?.goalUsdc ?? "");
      })
      .catch(() => {
        if (alive) setProfile(null);
      });
    return () => {
      alive = false;
    };
  }, [address]);

  const save = async () => {
    if (!address || !credentialId) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api<{ profile: Profile }>("/api/profile", { method: "PUT", body: JSON.stringify({ contractId: address, credentialId, name, goalUsdc: goal.trim() === "" ? null : goal.trim() }) });
      setProfile(res.profile);
      setEditing(false);
      toast({ title: t.goal.saved, body: res.profile.name, variant: "success", key: "goal" });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const goalStroops = profile?.goalUsdc ? BigInt(Math.round(Number(profile.goalUsdc) * 1e7)) : null;
  const fraction = goalStroops && goalStroops > 0n && inVault !== null ? Number(inVault) / Number(goalStroops) : 0;
  const numberLocale = locale === "tr" ? "tr-TR" : "en-US";

  return (
    <Card render={<section aria-label={t.goal.title} />} data-testid="goal-card">
      <CardHeader>
        <CardTitle className="microlabel">{t.goal.title}</CardTitle>
        {!editing && profile !== undefined ? (
          <CardAction>
            <Button variant="outline" size="sm" onClick={() => setEditing(true)} data-testid="goal-edit">
              {profile ? t.goal.edit : t.goal.set}
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        {editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <FieldGroup className="gap-4">
              <Field>
                <FieldLabel htmlFor="goal-name" className="microlabel">
                  {t.goal.nameLabel}
                </FieldLabel>
                <Input id="goal-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={24} placeholder={t.goal.namePlaceholder} data-testid="goal-name" autoComplete="off" />
              </Field>
              <Field>
                <FieldLabel htmlFor="goal-amount" className="microlabel">
                  {t.goal.goalLabel}
                </FieldLabel>
                <InputGroup>
                  <InputGroupInput id="goal-amount" value={goal} onChange={(e) => setGoal(e.target.value)} type="number" inputMode="decimal" min={0} step="any" className="tnum" placeholder="500" data-testid="goal-amount" />
                  <InputGroupAddon align="inline-end">
                    <InputGroupText className="text-xs font-semibold">USDC</InputGroupText>
                  </InputGroupAddon>
                </InputGroup>
                <FieldDescription className="text-xs">{t.goal.privacy}</FieldDescription>
                <FieldError>{error}</FieldError>
              </Field>
              <div className="flex gap-2">
                <Button type="submit" disabled={saving || name.trim() === "" || !credentialId} aria-busy={saving ? "true" : undefined} className="flex-1" data-testid="goal-save">
                  {saving ? <Spinner data-icon="inline-start" /> : null}
                  {t.goal.save}
                </Button>
                <Button type="button" variant="outline" onClick={() => setEditing(false)}>
                  {t.goal.cancel}
                </Button>
              </div>
            </FieldGroup>
          </form>
        ) : profile ? (
          <div className="flex items-center gap-4">
            {profile.goalUsdc ? <Ring fraction={fraction} label={`${Math.round(fraction * 100)}%`} /> : null}
            <div className="min-w-0">
              <p className="text-2xl font-bold tracking-tight text-foreground" data-testid="goal-name-shown">
                {profile.name}
              </p>
              {profile.goalUsdc ? (
                <p className="tnum mt-1 text-sm text-ink-2" data-testid="goal-progress">
                  {inVault !== null ? formatUsdc(inVault, locale) : "…"} / {Number(profile.goalUsdc).toLocaleString(numberLocale, { maximumFractionDigits: 2 })} USDC
                </p>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">{t.goal.noGoal}</p>
              )}
            </div>
          </div>
        ) : profile === undefined ? (
          <Skeleton className="h-8 w-40" />
        ) : (
          <p className="text-sm text-ink-2">{t.goal.empty}</p>
        )}
      </CardContent>
    </Card>
  );
}
