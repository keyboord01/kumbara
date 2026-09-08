"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toSembolError, usePasskeyWallet, useSignTransaction } from "@sembol/passkey-react";
import { NetworkBadge } from "@/components/NetworkBadge";
import { buildVaultDeposit } from "@/lib/autopilot";
import { StepTimeoutError, withTimeout } from "@/lib/failures";
import { EXPLORER_BASE, NETWORK, NETWORK_LABEL } from "@/lib/config";
import { useLocale } from "@/lib/i18n";
import { useAnchorInfo } from "@/lib/useAnchorInfo";

interface Pending {
  id: string;
  contractId: string;
  amountTry: string;
  createdAt: string;
  reference: string;
}
interface Stuck {
  id: string;
  status: string;
  contractId: string;
  amountTry: string;
  usdc: string | null;
  paidUsdc: string | null;
  anchorTxId: string | null;
  updatedAt: string;
  abandonedAt: string | null;
  errorCode: string | null;
  landing: string | null;
}
interface PlayResult {
  depositId: string;
  reference: string;
  amountTry: string;
  transferId: string;
  transferStatus: string;
}
interface Dep {
  ok: boolean;
  ms: number;
  detail: string;
}
interface AnchorsInfo {
  active: string;
  anchors: Array<{ homeDomain: string; ok: boolean; orgName?: string | null; fiatCode?: string | null; asset?: { code: string; issuer: string } | null; limits?: { fiat: { min: number | null; max: number | null } | null } | null; treasury?: { address: string; balance: string | null; low: boolean } | null; error?: string }>;
}

interface Health {
  ok: boolean;
  dependencies: { anchor: Dep; relay: Dep; rpc: Dep; vault: Dep; checkedAt: string } | { error: string };
}
interface Sponsor {
  publicKey: string;
  balanceXlm: number;
  minXlm: number;
  maxXlm: number;
  ok: boolean;
}
interface SeedDeposit {
  id: string;
  status: string;
  paidUsdc?: string;
  vaultTxHash?: string;
  error?: { message: string };
}
interface CiStatus {
  status: "ok" | "failed" | "unknown";
  step: string | null;
  runUrl: string | null;
  at: string | null;
}

/**
 * Presenter console. Not linked anywhere. The admin token is taken from
 * ?token= (removed from the URL at once) or typed in, kept in component state
 * only, and sent as a bearer header.
 */
