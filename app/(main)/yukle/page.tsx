"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePasskeyWallet, useSignTransaction, useWalletAddress } from "@sembol/passkey-react";
import { CheckIcon, CopyIcon, ExternalLinkIcon } from "lucide-react";
import QRCode from "qrcode";
import { cn } from "cn";
import { FailureScreen } from "@/components/FailureScreen";
import { ScreenSkeleton, Skeleton } from "@/components/Skeleton";
import { Spinner } from "@/components/Spinner";
import { Stepper, type StepperStep } from "@/components/Stepper";
import { useToast } from "@/components/Toaster";
import { NetworkBadge } from "@/components/NetworkBadge";
import { RequireWallet } from "@/components/RequireWallet";
import { ResumeNotice } from "@/components/ResumeNotice";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api } from "@/lib/api";
import { buildVaultDeposit } from "@/lib/autopilot";
import { EXPLORER_BASE, NETWORK_LABEL } from "@/lib/config";
import { StepTimeoutError, classifyError, classifyRecordError, withTimeout, type Failure } from "@/lib/failures";
import { formatTry, formatUsdc } from "@/lib/format";
import { useLocale } from "@/lib/i18n";
import { DEFAULT_LIMIT_USDC } from "@/lib/limits";
import { useAnchorInfo } from "@/lib/useAnchorInfo";

type DepositStatus = "awaiting_transfer" | "transfer_received" | "onramp_pending" | "onramp_paid" | "forwarded" | "in_wallet" | "in_vault" | "failed" | "cancelled" | "abandoned";

interface DepositRecord {
  id: string;
  status: DepositStatus;
  createdAt: string;
  updatedAt: string;
  amountTry: string;
  receivedTry?: string;
  indicative: { usdcOut: string; rate: string; spreadBps: number };
  firmQuote?: { usdcOut: string; rate: string };
  instructions: { bankName: string; iban: string; ibanFormatted: string; accountHolder: string; reference: string };
  /** Bridge account the anchor pays; visible so a parked amount can be found. */
  landing?: { publicKey: string };
  transferDeadline?: string;
  anchorTxHash?: string;
  forwardTxHash?: string;
  vaultTxHash?: string;
  paidUsdc?: string;
  error?: { code: string; message: string };
  lastError?: { at: string; message: string; code?: string };
}

const STEP_ORDER: DepositStatus[] = ["awaiting_transfer", "transfer_received", "onramp_pending", "onramp_paid", "forwarded", "in_wallet", "in_vault"];
const FINAL: DepositStatus[] = ["in_vault", "failed", "cancelled", "abandoned"];
const WAIT_EXTENSION_MS = 30 * 60_000;
/** A vault deposit (simulation + passkey + relay) that takes longer than this becomes a retryable failure. */
const STEP_TIMEOUT_MS = 120_000;
/** Form failures where "try again" would only repeat the same amount. */
const AMOUNT_FAILURES = new Set(["invalid_amount", "anchor_rejected", "insufficient_balance"]);
/** Steps the server (and the booth driver) takes on its own; the page can be closed during these. */
const PREVIEW_STEPS: DepositStatus[] = ["awaiting_transfer", "transfer_received", "onramp_paid", "in_wallet", "in_vault"];
const SERVER_STEPS = new Set(["awaiting_transfer", "transfer_received", "onramp_pending", "onramp_paid", "forwarded"]);
/** Typical wall-clock seconds per step, from the production round trips of 9–10 September (bank to vault 33–42 s in all). */
const TYPICAL_SECONDS: Partial<Record<string, number>> = { transfer_received: 8, onramp_pending: 8, onramp_paid: 10, forwarded: 6, in_wallet: 14 };

function CopyButton({ value, label, copiedLabel }: { value: string; label: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  return (
    <Button
      variant="outline"
      size="sm"
      aria-label={`${label}: ${value}`}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          toast({ title: copiedLabel, body: value, variant: "success", key: "copy" });
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}
      {label}
    </Button>
  );
}

type DepositMethod = "iban" | "address";

