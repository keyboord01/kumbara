"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toSembolError, usePasskeyWallet, useSignTransaction } from "@sembol/passkey-react";
import { cn } from "cn";
import { ExternalLinkIcon, ShieldAlertIcon, WifiOffIcon } from "lucide-react";
import { NetworkBadge } from "@/components/NetworkBadge";
import { Skeleton } from "@/components/Skeleton";
import { Spinner } from "@/components/Spinner";
import { useToast } from "@/components/Toaster";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
  availableXlm: number;
  sponsoring: number;
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
interface TickItem {
  id: string;
  from: string;
  to: string;
  steps: number;
  note?: string;
}
interface TickResult {
  at: string;
  elapsedMs: number;
  skipped?: "tick_in_progress";
  deposits: TickItem[];
  withdrawals: TickItem[];
}
interface ApiErrorBody {
  error?: { code?: string; message?: string } | string;
}

/** Every admin action shows the server's own reason: status, code and message, never just "HTTP 409". */
function reason(res: Response, body: ApiErrorBody | null): string {
  const err = body?.error;
  if (typeof err === "string") return `${res.status} ${err}`;
  const code = err?.code ?? "error";
  const message = err?.message ?? "";
  return `${res.status} ${code}${message ? ` — ${message}` : ""}`;
}