export default function BoothAdminPage() {
  const { t, locale } = useLocale();
  const { kit, address, createWallet, disconnect } = usePasskeyWallet();
  const { info } = useAnchorInfo();
  const { signAndSubmit } = useSignTransaction();
  const [token, setToken] = useState("");
  const [pending, setPending] = useState<Pending[] | null>(null);
  const [stuck, setStuck] = useState<Stuck[]>([]);
  const [resumed, setResumed] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [sponsor, setSponsor] = useState<Sponsor | null>(null);
  const [ci, setCi] = useState<CiStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"" | "play" | "fund" | "seed" | "anchor">("");
  const [anchors, setAnchors] = useState<AnchorsInfo | null>(null);
  const [anchorNote, setAnchorNote] = useState<string | null>(null);
  const [result, setResult] = useState<PlayResult | null>(null);
  const [seed, setSeed] = useState<{ contractId: string; deposit: SeedDeposit | null; stage: "creating" | "depositing" | "autopilot" | "needs_tap" | "done" | "error"; message?: string | undefined } | null>(null);
  const seedAutopilot = useRef(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get("token");
    if (fromUrl) {
      setToken(fromUrl);
      url.searchParams.delete("token");
      window.history.replaceState({}, "", url.pathname + url.search);
    }
  }, []);

  const auth = useCallback((init: RequestInit = {}): RequestInit => ({ ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}`, "content-type": "application/json" } }), [token]);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [p, h, s, c, a] = await Promise.all([
        fetch("/api/booth/admin/pending", auth()).then(async (r) => ({ ok: r.ok, body: (await r.json()) as { pending?: Pending[]; stuck?: Stuck[]; error?: { message: string } } })),
        fetch("/api/health").then((r) => r.json() as Promise<Health>),
        fetch("/api/booth/admin/sponsor", auth()).then(async (r) => ({ ok: r.ok, body: (await r.json()) as Sponsor & { error?: { message: string } } })),
        fetch("/api/ci/status").then((r) => (r.ok ? (r.json() as Promise<CiStatus>) : null)).catch(() => null),
        fetch("/api/booth/admin/anchor", auth()).then((r) => (r.ok ? (r.json() as Promise<AnchorsInfo>) : null)).catch(() => null),
      ]);
      if (!p.ok) throw new Error(p.body.error?.message ?? "unauthorized");
      setPending(p.body.pending ?? []);
      setStuck(p.body.stuck ?? []);
      setHealth(h);
      setCi(c);
      setAnchors(a);
      setSponsor(s.ok ? s.body : null);
      setError(s.ok ? null : (s.body.error?.message ?? null));
    } catch (err) {
      setPending(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [token, auth]);

  useEffect(() => {
    if (!token) return;
    void load();
    const id = setInterval(() => void load(), 10_000);
    return () => clearInterval(id);
  }, [token, load]);

  const switchAnchor = async (homeDomain: string) => {
    setBusy("anchor");
    setAnchorNote(null);
    try {
      const res = await fetch("/api/booth/admin/anchor", auth({ method: "POST", body: JSON.stringify({ homeDomain }) }));
      const body = (await res.json()) as { active?: string; error?: { message: string } };
      if (!res.ok || !body.active) throw new Error(body.error?.message ?? `HTTP ${res.status}`);
      setAnchorNote(`${t.admin.anchorSwitched}: ${body.active}`);
      await load();
    } catch (err) {
      setAnchorNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  };

  const play = async () => {
    setBusy("play");
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/booth/admin/play-bank", auth({ method: "POST", body: "{}" }));
      const body = (await res.json()) as PlayResult & { error?: { message: string } };
      if (!res.ok) throw new Error(body.error?.message ?? `HTTP ${res.status}`);
      setResult(body);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  };

  const resume = async (depositId: string) => {
    setBusy("play");
    setError(null);
    setResumed(null);
    try {
      const res = await fetch("/api/booth/admin/resume", auth({ method: "POST", body: JSON.stringify({ depositId }) }));
      const body = (await res.json()) as { error?: { message: string } };
      if (!res.ok) throw new Error(body.error?.message ?? `HTTP ${res.status}`);
      setResumed(depositId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  };

  const fund = async () => {
    setBusy("fund");
    setError(null);
    try {
      const res = await fetch("/api/booth/admin/fund-sponsor", auth({ method: "POST", body: "{}" }));
      const body = (await res.json()) as Sponsor & { hash?: string; error?: { message: string } };
      if (!res.ok) throw new Error(body.error?.message ?? `HTTP ${res.status}`);
      setSponsor(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  };

  // Seed: new kumbara with this device's passkey → deposit + play bank → pipeline → autopilot.
  const seedDemo = async () => {
    setBusy("seed");
    setError(null);
    seedAutopilot.current = false;
    try {
      setSeed({ contractId: "", deposit: null, stage: "creating" });
      // Tag the creation so the counter files this account under "seed", briefly.
      document.cookie = "kumbara_ref=seed; path=/; max-age=120; SameSite=Lax";
      await disconnect().catch(() => undefined);
      const created = await createWallet({ userName: "kumbara-demo", fund: false, authenticatorSelection: { residentKey: "required", userVerification: "required" } });
      setSeed({ contractId: created.contractId, deposit: null, stage: "depositing" });
      const res = await fetch("/api/booth/admin/seed", auth({ method: "POST", body: JSON.stringify({ contractId: created.contractId }) }));
      const body = (await res.json()) as { deposit?: SeedDeposit; error?: { message: string } };
      if (!res.ok || !body.deposit) throw new Error(body.error?.message ?? `HTTP ${res.status}`);
      setSeed({ contractId: created.contractId, deposit: body.deposit, stage: "depositing" });
    } catch (err) {
      const sembolError = toSembolError(err);
      setSeed((s) => ({ contractId: s?.contractId ?? "", deposit: s?.deposit ?? null, stage: "error", message: sembolError.userMessage }));
    } finally {
      setBusy("");
    }
  };

  // Poll the seed deposit and run the autopilot when the USDC lands.
  const seedDepositId = seed?.deposit?.id;
  const seedStage = seed?.stage;
  useEffect(() => {
    if (!seedDepositId || seedStage === "done" || seedStage === "error") return;
    const id = setInterval(async () => {
      try {
        const res = await fetch(`/api/deposit/${seedDepositId}`);
        const next = (await res.json()) as SeedDeposit;
        setSeed((s) => (s ? { ...s, deposit: next } : s));
        if (next.status === "failed") setSeed((s) => (s ? { ...s, stage: "error", message: next.error?.message } : s));
        if (next.status === "in_vault") setSeed((s) => (s ? { ...s, stage: "done" } : s));
      } catch {
        /* next tick */
      }
    }, 3000);
    return () => clearInterval(id);
  }, [seedDepositId, seedStage]);

  // Every step is bounded (the scheduled E2E once sat on a hung submit for four minutes); one automatic
  // retry, then the presenter's "put it in the vault" button takes over.
  const runSeedAutopilot = useCallback(async () => {
    if (!seed?.deposit?.paidUsdc || !kit || !info || !address) {
      // Not ready yet: let the effect kick again instead of leaving the seed parked on "putting it in the vault".
      seedAutopilot.current = false;
      return;
    }
    setSeed((s) => (s ? { ...s, stage: "autopilot" } : s));
    const { id, paidUsdc } = seed.deposit;
    const attempt = async (n: number) => {
      const started = Date.now();
      console.info(`[kumbara] seed autopilot attempt ${n}: vault deposit ${paidUsdc} USDC for ${id}`);
      const tx = await withTimeout(buildVaultDeposit(kit, info.vault.id, address, paidUsdc), 30_000, "vault deposit build");
      console.info(`[kumbara] seed autopilot attempt ${n}: built in ${Date.now() - started} ms, signing and submitting`);
      const signed = await withTimeout(signAndSubmit(tx), 90_000, "vault deposit submit");
      console.info(`[kumbara] seed autopilot attempt ${n}: submitted ${signed.hash.slice(0, 8)} at ${Date.now() - started} ms`);
      const res = await withTimeout(fetch(`/api/deposit/${id}/vault`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ hash: signed.hash, amountUsdc: paidUsdc }) }), 30_000, "vault deposit record");
      const recorded = (await res.json()) as SeedDeposit;
      if (recorded.status === "in_wallet") throw new StepTimeoutError("the server did not record the vault deposit yet");
      return recorded;
    };
    try {
      let next: SeedDeposit;
      try {
        next = await attempt(1);
      } catch (first) {
        if (!(first instanceof StepTimeoutError)) throw first;
        console.warn(`[kumbara] seed autopilot: ${first.message}; retrying once`);
        next = await attempt(2);
      }
      setSeed((s) => (s ? { ...s, deposit: next, stage: next.status === "in_vault" ? "done" : s.stage } : s));
    } catch (err) {
      console.error("[kumbara] seed autopilot failed", err instanceof Error ? err.message : String(err));
      setSeed((s) => (s ? { ...s, stage: "needs_tap", message: toSembolError(err).userMessage } : s));
    }
  }, [seed?.deposit, kit, info, address, signAndSubmit]);

  const seedDepositStatus = seed?.deposit?.status;
  const seedContract = seed?.contractId;
  useEffect(() => {
    if (seedDepositStatus !== "in_wallet" || seedAutopilot.current || !kit || !info || address !== seedContract) return;
    seedAutopilot.current = true;
    const kick = setTimeout(() => void runSeedAutopilot(), 0);
    return () => clearTimeout(kick);
  }, [seedDepositStatus, seedContract, kit, info, address, runSeedAutopilot]);

  const newest = pending?.[0] ?? null;
  const deps = health && "anchor" in health.dependencies ? health.dependencies : null;

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-5 px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">{t.admin.title}</h1>
        <NetworkBadge />
      </div>
      <p className="text-sm text-ink-2">{t.admin.lead}</p>

      {!token && (
        <form
          className="card flex flex-col gap-3 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            const value = (new FormData(e.currentTarget).get("token") as string | null)?.trim() ?? "";
            if (value) setToken(value);
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            <span className="microlabel">{t.admin.tokenLabel}</span>
            <input name="token" type="password" autoComplete="off" className="rounded-xl border border-line bg-paper px-3 py-2 font-mono" />
          </label>
          <button type="submit" className="btn-secondary">
            {t.admin.tokenSubmit}
          </button>
        </form>
      )}

      {token && (
        <>
          {ci?.status === "failed" ? (
            <div role="alert" data-testid="ci-banner" className="rounded-xl border border-danger/40 bg-danger/10 p-4 text-sm">
              <p className="font-semibold text-danger">{t.admin.ciFailed}</p>
              <p className="mt-1 text-ink-2">
                {t.admin.ciFailedHint.replace("{step}", ci.step ?? "?")}
                {ci.at ? ` · ${new Date(ci.at).toLocaleString(locale === "tr" ? "tr-TR" : "en-US")}` : ""}
              </p>
              {ci.runUrl ? (
                <a href={ci.runUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-teal underline">
                  {t.admin.ciRun} ↗
                </a>
              ) : null}
            </div>
          ) : ci?.status === "ok" ? (
            <p className="text-xs text-mint" data-testid="ci-banner">
              ✓ {t.admin.ciOk}
              {ci.at ? ` · ${new Date(ci.at).toLocaleString(locale === "tr" ? "tr-TR" : "en-US")}` : ""}
            </p>
          ) : null}
          <section className="card p-5" aria-label={t.admin.health}>
            <p className="microlabel">{t.admin.health}</p>
            <ul className="mt-3 grid grid-cols-2 gap-2 text-sm" data-testid="health-dots">
              {(["anchor", "relay", "rpc", "vault"] as const).map((name) => {
                const dep = deps?.[name];
                return (
                  <li key={name} className="flex items-center gap-2" title={dep?.detail ?? ""}>
                    <span role="img" className={`h-3 w-3 rounded-full ${dep ? (dep.ok ? "bg-mint" : "bg-danger") : "bg-line"}`} aria-label={dep ? (dep.ok ? "ok" : "down") : "unknown"} />
                    <span className="font-medium">{t.admin.healthNames[name]}</span>
                    {dep && <span className="tnum text-xs text-muted">{dep.ms} ms</span>}
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="card p-5" aria-label={t.admin.anchor}>
            <p className="microlabel">{t.admin.anchor}</p>
            <p className="mt-1 text-xs text-muted">{t.admin.anchorHint}</p>
            {anchors ? (
              <ul className="mt-3 flex flex-col gap-2" data-testid="anchor-list">
                {anchors.anchors.map((a) => (
                  <li key={a.homeDomain} className="rounded-xl border border-line p-3">
                    <label className="flex cursor-pointer items-start gap-3">
                      <input type="radio" name="anchor" className="mt-1" checked={a.homeDomain === anchors.active} disabled={busy !== "" || !a.ok} onChange={() => void switchAnchor(a.homeDomain)} aria-label={`${t.admin.anchorSwitch}: ${a.homeDomain}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold">
                          {a.orgName ?? a.homeDomain}
                          {a.homeDomain === anchors.active ? <span className="ml-2 rounded-full bg-paper-2 px-2 py-0.5 text-xs font-medium text-teal">{t.admin.anchorActive}</span> : null}
                        </span>
                        <span className="block break-all font-mono text-xs text-muted">{a.homeDomain}</span>
                        <span className="block text-xs text-muted">
                          {a.ok ? `${a.asset?.code ?? ""}${a.fiatCode ? ` ⇄ ${a.fiatCode}` : ""}${a.limits?.fiat ? ` · ${a.limits.fiat.min ?? "?"}–${a.limits.fiat.max ?? "?"} ${a.fiatCode ?? ""}` : ""} · ${a.treasury ? t.admin.anchorHook : t.admin.anchorNoHook}` : `${t.admin.anchorUnavailable}: ${a.error ?? ""}`}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted">{t.savings.loading}</p>
            )}
            {anchorNote ? <p className="mt-2 text-sm" role="status">{anchorNote}</p> : null}
          </section>

          <section className="card p-5" aria-label={t.admin.sponsor}>
            <p className="microlabel">{t.admin.sponsor}</p>
            {sponsor ? (
              <div className="mt-2 text-sm">
                <p className={`tnum text-2xl font-bold ${sponsor.ok ? "text-mint" : "text-danger"}`} data-testid="sponsor-balance">
                  {sponsor.balanceXlm.toLocaleString(locale === "tr" ? "tr-TR" : "en-US", { maximumFractionDigits: 2 })} XLM
                </p>
                <p className={sponsor.ok ? "text-mint" : "text-danger"}>
                  {sponsor.ok ? t.admin.sponsorOk : t.admin.sponsorLow} · min {sponsor.minXlm} · max {sponsor.maxXlm}
                </p>
                <p className="mt-1 break-all font-mono text-xs text-muted">{sponsor.publicKey}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <a href={`${EXPLORER_BASE}/account/${sponsor.publicKey}`} target="_blank" rel="noreferrer" className="btn-secondary min-h-9 px-3 text-xs">
                    stellar.expert · {NETWORK_LABEL}
                  </a>
                  {NETWORK === "testnet" ? (
                    <button type="button" onClick={() => void fund()} disabled={busy !== ""} className="btn-secondary min-h-9 px-3 text-xs">
                      {busy === "fund" ? t.savings.loading : t.admin.sponsorFund}
                    </button>
                  ) : (
                    <span className="text-xs text-muted">{t.admin.sponsorFundHint}</span>
                  )}
                </div>
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted">{t.savings.loading}</p>
            )}
          </section>

          <section className="card flex flex-col gap-4 p-5" aria-live="polite" aria-label={t.admin.pending}>
            <div>
              <p className="microlabel">{t.admin.newest}</p>
              {pending === null ? (
                <p className="mt-1 text-sm text-muted">{t.savings.loading}</p>
              ) : newest ? (
                <div className="mt-1 text-sm">
                  <p className="font-mono font-semibold">{newest.reference}</p>
                  <p className="tnum text-ink-2">
                    ₺{newest.amountTry} · {newest.contractId.slice(0, 6)}…{newest.contractId.slice(-4)} · {new Date(newest.createdAt).toLocaleTimeString()}
                  </p>
                  {pending.length > 1 && (
                    <p className="text-xs text-muted">
                      +{pending.length - 1} {t.admin.more}
                    </p>
                  )}
                </div>
              ) : (
                <p className="mt-1 text-sm text-muted">{t.admin.none}</p>
              )}
            </div>
            <button type="button" onClick={() => void play()} disabled={busy !== "" || !newest} className="btn-primary w-full text-lg">
              {busy === "play" ? t.savings.loading : t.admin.play}
            </button>
            {result && (
              <p className="rounded-xl bg-mint/10 p-3 text-sm text-mint" role="status">
                {t.admin.played} ₺{result.amountTry} · {result.reference} · {result.transferStatus}
              </p>
            )}
          </section>

          {stuck.length > 0 && (
            <section className="card flex flex-col gap-3 p-5" aria-label={t.admin.stuck}>
              <p className="microlabel">{t.admin.stuck}</p>
              <ul className="flex flex-col gap-2 text-sm">
                {stuck.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3 rounded-xl bg-paper-2 p-3">
                    <div>
                      <p className="tnum font-semibold">
                        ₺{d.amountTry} → {d.usdc ?? "?"} USDC · {d.status === "abandoned" ? t.deposit.steps.abandoned : d.status === "failed" ? t.failures.kinds.amount_mismatch.title : t.deposit.steps.onramp_pending}
                      </p>
                      <p className="font-mono text-xs text-muted">
                        {d.id} · {d.contractId.slice(0, 6)}…{d.contractId.slice(-4)} · {d.anchorTxId ?? ""}
                      </p>
                      {d.landing ? (
                        <p className="mt-1 text-xs text-ink-2">
                          {t.failures.landingLabel}: <a href={`${EXPLORER_BASE}/account/${d.landing}`} target="_blank" rel="noreferrer" className="font-mono text-teal underline">{d.landing.slice(0, 8)}…{d.landing.slice(-6)}</a> · {t.admin.paid} {d.paidUsdc ?? "?"} / {d.usdc ?? "?"} USDC
                        </p>
                      ) : null}
                    </div>
                    {(d.status === "abandoned" || d.status === "failed") && (
                      <button type="button" onClick={() => void resume(d.id)} disabled={busy !== ""} className="btn-secondary min-h-9 px-3 text-xs">
                        {t.admin.resume}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {resumed && (
                <p className="text-sm text-mint" role="status">
                  {t.admin.resumed}
                </p>
              )}
            </section>
          )}

          <section className="card flex flex-col gap-3 p-5" aria-label={t.admin.seed}>
            <p className="microlabel">{t.admin.seed}</p>
            <p className="text-sm text-ink-2">{t.admin.seedHint}</p>
            <button type="button" onClick={() => void seedDemo()} disabled={busy !== "" || !info || (seed !== null && seed.stage !== "done" && seed.stage !== "error")} className="btn-secondary">
              {busy === "seed" || (seed && seed.stage !== "done" && seed.stage !== "error" && seed.stage !== "needs_tap") ? t.admin.seedRunning : t.admin.seed}
            </button>
            {seed && (
              <div className="rounded-xl bg-paper-2 p-3 text-sm" role="status" data-testid="seed-status">
                <p className="font-mono text-xs">{seed.contractId || "…"}</p>
                <p className="mt-1">
                  {seed.stage === "done" ? t.admin.seedDone : seed.stage === "error" ? (seed.message ?? t.errors.generic) : seed.deposit ? t.deposit.steps[(seed.deposit.status as keyof typeof t.deposit.steps) ?? "awaiting_transfer"] : t.admin.seedRunning}
                </p>
                {seed.stage === "needs_tap" && (
                  <button type="button" onClick={() => void runSeedAutopilot()} className="btn-primary mt-2 min-h-9 px-3 text-xs">
                    {t.admin.seedTap}
                  </button>
                )}
                {seed.stage === "done" && (
                  <Link href="/kumbara" className="btn-primary mt-2 min-h-9 px-3 text-xs">
                    {t.nav.savings} →
                  </Link>
                )}
              </div>
            )}
          </section>

          {error && (
            <p className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger" role="alert">
              {error}
            </p>
          )}
          <div className="flex items-center justify-between text-xs">
            <Link href="/booth?n=1" className="text-teal hover:underline">
              {t.admin.qr} →
            </Link>
            <button type="button" onClick={() => setToken("")} className="text-muted hover:underline">
              {t.admin.forget}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
