"use client";

import { useEffect, useState } from "react";
import { usePasskeyWallet } from "@sembol/passkey-react";
import { Spinner } from "@/components/Spinner";
import { useToast } from "@/components/Toaster";
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
    <svg viewBox="0 0 84 84" className="h-24 w-24 flex-none" role="img" aria-label={label}>
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
    <section className="card p-5" aria-label={t.goal.title} data-testid="goal-card">
      <div className="flex items-center justify-between gap-3">
        <p className="microlabel">{t.goal.title}</p>
        {!editing && profile !== undefined ? (
          <button type="button" onClick={() => setEditing(true)} className="btn-chip" data-testid="goal-edit">
            {profile ? t.goal.edit : t.goal.set}
          </button>
        ) : null}
      </div>
      {editing ? (
        <form
          className="mt-3 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            <span className="microlabel">{t.goal.nameLabel}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={24} className="field" placeholder={t.goal.namePlaceholder} data-testid="goal-name" autoComplete="off" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="microlabel">{t.goal.goalLabel}</span>
            <span className="relative block">
              <input value={goal} onChange={(e) => setGoal(e.target.value)} type="number" inputMode="decimal" min={0} step="any" className="field tnum pr-16" placeholder="500" data-testid="goal-amount" />
              <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted" aria-hidden>
                USDC
              </span>
            </span>
          </label>
          <p className="text-xs text-muted">{t.goal.privacy}</p>
          {error ? (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <button type="submit" disabled={saving || name.trim() === "" || !credentialId} aria-busy={saving ? "true" : "false"} className="btn-primary min-h-11 flex-1 text-sm" data-testid="goal-save">
              {saving ? <Spinner /> : null}
              {t.goal.save}
            </button>
            <button type="button" onClick={() => setEditing(false)} className="btn-secondary min-h-11 px-4 text-sm">
              {t.goal.cancel}
            </button>
          </div>
        </form>
      ) : profile ? (
        <div className="mt-3 flex items-center gap-4">
          {profile.goalUsdc ? <Ring fraction={fraction} label={`${Math.round(fraction * 100)}%`} /> : null}
          <div className="min-w-0">
            <p className="text-2xl font-bold tracking-tight text-ink" data-testid="goal-name-shown">
              {profile.name}
            </p>
            {profile.goalUsdc ? (
              <p className="tnum mt-1 text-sm text-ink-2" data-testid="goal-progress">
                {inVault !== null ? formatUsdc(inVault, locale) : "…"} / {Number(profile.goalUsdc).toLocaleString(numberLocale, { maximumFractionDigits: 2 })} USDC
              </p>
            ) : (
              <p className="mt-1 text-sm text-muted">{t.goal.noGoal}</p>
            )}
          </div>
        </div>
      ) : (
        <p className="mt-2 text-sm text-ink-2">{profile === undefined ? t.savings.loading : t.goal.empty}</p>
      )}
    </section>
  );
}