function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError || (typeof navigator !== "undefined" && navigator.onLine === false);
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
  const { toast } = useToast();
  const [token, setToken] = useState("");
  const [pending, setPending] = useState<Pending[] | null>(null);
  const [stuck, setStuck] = useState<Stuck[]>([]);
  const [resumed, setResumed] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [sponsor, setSponsor] = useState<Sponsor | null>(null);
  const [ci, setCi] = useState<CiStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"" | "play" | "fund" | "seed" | "anchor" | "sweep">("");
  const [sweepNote, setSweepNote] = useState<string | null>(null);
  const [anchors, setAnchors] = useState<AnchorsInfo | null>(null);
  const [anchorNote, setAnchorNote] = useState<string | null>(null);
  const [result, setResult] = useState<PlayResult | null>(null);
  const [seed, setSeed] = useState<{ contractId: string; deposit: SeedDeposit | null; stage: "creating" | "depositing" | "autopilot" | "needs_tap" | "done" | "error"; message?: string | undefined } | null>(null);
  const seedAutopilot = useRef(false);
  /** The driver: a tick every 5 s while this page is open; the GitHub cron is the backstop. */
  const [driver, setDriver] = useState<{ on: boolean; lastAt: number; last: TickResult | null; error: string | null }>({ on: false, lastAt: 0, last: null, error: null });
  const tickInFlight = useRef(false);
  const [offline, setOffline] = useState(false);
  const [reconnected, setReconnected] = useState(false);
  const [clock, setClock] = useState(0);

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
      setOffline((was) => {
        if (was) setReconnected(true);
        return false;
      });
    } catch (err) {
      if (isNetworkError(err)) {
        setOffline(true);
        return;
      }
      setPending(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [token, auth]);

  // The driver: advance every pending deposit and withdrawal server-side, whether or not the visitor's page is open.
  const tick = useCallback(async () => {
    if (!token || tickInFlight.current) return;
    tickInFlight.current = true;
    try {
      const res = await fetch("/api/pipeline/tick", auth({ method: "POST", body: "{}" }));
      const body = (await res.json()) as TickResult & ApiErrorBody;
      if (!res.ok) throw new Error(reason(res, body));
      setDriver({ on: true, lastAt: Date.now(), last: body, error: null });
      setOffline((was) => {
        if (was) setReconnected(true);
        return false;
      });
    } catch (err) {
      if (isNetworkError(err)) setOffline(true);
      setDriver((d) => ({ ...d, on: false, error: err instanceof Error ? err.message : String(err) }));
    } finally {
      tickInFlight.current = false;
    }
  }, [token, auth]);

  useEffect(() => {
    if (!token) return;
    void tick();
    const id = setInterval(() => void tick(), 5_000);
    const clockId = setInterval(() => setClock(Date.now()), 1_000);
    return () => {
      clearInterval(id);
      clearInterval(clockId);
    };
  }, [token, tick]);

  // Network suspension (laptop lid, Wi-Fi drop, tab throttled): resume at once when the browser is back, and say so.
  useEffect(() => {
    if (!token) return;
    const resume = () => {
      void load();
      void tick();
    };
    const onOffline = () => setOffline(true);
    const onVisible = () => {
      if (document.visibilityState === "visible") resume();
    };
    window.addEventListener("online", resume);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", resume);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [token, load, tick]);

  useEffect(() => {
    if (!reconnected) return;
    toast({ title: t.toast.reconnected, body: t.admin.reconnected, variant: "success", key: "net" });
    const id = setTimeout(() => setReconnected(false), 8_000);
    return () => clearTimeout(id);
  }, [reconnected, toast, t]);

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
      const body = (await res.json()) as { active?: string } & ApiErrorBody;
      if (!res.ok || !body.active) throw new Error(reason(res, body));
      setAnchorNote(`${t.admin.anchorSwitched}: ${body.active}`);
      toast({ title: t.toast.anchorSwitched, body: body.active, variant: "success", key: "anchor" });
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
      const body = (await res.json()) as PlayResult & ApiErrorBody;
      if (!res.ok) throw new Error(reason(res, body));
      setResult(body);
      toast({ title: t.toast.bankPlayed, body: `₺${body.amountTry} · ${body.reference} · ${body.transferStatus}`, variant: "success", key: "bank" });
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast({ title: t.admin.reasonLabel, body: message, variant: "error", key: "reason" });
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
      const body = (await res.json()) as ApiErrorBody;
      if (!res.ok) throw new Error(reason(res, body));
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
      const body = (await res.json()) as Sponsor & { hash?: string } & ApiErrorBody;
      if (!res.ok) throw new Error(reason(res, body));
      setSponsor(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  };

  // Sweep: merge back the bridge accounts of finished deposits and withdrawals so their reserves return to the sponsor.
  const sweep = async () => {
    setBusy("sweep");
    setSweepNote(null);
    try {
      const res = await fetch("/api/booth/admin/sweep", auth({ method: "POST", body: "{}" }));
      const body = (await res.json()) as { merged?: number; skipped?: number; examined?: number; items?: Array<{ id: string; action: string; note?: string }> } & ApiErrorBody;
      if (!res.ok) throw new Error(reason(res, body));
      setSweepNote(`${t.admin.sweepDone}: ${body.merged ?? 0} ${t.admin.sweepMerged}, ${body.skipped ?? 0} ${t.admin.sweepSkipped} (${body.examined ?? 0} ${t.admin.sweepExamined})`);
      toast({ title: t.toast.sweepDone, body: `${body.merged ?? 0} ${t.admin.sweepMerged} · ${body.skipped ?? 0} ${t.admin.sweepSkipped}`, variant: body.merged ? "success" : "info", key: "sweep" });
      await load();
    } catch (err) {
      setSweepNote(`${t.admin.reasonLabel}: ${err instanceof Error ? err.message : String(err)}`);
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
      const body = (await res.json()) as { deposit?: SeedDeposit } & ApiErrorBody;
      if (!res.ok || !body.deposit) throw new Error(reason(res, body));
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
  const intl = locale === "tr" ? "tr-TR" : "en-US";
  const driverOn = driver.on && !offline;
  const seedRunning = busy === "seed" || (seed !== null && seed.stage !== "done" && seed.stage !== "error" && seed.stage !== "needs_tap");

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-5 px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">{t.admin.title}</h1>
        <NetworkBadge />
      </div>
      <p className="text-sm text-ink-2">{t.admin.lead}</p>

      {!token && (
        <Card
          render={
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const value = (new FormData(e.currentTarget).get("token") as string | null)?.trim() ?? "";
                if (value) setToken(value);
              }}
            />
          }
        >
          <CardContent>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="admin-token" className="microlabel">
                  {t.admin.tokenLabel}
                </FieldLabel>
                <Input id="admin-token" name="token" type="password" autoComplete="off" className="font-mono" />
              </Field>
            </FieldGroup>
          </CardContent>
          <CardFooter>
            <Button type="submit" variant="outline">
              {t.admin.tokenSubmit}
            </Button>
          </CardFooter>
        </Card>
      )}

      {token && (
        <>
          {ci?.status === "failed" ? (
            <Alert variant="destructive" data-testid="ci-banner">
              <ShieldAlertIcon />
              <AlertTitle>{t.admin.ciFailed}</AlertTitle>
              <AlertDescription>
                <p>
                  {t.admin.ciFailedHint.replace("{step}", ci.step ?? "?")}
                  {ci.at ? ` · ${new Date(ci.at).toLocaleString(intl)}` : ""}
                </p>
                {ci.runUrl ? (
                  <a href={ci.runUrl} target="_blank" rel="noreferrer" className="w-fit rounded-sm text-teal underline underline-offset-4">
                    {t.admin.ciRun} ↗
                  </a>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : ci?.status === "ok" ? (
            <p className="text-xs text-mint-2" data-testid="ci-banner">
              ✓ {t.admin.ciOk}
              {ci.at ? ` · ${new Date(ci.at).toLocaleString(intl)}` : ""}
            </p>
          ) : null}
          {offline ? (
            <Alert data-testid="reconnect-banner" className="border-amber/40 bg-amber/10">
              <WifiOffIcon className="text-amber" />
              <AlertTitle>{t.admin.reconnecting}</AlertTitle>
            </Alert>
          ) : reconnected ? (
            <Alert role="status" data-testid="reconnected" className="border-mint/30 bg-mint/10">
              <AlertTitle className="text-mint-2">{t.admin.reconnected}</AlertTitle>
            </Alert>
          ) : null}

          <Card render={<section aria-label={t.admin.driver} />}>
            <CardHeader>
              <CardTitle className="microlabel">{t.admin.driver}</CardTitle>
              <CardDescription className="text-xs">{t.admin.driverHint}</CardDescription>
              <CardAction>
                <Badge variant={driverOn ? "success" : "destructive"} data-testid="driver" data-on={driverOn ? "true" : "false"}>
                  {driverOn ? t.admin.driverOn : t.admin.driverOff}
                </Badge>
              </CardAction>
            </CardHeader>
            <CardContent>
              <p className="tnum text-xs text-ink-2" data-testid="driver-last">
                {driver.last
                  ? `${t.admin.driverLast}: ${Math.max(0, Math.round((clock - driver.lastAt) / 1000))} s · ${driver.last.skipped ? t.admin.driverSkipped : (() => {
                      const moved = [...driver.last.deposits, ...driver.last.withdrawals].filter((i) => i.to !== i.from);
                      return moved.length ? `${moved.length} ${t.admin.driverAdvanced} (${moved.map((i) => `${i.id.slice(0, 8)}: ${i.from} → ${i.to}`).join(", ")})` : t.admin.driverIdle;
                    })()} · ${driver.last.elapsedMs} ms`
                  : driver.error
                    ? `${t.admin.reasonLabel}: ${driver.error}`
                    : "…"}
              </p>
            </CardContent>
          </Card>

          <Card render={<section aria-live="polite" aria-label={t.admin.pending} />}>
            <CardHeader>
              <CardTitle className="microlabel">{t.admin.newest}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {pending === null ? (
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-8 w-48" />
                  <Skeleton className="h-4 w-64" />
                </div>
              ) : newest ? (
                <div className="flex flex-col gap-1">
                  <p className="font-mono text-2xl font-bold tracking-tight text-foreground">{newest.reference}</p>
                  <p className="tnum text-sm text-ink-2">
                    ₺{newest.amountTry} · {newest.contractId.slice(0, 6)}…{newest.contractId.slice(-4)} · {new Date(newest.createdAt).toLocaleTimeString()}
                  </p>
                  {pending.length > 1 && (
                    <p className="text-xs text-muted-foreground">
                      +{pending.length - 1} {t.admin.more}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t.admin.none}</p>
              )}
              <Button size="xl" className="w-full" onClick={() => void play()} disabled={busy !== "" || !newest} aria-busy={busy === "play" ? "true" : undefined}>
                {busy === "play" ? <Spinner data-icon="inline-start" /> : null}
                {t.admin.play}
              </Button>
              {result && (
                <Alert role="status" className="border-mint/30 bg-mint/10">
                  <AlertDescription className="text-mint-2">
                    {t.admin.played} ₺{result.amountTry} · {result.reference} · {result.transferStatus}
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          <Card render={<section aria-label={t.admin.health} />}>
            <CardHeader>
              <CardTitle className="microlabel">{t.admin.health}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-wrap gap-2" data-testid="health-dots">
                {(["anchor", "relay", "rpc", "vault"] as const).map((name) => {
                  const dep = deps?.[name];
                  return (
                    <li key={name}>
                      <Badge variant={dep ? (dep.ok ? "success" : "destructive") : "secondary"} className="h-7 gap-2 px-3 text-sm text-foreground" title={dep?.detail ?? ""}>
                        <span role="img" className={cn("size-2.5 rounded-full", dep ? (dep.ok ? "bg-mint" : "bg-destructive") : "bg-input")} aria-label={dep ? (dep.ok ? "ok" : "down") : "unknown"} />
                        {t.admin.healthNames[name]}
                        {dep ? <span className="tnum text-[11px] font-normal text-muted-foreground">{dep.ms} ms</span> : <Spinner className="size-3 text-muted-foreground" />}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>

          <Card render={<section aria-label={t.admin.anchor} />}>
            <CardHeader>
              <CardTitle className="microlabel">{t.admin.anchor}</CardTitle>
              <CardDescription className="text-xs">{t.admin.anchorHint}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {anchors ? (
                <RadioGroup value={anchors.active} onValueChange={(value) => void switchAnchor(String(value))} disabled={busy !== ""} aria-label={t.admin.anchorSwitch} data-testid="anchor-list">
                  {anchors.anchors.map((a) => (
                    <Item key={a.homeDomain} variant="outline" render={<label />} className="cursor-pointer items-start">
                      <ItemMedia>
                        <RadioGroupItem value={a.homeDomain} disabled={!a.ok} aria-label={`${t.admin.anchorSwitch}: ${a.homeDomain}`} className="mt-0.5" />
                      </ItemMedia>
                      <ItemContent>
                        <ItemTitle className="gap-2">
                          {a.orgName ?? a.homeDomain}
                          {a.homeDomain === anchors.active ? <Badge variant="info">{t.admin.anchorActive}</Badge> : null}
                        </ItemTitle>
                        <ItemDescription className="break-all font-mono text-xs">{a.homeDomain}</ItemDescription>
                        <ItemDescription className="text-xs">
                          {a.ok ? `${a.asset?.code ?? ""}${a.fiatCode ? ` ⇄ ${a.fiatCode}` : ""}${a.limits?.fiat ? ` · ${a.limits.fiat.min ?? "?"}–${a.limits.fiat.max ?? "?"} ${a.fiatCode ?? ""}` : ""} · ${a.treasury ? t.admin.anchorHook : t.admin.anchorNoHook}` : `${t.admin.anchorUnavailable}: ${a.error ?? ""}`}
                        </ItemDescription>
                      </ItemContent>
                    </Item>
                  ))}
                </RadioGroup>
              ) : (
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              )}
              {anchorNote ? (
                <p className="text-sm" role="status">
                  {anchorNote}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card render={<section aria-label={t.admin.sponsor} />}>
            <CardHeader>
              <CardTitle className="microlabel">{t.admin.sponsor}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              {sponsor ? (
                <>
                  <div className="flex flex-col gap-1">
                    <p className={cn("tnum text-2xl font-bold", sponsor.ok ? "text-mint-2" : "text-destructive")} data-testid="sponsor-balance">
                      {sponsor.availableXlm.toLocaleString(intl, { maximumFractionDigits: 2 })} XLM
                    </p>
                    <p className={sponsor.ok ? "text-mint-2" : "text-destructive"}>
                      {sponsor.ok ? t.admin.sponsorOk : t.admin.sponsorLow} · min {sponsor.minXlm} · max {sponsor.maxXlm}
                    </p>
                    <p className="tnum text-xs text-muted-foreground" data-testid="sponsor-reserves">
                      {t.admin.sponsorHeld.replace("{held}", sponsor.balanceXlm.toLocaleString(intl, { maximumFractionDigits: 2 })).replace("{count}", String(sponsor.sponsoring))}
                    </p>
                    <p className="break-all font-mono text-xs text-muted-foreground">{sponsor.publicKey}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" render={<a href={`${EXPLORER_BASE}/account/${sponsor.publicKey}`} target="_blank" rel="noreferrer" />}>
                      stellar.expert · {NETWORK_LABEL}
                      <ExternalLinkIcon data-icon="inline-end" />
                    </Button>
                    {NETWORK === "testnet" ? (
                      <Button variant="outline" size="sm" onClick={() => void fund()} disabled={busy !== ""} aria-busy={busy === "fund" ? "true" : undefined}>
                        {busy === "fund" ? <Spinner data-icon="inline-start" /> : null}
                        {t.admin.sponsorFund}
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">{t.admin.sponsorFundHint}</span>
                    )}
                    <Button variant="outline" size="sm" onClick={() => void sweep()} disabled={busy !== ""} aria-busy={busy === "sweep" ? "true" : undefined} data-testid="sweep">
                      {busy === "sweep" ? <Spinner data-icon="inline-start" /> : null}
                      {t.admin.sweep}
                    </Button>
                  </div>
                  {sweepNote ? (
                    <p className="text-xs" role="status" data-testid="sweep-note">
                      {sweepNote}
                    </p>
                  ) : null}
                </>
              ) : (
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-8 w-40" />
                  <Skeleton className="h-4 w-56" />
                </div>
              )}
            </CardContent>
          </Card>

          {stuck.length > 0 && (
            <Card render={<section aria-label={t.admin.stuck} />}>
              <CardHeader>
                <CardTitle className="microlabel">{t.admin.stuck}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <ItemGroup className="gap-2">
                  {stuck.map((d) => (
                    <Item key={d.id} variant="muted" size="sm">
                      <ItemContent>
                        <ItemTitle className="tnum">
                          ₺{d.amountTry} → {d.usdc ?? "?"} USDC · {d.status === "abandoned" ? t.deposit.steps.abandoned : d.status === "failed" ? t.failures.kinds.amount_mismatch.title : t.deposit.steps.onramp_pending}
                        </ItemTitle>
                        <ItemDescription className="font-mono text-xs">
                          {d.id} · {d.contractId.slice(0, 6)}…{d.contractId.slice(-4)} · {d.anchorTxId ?? ""}
                        </ItemDescription>
                        {d.landing ? (
                          <ItemDescription className="text-xs text-ink-2">
                            {t.failures.landingLabel}:{" "}
                            <a href={`${EXPLORER_BASE}/account/${d.landing}`} target="_blank" rel="noreferrer" className="font-mono text-teal underline underline-offset-4">
                              {d.landing.slice(0, 8)}…{d.landing.slice(-6)}
                            </a>{" "}
                            · {t.admin.paid} {d.paidUsdc ?? "?"} / {d.usdc ?? "?"} USDC
                          </ItemDescription>
                        ) : null}
                      </ItemContent>
                      {(d.status === "abandoned" || d.status === "failed") && (
                        <ItemActions>
                          <Button variant="outline" size="sm" onClick={() => void resume(d.id)} disabled={busy !== ""}>
                            {t.admin.resume}
                          </Button>
                        </ItemActions>
                      )}
                    </Item>
                  ))}
                </ItemGroup>
                {resumed && (
                  <p className="text-sm text-mint-2" role="status">
                    {t.admin.resumed}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          <Card render={<section aria-label={t.admin.seed} />}>
            <CardHeader>
              <CardTitle className="microlabel">{t.admin.seed}</CardTitle>
              <CardDescription className="text-ink-2">{t.admin.seedHint}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Button variant="outline" onClick={() => void seedDemo()} disabled={busy !== "" || !info || (seed !== null && seed.stage !== "done" && seed.stage !== "error")} aria-busy={seedRunning ? "true" : undefined}>
                {seedRunning ? <Spinner data-icon="inline-start" /> : null}
                {seedRunning ? t.admin.seedRunning : t.admin.seed}
              </Button>
              {seed && (
                <Alert role="status" data-testid="seed-status" className="bg-muted">
                  <AlertTitle className="font-mono text-xs font-normal">{seed.contractId || "…"}</AlertTitle>
                  <AlertDescription className="text-foreground">
                    <p>{seed.stage === "done" ? t.admin.seedDone : seed.stage === "error" ? (seed.message ?? t.errors.generic) : seed.deposit ? t.deposit.steps[(seed.deposit.status as keyof typeof t.deposit.steps) ?? "awaiting_transfer"] : t.admin.seedRunning}</p>
                    {seed.stage === "needs_tap" && (
                      <Button size="sm" className="w-fit" onClick={() => void runSeedAutopilot()}>
                        {t.admin.seedTap}
                      </Button>
                    )}
                    {seed.stage === "done" && (
                      <Button size="sm" className="w-fit" render={<Link href="/kumbara" />}>
                        {t.nav.savings} →
                      </Button>
                    )}
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          {error && (
            <Alert variant="destructive" data-testid="admin-error">
              <ShieldAlertIcon />
              <AlertTitle>{t.admin.reasonLabel}</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="flex items-center justify-between text-xs">
            <Link href="/booth?n=1" className="rounded-sm text-teal underline-offset-4 hover:underline">
              {t.admin.qr} →
            </Link>
            <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => setToken("")}>
              {t.admin.forget}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