/**
 * The other way in: USDC sent straight to the kumbara's contract address from
 * a Soroban-capable wallet or another kumbara. Nothing to submit here; once it
 * lands, Savings offers to put it in the vault.
 */
function AddressDeposit() {
  const { t } = useLocale();
  const { address, explorerUrl } = useWalletAddress();
  const [svg, setSvg] = useState("");
  useEffect(() => {
    if (!address) return;
    QRCode.toString(address, { type: "svg", errorCorrectionLevel: "M", margin: 1, color: { dark: "#12313a", light: "#ffffff" } })
      .then(setSvg)
      .catch(() => setSvg(""));
  }, [address]);
  if (!address) return null;
  return (
    <div className="grid gap-4 lg:grid-cols-[3fr_2fr] lg:items-start">
      <Card>
        <CardHeader>
          <CardTitle>{t.deposit.addressTitle}</CardTitle>
          <CardDescription className="text-ink-2">{t.deposit.addressLead}</CardDescription>
          <CardAction>
            <Badge variant="info">{t.deposit.addressAsset}</Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
            {svg ? <Card size="sm" className="w-full max-w-[180px] flex-none px-(--card-spacing)" role="img" aria-label={address} dangerouslySetInnerHTML={{ __html: svg }} /> : <Skeleton className="size-[180px]" />}
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <p className="break-all font-mono text-sm text-foreground" data-testid="deposit-address">
                {address}
              </p>
              <div className="flex flex-wrap gap-2">
                <CopyButton value={address} label={t.deposit.copy} copiedLabel={t.deposit.copied} />
                {explorerUrl ? (
                  <Button variant="outline" size="sm" render={<a href={explorerUrl} target="_blank" rel="noreferrer" />}>
                    stellar.expert · {NETWORK_LABEL}
                    <ExternalLinkIcon data-icon="inline-end" />
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
      <aside className="flex flex-col gap-4 lg:sticky lg:top-24" aria-label={t.deposit.addressTitle}>
        <Alert className="border-amber/40 bg-amber/5">
          <AlertDescription className="text-ink-2">{t.deposit.addressCaveat}</AlertDescription>
        </Alert>
        <p className="text-sm text-ink-2">{t.deposit.addressThen}</p>
      </aside>
    </div>
  );
}

function TxLink({ hash, label }: { hash: string; label: string }) {
  return (
    <a href={`${EXPLORER_BASE}/tx/${hash}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-sm text-sm text-teal hover:underline">
      {label} · {NETWORK_LABEL}
      <ExternalLinkIcon className="size-3.5" aria-hidden />
    </a>
  );
}

function Deposit() {
  const { t, locale } = useLocale();
  const { kit, address } = usePasskeyWallet();
  const { info } = useAnchorInfo();
  const { signAndSubmit } = useSignTransaction();
  const { toast } = useToast();
  const [view, setView] = useState<"loading" | "form" | "waiting">("loading");
  const [amount, setAmount] = useState("100");
  const [method, setMethod] = useState<DepositMethod>("iban");
  const [record, setRecord] = useState<DepositRecord | null>(null);
  const [resumed, setResumed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [autopilot, setAutopilot] = useState<"idle" | "signing" | "needs_tap" | "done">("idle");
  const [autopilotFailure, setAutopilotFailure] = useState<Failure | null>(null);
  const autopilotStarted = useRef(false);
  const vaultDepositTx = useRef<string | null>(null);
  const autopilotSince = useRef(0);
  const [usdTry, setUsdTry] = useState<number | null>(null);
  const [cancelling, setCancelling] = useState(false);
  /** True once an on-ramp has sat at the anchor for more than 90 s (set from the poll, not during render). */
  const [anchorWaiting, setAnchorWaiting] = useState(false);
  /** Wall clock as seen by the last poll tick; drives the transfer-timeout screen without reading Date.now() in render. */
  const [now, setNow] = useState(0);
  const [waitUntil, setWaitUntil] = useState(0);
  /** Set when the poll itself stops getting JSON (Vercel's login page): the presenter screen, while polling continues. */
  const [pollFailure, setPollFailure] = useState<Failure | null>(null);

  useEffect(() => {
    fetch("/api/rates")
      .then((r) => (r.ok ? (r.json() as Promise<{ usdTry: number }>) : null))
      .then((r) => r && setUsdTry(r.usdTry))
      .catch(() => undefined);
  }, []);

  const cancel = async () => {
    if (!record) return;
    setCancelling(true);
    try {
      const next = await api<DepositRecord>(`/api/deposit/${record.id}/cancel`, { method: "POST", body: "{}" });
      setRecord(next);
    } catch (err) {
      setFailure(classifyError(err, "generic"));
    } finally {
      setCancelling(false);
    }
  };

  // Resume an in-flight deposit after a reload (the phone locked, the tab was closed…).
  useEffect(() => {
    if (!address) return;
    let alive = true;
    api<{ active: DepositRecord | null }>(`/api/deposit?contractId=${address}`)
      .then((res) => {
        if (!alive) return;
        if (res.active) {
          setRecord(res.active);
          setResumed(true);
          setView("waiting");
          if (res.active.status === "in_wallet") {
            // The USDC arrived while the page was closed: the passkey prompt waits for a tap, not for a page load.
            autopilotStarted.current = true;
            setAutopilot("needs_tap");
          }
        } else {
          setView("form");
        }
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setFailure(classifyError(err, "generic"));
        setView("form");
      });
    return () => {
      alive = false;
    };
  }, [address]);

  // Poll until the pipeline hands the USDC to the browser or finishes.
  const recordId = record?.id;
  const recordStatus = record?.status;
  useEffect(() => {
    if (!recordId || !recordStatus || FINAL.includes(recordStatus)) return;
    const tick = () => {
      setNow(Date.now());
      api<DepositRecord>(`/api/deposit/${recordId}`)
        .then((next) => {
          setRecord((current) => (current?.status === "in_vault" ? current : next));
          setAnchorWaiting(next.status === "onramp_pending" && Date.now() - Date.parse(next.updatedAt) > 90_000);
          setPollFailure(null);
        })
        .catch((err: unknown) => {
          const classified = classifyError(err, "generic");
          setPollFailure(classified.kind === "deployment_protected" ? classified : null);
        });
    };
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 3000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [recordId, recordStatus]);

  // Arrival autopilot: the USDC is in the smart account; put it in the vault.
  const runAutopilot = useCallback(async () => {
    if (!record || !kit || !info || !address || !record.paidUsdc) {
      // Not ready yet (the wallet address restores a beat after the kit on a reloaded page): let the effect kick again.
      autopilotStarted.current = false;
      return;
    }
    setAutopilot("signing");
    autopilotSince.current = Date.now();
    setAutopilotFailure(null);
    try {
      if (!vaultDepositTx.current) {
        // Sign the vault deposit at most once: a retry after a stalled record call re-sends the hash, not the USDC.
        console.info(`[kumbara] vault autopilot ${record.id}: simulating the deposit of ${record.paidUsdc} USDC`);
        const tx = await withTimeout(buildVaultDeposit(kit, info.vault.id, address, record.paidUsdc), STEP_TIMEOUT_MS, "vault deposit simulation");
        console.info(`[kumbara] vault autopilot ${record.id}: simulated, signing`);
        const result = await withTimeout(signAndSubmit(tx), STEP_TIMEOUT_MS, "vault deposit");
        vaultDepositTx.current = result.hash;
        console.info(`[kumbara] vault autopilot ${record.id}: ${result.hash.slice(0, 8)} confirmed`);
      }
      const next = await api<DepositRecord>(`/api/deposit/${record.id}/vault`, { method: "POST", body: JSON.stringify({ hash: vaultDepositTx.current, amountUsdc: record.paidUsdc }) });
      if (next.status === "in_wallet") throw new StepTimeoutError("the server did not record the vault deposit yet; tap to report it again");
      setRecord(next);
      setAutopilot("done");
      toast({ title: t.deposit.steps.in_vault, body: t.toast.depositDone, variant: "success", key: "deposit" });
    } catch (err) {
      const classified = classifyError(err, "vault");
      console.error("[kumbara] vault deposit failed", classified.kind, classified.detail);
      setAutopilotFailure(classified);
      setAutopilot("needs_tap");
    }
  }, [record, kit, info, address, signAndSubmit, toast, t]);

  useEffect(() => {
    if (recordStatus !== "in_wallet" || autopilotStarted.current || !kit || !info || !address) return;
    autopilotStarted.current = true;
    const kick = setTimeout(() => void runAutopilot(), 0);
    return () => clearTimeout(kick);
  }, [recordStatus, kit, info, address, runAutopilot]);

  // Watchdog: the USDC is in the kumbara but the autopilot has not concluded. Never started (a kick that found the wallet
  // half-restored) → kick again; running far longer than its own bounds → hand the user the tap button.
  useEffect(() => {
    if (recordStatus !== "in_wallet" || autopilot === "done") return;
    const id = setInterval(() => {
      if (autopilot === "idle" && !autopilotStarted.current && kit && info && address) {
        console.warn("[kumbara] vault autopilot: not running while the USDC is in the wallet; kicking it");
        autopilotStarted.current = true;
        void runAutopilot();
      } else if (autopilot === "signing" && Date.now() - autopilotSince.current > STEP_TIMEOUT_MS * 2 + 30_000) {
        console.warn("[kumbara] vault autopilot: no result well past its own timeouts; asking for a tap");
        autopilotStarted.current = false;
        setAutopilot("needs_tap");
      }
    }, 10_000);
    return () => clearInterval(id);
  }, [recordStatus, autopilot, kit, info, address, runAutopilot]);

  const start = async () => {
    if (!address) return;
    setSubmitting(true);
    setFailure(null);
    try {
      const created = await api<DepositRecord>("/api/deposit", { method: "POST", body: JSON.stringify({ contractId: address, amountTry: amount }) });
      setRecord(created);
      setResumed(false);
      setView("waiting");
    } catch (err) {
      setFailure(classifyError(err, "anchor"));
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setRecord(null);
    setResumed(false);
    setAutopilot("idle");
    setAutopilotFailure(null);
    setFailure(null);
    setWaitUntil(0);
    autopilotStarted.current = false;
    setView("form");
  };

  const amountNumber = Number(amount.replace(",", "."));
  const treasuryUsdc = info?.treasuryUsdc ? Number(info.treasuryUsdc) : null;
  const estimatedUsdc = usdTry ? amountNumber / (usdTry * 1.005) : null;
  const overTreasury = treasuryUsdc !== null && estimatedUsdc !== null && estimatedUsdc > treasuryUsdc * 0.9;
  // Limits come from the anchor, in its fiat: published when it states them, else its SEP-6 asset limits at its own price (server-side).
  const limits = info?.anchor?.limits;
  const minAmount = limits?.fiat?.min ?? 1;
  const maxAmount = limits?.fiat?.max ?? null;
  const numberLocale = locale === "tr" ? "tr-TR" : "en-US";
  const amountValid = Number.isFinite(amountNumber) && amountNumber >= minAmount && (maxAmount === null || amountNumber <= maxAmount) && !overTreasury;

  if (view === "loading") return <ScreenSkeleton />;

  if (view === "form") {
    const invalid = amount !== "" && !amountValid;
    return (
      <div className="flex flex-col gap-5 py-2">
        <div className="flex items-baseline justify-between">
          <h1 className="text-3xl font-bold tracking-tight">{t.deposit.title}</h1>
          <Link href="/kumbara" className="rounded-sm text-sm text-teal hover:underline">
            {t.deposit.backToSavings}
          </Link>
        </div>
        {/* Lira over the bank, or USDC straight to the kumbara's address. */}
        <div className="flex flex-col gap-2">
          <p className="microlabel text-[11px]">{t.deposit.method.label}</p>
          <ToggleGroup
            variant="segment"
            size="lg"
            spacing={0.5}
            value={[method]}
            onValueChange={(value) => {
              const next = value[0];
              if (next === "iban" || next === "address") setMethod(next);
            }}
            aria-label={t.deposit.method.label}
            data-testid="deposit-method"
          >
            <ToggleGroupItem value="iban" data-testid="deposit-method-iban">
              {t.deposit.method.iban}
            </ToggleGroupItem>
            <ToggleGroupItem value="address" data-testid="deposit-method-address">
              {t.deposit.method.address}
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        {method === "address" ? (
          <AddressDeposit />
        ) : (
        <form
          className="grid gap-4 lg:grid-cols-[3fr_2fr] lg:grid-rows-[auto_auto_auto_1fr] lg:items-start lg:[grid-template-areas:'form_side'_'notes_side'_'actions_side'_'._side']"
          onSubmit={(e) => {
            e.preventDefault();
            if (amountValid) void start();
          }}
        >
          <Card className="lg:[grid-area:form]">
            <CardHeader>
              <CardTitle>{t.deposit.lead}</CardTitle>
            </CardHeader>
            <CardContent>
              <FieldGroup className="gap-3">
                <Field data-invalid={invalid ? true : undefined}>
                  <FieldLabel htmlFor="deposit-amount" className="microlabel text-[11px] font-normal">
                    {t.deposit.amountLabel}
                  </FieldLabel>
                  <InputGroup className="h-14">
                    <InputGroupAddon align="inline-start">
                      <InputGroupText className="text-2xl font-semibold">₺</InputGroupText>
                    </InputGroupAddon>
                    <InputGroupInput
                      id="deposit-amount"
                      type="number"
                      inputMode="decimal"
                      min={minAmount}
                      max={maxAmount ?? undefined}
                      step="any"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className="tnum text-2xl font-semibold"
                      aria-describedby="deposit-limits"
                      aria-invalid={invalid ? "true" : "false"}
                    />
                  </InputGroup>
                  <ToggleGroup
                    variant="segment"
                    size="lg"
                    spacing={0.5}
                    value={[amount]}
                    onValueChange={(value) => {
                      const next = value[0];
                      if (typeof next === "string") setAmount(next);
                    }}
                    aria-label={t.deposit.amountLabel}
                    className="flex-wrap"
                  >
                    {t.deposit.quick.map((q) => (
                      <ToggleGroupItem key={q} value={String(q)} className="tnum">
                        ₺{q.toLocaleString(numberLocale)}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                  <FieldDescription id="deposit-limits" className="text-xs">
                    {(maxAmount === null ? t.deposit.limitsMin : t.deposit.limits).replace("{min}", minAmount.toLocaleString(numberLocale)).replace("{max}", (maxAmount ?? 0).toLocaleString(numberLocale))}
                  </FieldDescription>
                </Field>
              </FieldGroup>
            </CardContent>
          </Card>
          <div className="flex flex-col gap-4 empty:hidden lg:[grid-area:notes]">
            {amountValid && amountNumber / 40 > Number(DEFAULT_LIMIT_USDC) ? <p className="text-sm text-amber">{t.deposit.limitWarning}</p> : null}
            {overTreasury && treasuryUsdc !== null ? (
              <Alert className="border-amber/40 bg-amber/5">
                <AlertDescription className="text-ink-2">{t.deposit.treasuryCap.replace("{usdc}", Math.floor(treasuryUsdc).toLocaleString(numberLocale))}</AlertDescription>
              </Alert>
            ) : null}
            {failure ? <FailureScreen failure={failure} compact primary={AMOUNT_FAILURES.has(failure.kind) ? null : undefined} onRetry={() => void start()} /> : null}
          </div>
          <Button type="submit" size="xl" className="w-full lg:[grid-area:actions]" disabled={!amountValid || submitting || !address} aria-busy={submitting ? "true" : undefined}>
            {submitting ? <Spinner data-icon="inline-start" /> : null}
            {submitting ? t.deposit.preparing : t.deposit.continue}
          </Button>
          {/* What happens next: the same steps the status card will show, idle. Last on a phone, beside the form on a laptop. */}
          <aside className="flex flex-col gap-4 max-lg:order-last lg:sticky lg:top-24 lg:[grid-area:side]" aria-label={t.deposit.statusTitle}>
            <Card size="sm">
              <CardHeader>
                <CardTitle className="microlabel text-[11px] font-normal">{t.deposit.statusTitle}</CardTitle>
              </CardHeader>
              <CardContent>
                <Stepper steps={PREVIEW_STEPS.map((step): StepperStep => ({ key: step, label: t.deposit.steps[step], owner: step === "in_vault" ? undefined : step === "in_wallet" ? "you" : "us", state: "idle" }))} />
              </CardContent>
            </Card>
          </aside>
        </form>
        )}
      </div>
    );
  }

  if (!record) return null;
  const currentIndex = STEP_ORDER.indexOf(record.status);
  const quote = record.firmQuote ?? record.indicative;
  const tryShown = record.receivedTry ?? record.amountTry;
  const deadline = record.transferDeadline ? Date.parse(record.transferDeadline) : null;
  const timedOut = record.status === "awaiting_transfer" && deadline !== null && now > 0 && now > Math.max(deadline, waitUntil);
  const waitedMinutes = now > 0 ? Math.max(1, Math.round((now - Date.parse(record.createdAt)) / 60_000)) : 0;
  const quoteRefreshing = record.status === "transfer_received" && record.lastError?.code === "quote_expired";
  const failed =
    record.status === "failed"
      ? classifyRecordError(record.error ?? { code: "step_failed", message: record.lastError?.message ?? "unknown" }, {
          landingAddress: record.landing?.publicKey,
          expected: record.firmQuote?.usdcOut,
          actual: record.paidUsdc,
        })
      : null;
  const parked = failed?.kind === "amount_mismatch" || failed?.kind === "usdc_not_received";

  const done = FINAL.includes(record.status);
  const needsYou = record.status === "in_wallet";
  return (
    <div className={cn("flex flex-col gap-5 py-2", done && "mx-auto w-full lg:max-w-2xl")}>
      <div className="flex items-baseline justify-between">
        <h1 className="text-3xl font-bold tracking-tight">{t.deposit.title}</h1>
        <Link href="/kumbara" className="rounded-sm text-sm text-teal hover:underline">
          {t.deposit.backToSavings}
        </Link>
      </div>

      {/* Two columns on a laptop: what the visitor acts on, then the status beside it; one centred column once the deposit is final. */}
      <div className={cn("grid gap-5", !done && "lg:grid-cols-[3fr_2fr] lg:items-start")}>
      <div className="flex flex-col gap-5">
      {resumed && !FINAL.includes(record.status) ? <ResumeNotice flow="deposit" /> : null}
      {pollFailure ? <FailureScreen failure={pollFailure} primary={null} /> : null}

      {failed ? (
        <FailureScreen
          failure={failed}
          primary={parked ? undefined : { label: t.deposit.newDeposit, onClick: reset }}
          secondary={parked ? { label: t.deposit.newDeposit, onClick: reset } : null}
        />
      ) : null}

      {timedOut ? (
        <FailureScreen
          failure={{ kind: "transfer_timeout", values: { minutes: String(waitedMinutes) }, detail: `reference ${record.instructions.reference}; deadline ${record.transferDeadline ?? "?"}` }}
          primary={{ label: t.failures.kinds.transfer_timeout.action, onClick: () => setWaitUntil(now + WAIT_EXTENSION_MS) }}
          secondary={{ label: t.failures.kinds.transfer_timeout.secondary, onClick: () => void cancel(), busy: cancelling }}
        />
      ) : null}

      <Card render={<section aria-label={t.deposit.quoteTitle} />}>
        <CardHeader>
          <CardTitle className="microlabel text-[11px] font-normal">{t.deposit.quoteTitle}</CardTitle>
          <CardAction>
            <NetworkBadge />
          </CardAction>
        </CardHeader>
        <CardContent>
          <p className="tnum text-3xl font-bold">{formatUsdc(quote.usdcOut, locale)} USDC</p>
          <p className="tnum mt-1 text-sm text-ink-2">
            {formatTry(Number(tryShown), locale)} · {t.deposit.rateLine} {Number(quote.rate).toLocaleString(numberLocale, { maximumFractionDigits: 4 })} ₺/USDC ({record.indicative.spreadBps} bps {t.deposit.spread})
          </p>
          {!record.firmQuote ? <p className="mt-1 text-xs text-muted-foreground">{t.deposit.indicative}</p> : null}
        </CardContent>
      </Card>

      {record.status === "awaiting_transfer" ? (
        <Card render={<section aria-label={t.deposit.transferTitle} />}>
          <CardHeader>
            <CardTitle className="microlabel text-[11px] font-normal">{t.deposit.transferTitle}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <dl className="flex flex-col gap-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <dt className="text-muted-foreground">{t.deposit.bank}</dt>
                <dd className="text-right font-medium">{record.instructions.bankName}</dd>
                {!record.instructions.iban ? <dd className="col-span-2 text-sm text-muted-foreground" role="status">{t.deposit.instructionsPending}</dd> : null}
              </div>
              <div className="rounded-lg bg-muted p-3">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">{t.deposit.iban}</dt>
                  <CopyButton value={record.instructions.iban} label={t.deposit.copy} copiedLabel={t.deposit.copied} />
                </div>
                <dd className="tnum mt-1 font-mono text-sm font-semibold tracking-wide text-foreground" data-testid="deposit-iban">{record.instructions.ibanFormatted}</dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="text-muted-foreground">{t.deposit.recipient}</dt>
                <dd className="text-right font-medium">{record.instructions.accountHolder}</dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="text-muted-foreground">{t.deposit.amount}</dt>
                <dd className="tnum text-right font-medium">{formatTry(Number(record.amountTry), locale)}</dd>
              </div>
              <div className="rounded-lg border border-teal/30 bg-teal/5 p-3">
                <div className="flex items-center justify-between gap-3">
                  <dt className="font-semibold text-teal">{t.deposit.description}</dt>
                  <CopyButton value={record.instructions.reference} label={t.deposit.copy} copiedLabel={t.deposit.copied} />
                </div>
                <dd className="mt-1 font-mono text-2xl font-bold tracking-wide text-foreground" data-testid="deposit-reference">
                  {record.instructions.reference}
                </dd>
              </div>
            </dl>
            <p className="text-xs text-ink-2">{t.deposit.descriptionHint}</p>
            <p className="text-xs text-muted-foreground">{t.deposit.sandbox}</p>
          </CardContent>
        </Card>
      ) : null}

      {record.status === "onramp_pending" && anchorWaiting ? (
        <Card size="sm" render={<section aria-label={t.deposit.abandonTitle} />} className="border-amber/40 bg-amber/5">
          <CardHeader>
            <CardTitle>{t.deposit.abandonTitle}</CardTitle>
            <CardDescription className="text-ink-2">{t.deposit.abandonBody}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" className="w-full" onClick={() => void cancel()} disabled={cancelling} aria-busy={cancelling ? "true" : undefined}>
              {cancelling ? <Spinner data-icon="inline-start" /> : null}
              {cancelling ? t.savings.loading : t.deposit.abandon}
            </Button>
          </CardContent>
        </Card>
      ) : null}
      {failure && record.status !== "failed" ? <FailureScreen failure={failure} compact primary={null} /> : null}
      </div>

      {/* The status column: sticky on a laptop, first on a phone while a step needs the visitor. */}
      <div className={cn("flex flex-col gap-5", needsYou && "max-lg:order-first", !done && "lg:sticky lg:top-24")}>
      <Card render={<section aria-label={t.deposit.statusTitle} />}>
        <CardHeader>
          <CardTitle className="microlabel text-[11px] font-normal">{t.deposit.statusTitle}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Stepper
            testId="deposit-status"
            steps={STEP_ORDER.filter((s) => ["awaiting_transfer", "transfer_received", "onramp_paid", "in_wallet", "in_vault"].includes(s)).map((s): StepperStep => {
              const idx = STEP_ORDER.indexOf(s);
              const active = record.status === s || (s === "transfer_received" && record.status === "onramp_pending") || (s === "onramp_paid" && record.status === "forwarded");
              const state: StepperStep["state"] = record.status === "failed" ? (idx < currentIndex ? "done" : idx === currentIndex ? "failed" : "idle") : idx < currentIndex && !active ? "done" : active || idx === currentIndex ? (s === "in_vault" ? "done" : "current") : "idle";
              return { key: s, label: t.deposit.steps[s], owner: s === "in_vault" ? undefined : s === "in_wallet" ? "you" : "us", state, since: state === "current" ? record.updatedAt : undefined, typicalSeconds: state === "current" ? TYPICAL_SECONDS[record.status] : undefined };
            })}
          />
          <Separator />
          <div className="flex flex-col gap-1">
            <p className="text-sm font-semibold text-foreground" role="status" aria-live="polite" data-testid="deposit-current">
              {t.deposit.steps[record.status]}
            </p>
            {SERVER_STEPS.has(record.status) ? (
              <p className="text-sm text-teal" data-testid="close-hint">
                {t.deposit.closeHint}
              </p>
            ) : record.status === "in_wallet" ? (
              <p className="text-sm text-amber" data-testid="needs-you">
                {t.deposit.needsYou}
              </p>
            ) : null}
            {quoteRefreshing ? (
              <p className="text-sm text-amber" role="status">
                {t.failures.quoteRefreshing}
              </p>
            ) : null}
            {record.status === "in_wallet" && autopilot === "signing" ? (
              <p className="mt-1 flex items-center gap-2 text-sm text-ink-2" role="status">
                <Spinner className="text-teal" />
                {t.deposit.autopilotSigning}
              </p>
            ) : null}
          </div>
          {record.status === "in_wallet" && autopilot === "needs_tap" ? (
            autopilotFailure ? (
              <FailureScreen
                failure={autopilotFailure}
                compact
                primary={autopilotFailure.kind === "limit_exceeded" ? undefined : { label: t.deposit.autopilotButton, onClick: () => void runAutopilot() }}
                secondary={autopilotFailure.kind === "limit_exceeded" ? { label: t.deposit.autopilotButton, onClick: () => void runAutopilot() } : null}
              />
            ) : (
              <Alert role="status" data-testid="arrived" className="border-amber/40 bg-amber/5">
                <AlertTitle className="text-base font-semibold">{t.deposit.arrivedTitle}</AlertTitle>
                <AlertDescription className="text-ink-2">{t.deposit.autopilotNeedsTap}</AlertDescription>
                <Button onClick={() => void runAutopilot()} className="mt-2 w-fit">
                  {t.deposit.autopilotButton}
                </Button>
              </Alert>
            )
          ) : null}
          {record.anchorTxHash || record.forwardTxHash || record.vaultTxHash ? (
            <div className="flex flex-col gap-1">
              {record.anchorTxHash ? <TxLink hash={record.anchorTxHash} label={t.deposit.links.anchor} /> : null}
              {record.forwardTxHash ? <TxLink hash={record.forwardTxHash} label={t.deposit.links.forward} /> : null}
              {record.vaultTxHash ? <TxLink hash={record.vaultTxHash} label={t.deposit.links.vault} /> : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
      </div>

      <div className="flex flex-col gap-2 lg:col-span-2">
        {record.status === "in_vault" ? (
          <Button size="xl" className="w-full" render={<Link href="/kumbara" />}>
            {t.deposit.backToSavings}
          </Button>
        ) : null}
        {record.status === "abandoned" ? <p className="text-center text-sm text-ink-2">{t.deposit.abandoned}</p> : null}
        {FINAL.includes(record.status) && record.status !== "failed" ? (
          <Button variant="outline" className="w-full" onClick={reset}>
            {t.deposit.newDeposit}
          </Button>
        ) : null}
        {record.status === "awaiting_transfer" && !timedOut ? (
          <>
            <Button variant="outline" className="w-full" onClick={() => void cancel()} disabled={cancelling} aria-busy={cancelling ? "true" : undefined}>
              {cancelling ? <Spinner data-icon="inline-start" /> : null}
              {cancelling ? t.savings.loading : t.deposit.cancel}
            </Button>
            <p className="text-center text-xs text-muted-foreground">{t.deposit.cancelHint}</p>
          </>
        ) : null}
      </div>
      </div>
    </div>
  );
}

export default function DepositPage() {
  return (
    <RequireWallet>
      <Deposit />
    </RequireWallet>
  );
}
