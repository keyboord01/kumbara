/**
 * Every state a visitor or presenter can hit, as one small vocabulary, plus
 * the classifier that maps thrown errors and stored pipeline failures onto it.
 * Screens render a FailureScreen from a Failure; the raw text only ever goes
 * behind the "details" expander. docs/failure-states.md lists the states.
 */
import { toSembolError, type SembolError } from "@sembol/passkey-react";
import { ApiError } from "./api";

export type FailureKind =
  | "relay_unreachable"
  | "relay_rejected"
  | "relay_budget"
  | "anchor_unreachable"
  | "anchor_rejected"
  | "quote_expired"
  | "transfer_timeout"
  | "amount_mismatch"
  | "vault_rejected"
  | "strategy_failed"
  | "limit_exceeded"
  | "passkey_cancelled"
  | "passkey_unsupported"
  | "passkey_lost"
  | "rate_limited_ip"
  | "rate_limited_ref"
  | "onboarding_paused"
  | "wrong_network"
  | "offline"
  | "deployment_protected"
  | "usdc_not_received"
  | "anchor_not_matched"
  | "insufficient_balance"
  | "invalid_amount"
  | "unknown";

export interface Failure {
  kind: FailureKind;
  /** Raw, developer-facing text; shown only behind the details expander. */
  detail?: string;
  /** Machine code from the API, the library or the pipeline record. */
  code?: string;
  /** Placeholder values for the copy ({expected}, {actual}, {minutes}, …). */
  values?: Record<string, string>;
  /** Bridge (landing) account to show, for amount_mismatch and usdc_not_received. */
  landingAddress?: string;
}

/** Runbook section each presenter-facing state points at (docs/booth-runbook.md). */
export const RUNBOOK_SECTION: Partial<Record<FailureKind, string>> = {
  relay_unreachable: "Relay down",
  relay_rejected: "Relay down",
  relay_budget: "Relay down",
  anchor_unreachable: "Anchor down",
  anchor_not_matched: "Anchor down",
  amount_mismatch: "Amount mismatch",
  vault_rejected: "Vault red",
  strategy_failed: "Vault red",
  onboarding_paused: "Onboarding paused",
  rate_limited_ip: "Rate limited",
  rate_limited_ref: "Rate limited",
  deployment_protected: "Vercel login",
  passkey_unsupported: "Passkey refused",
  passkey_lost: "Passkey refused",
  usdc_not_received: "Withdrawal stuck",
  transfer_timeout: "Transfer never arrives",
};

/** Where the failure happened, for messages that need context to classify. */
export type FailureContext = "relay" | "anchor" | "vault" | "passkey" | "pipeline" | "generic";

const RATE_LIMIT_RE = /rate limit|reached its cap|per IP per hour/i;
const REF_CAP_RE = /booth ref|per booth|reached its cap of/i;
const SPONSOR_RE = /onboarding paused|sponsor account holds|sponsor .* holds|SPONSOR_UNDERFUNDED|sponsor_underfunded/i;
const BUDGET_RE = /budget|quota exceeded|insufficient (funds|balance)|underfunded relayer|402/i;
const UNREACHABLE_RE = /unreachable|fetch failed|failed to fetch|timed out|timeout|ECONN|ETIMEDOUT|network error|HTTP 50[234]|502|503|504/i;
const HTML_RE = /Unexpected token '<'|<!doctype|<html|text\/html|sso-api|vercel\.com|Authentication Required|deployment_protected/i;
const STRATEGY_RE = /strateg/i;
const QUOTE_RE = /quote (has )?expired|quote_expired/i;
const LIMIT_RE = /spending limit|spending_limit|SpendingLimit/i;

function fromRelayMessage(message: string, fallback: FailureKind): FailureKind {
  if (HTML_RE.test(message)) return "deployment_protected";
  if (REF_CAP_RE.test(message)) return "rate_limited_ref";
  if (RATE_LIMIT_RE.test(message)) return "rate_limited_ip";
  if (SPONSOR_RE.test(message)) return "onboarding_paused";
  if (BUDGET_RE.test(message)) return "relay_budget";
  if (UNREACHABLE_RE.test(message)) return "relay_unreachable";
  return fallback;
}

function fromSembol(err: SembolError, context: FailureContext): Failure {
  const detail = `${err.code}: ${err.message}`;
  const base = { detail, code: err.code };
  switch (err.code) {
    case "user_cancelled":
      return { kind: "passkey_cancelled", ...base };
    case "webauthn_unsupported":
      return { kind: "passkey_unsupported", ...base };
    case "wallet_not_found":
    case "session_expired":
    case "recovery_needs_address":
      return { kind: "passkey_lost", ...base };
    case "spending_limit_exceeded":
      return { kind: "limit_exceeded", ...base };
    case "simulation_failed": {
      if (LIMIT_RE.test(err.message)) return { kind: "limit_exceeded", ...base };
      if (context === "vault") return { kind: STRATEGY_RE.test(err.message) ? "strategy_failed" : "vault_rejected", ...base };
      return { kind: fromRelayMessage(err.message, "relay_rejected"), ...base };
    }
    case "submission_failed":
    case "network_error":
    case "timeout": {
      const kind = fromRelayMessage(err.message, err.code === "submission_failed" ? "relay_rejected" : "relay_unreachable");
      if (kind === "relay_rejected" && context === "vault") return { kind: STRATEGY_RE.test(err.message) ? "strategy_failed" : "vault_rejected", ...base };
      return { kind, ...base };
    }
    default:
      return { kind: "unknown", ...base };
  }
}

function fromApi(err: ApiError, context: FailureContext): Failure {
  const detail = `${err.status} ${err.code}: ${err.message}`;
  const base = { detail, code: err.code };
  if (err.code === "deployment_protected") return { kind: "deployment_protected", ...base };
  if (err.code === "offline") return { kind: "offline", ...base };
  if (err.code === "unreachable") return { kind: "offline", ...base };
  if (err.code === "timeout") return { kind: "offline", ...base };
  if (err.status === 429) return { kind: err.errorCode === "RATE_LIMITED_REF" || REF_CAP_RE.test(err.message) ? "rate_limited_ref" : "rate_limited_ip", ...base };
  if (err.errorCode === "SPONSOR_UNDERFUNDED" || err.code === "sponsor_underfunded" || SPONSOR_RE.test(err.message)) return { kind: "onboarding_paused", ...base };
  if (err.errorCode === "RELAY_UNREACHABLE" || err.errorCode === "RELAY_NOT_CONFIGURED") return { kind: "relay_unreachable", ...base };
  if (err.code === "quote_expired" || QUOTE_RE.test(err.message)) return { kind: "quote_expired", ...base };
  if (err.code === "insufficient_vault_balance") return { kind: "insufficient_balance", ...base };
  if (err.code === "amount_out_of_range" || err.code === "amount_too_small" || err.code === "invalid_amount") return { kind: "invalid_amount", ...base };
  if (err.code === "amount_mismatch") return { kind: "amount_mismatch", ...base };
  if (err.source === "anchor" || context === "anchor") {
    return { kind: err.status >= 500 || UNREACHABLE_RE.test(err.message) ? "anchor_unreachable" : "anchor_rejected", ...base };
  }
  if (/anchor/i.test(err.message) && (err.status >= 500 || UNREACHABLE_RE.test(err.message))) return { kind: "anchor_unreachable", ...base };
  if (err.status >= 500 && UNREACHABLE_RE.test(err.message)) return { kind: "offline", ...base };
  return { kind: "unknown", ...base };
}

/** Map any thrown value to a Failure. `context` says which subsystem the call belonged to. */
export function classifyError(err: unknown, context: FailureContext = "generic"): Failure {
  if (err instanceof ApiError) return fromApi(err, context);
  if (err instanceof StepTimeoutError) return { kind: context === "vault" ? "vault_rejected" : context === "relay" ? "relay_unreachable" : "offline", detail: err.message, code: "timeout" };
  if (err && typeof err === "object" && "code" in err && "userMessage" in err) return fromSembol(err as SembolError, context);
  if (err instanceof Error && /^(TypeError)$/.test(err.name) && /fetch/i.test(err.message)) {
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    return { kind: offline ? "offline" : context === "relay" ? "relay_unreachable" : "offline", detail: err.message };
  }
  if (err instanceof Error && (err.name === "NotAllowedError" || err.name === "AbortError")) return { kind: "passkey_cancelled", detail: `${err.name}: ${err.message}`, code: err.name };
  if (err instanceof Error && err.name === "NotSupportedError") return { kind: "passkey_unsupported", detail: `${err.name}: ${err.message}`, code: err.name };
  const sembol = toSembolError(err);
  return fromSembol(sembol, context);
}

/** A stored pipeline failure ({ code, message } on a deposit or withdrawal record). */
export function classifyRecordError(
  error: { code: string; message: string },
  extra: { landingAddress?: string | undefined; expected?: string | undefined; actual?: string | undefined } = {},
): Failure {
  const failure = recordFailure(error, extra);
  // The bridge account is only useful to see when funds are visibly parked there.
  if (extra.landingAddress && (failure.kind === "amount_mismatch" || failure.kind === "usdc_not_received")) failure.landingAddress = extra.landingAddress;
  return failure;
}

function recordFailure(error: { code: string; message: string }, extra: { expected?: string | undefined; actual?: string | undefined }): Failure {
  const base: Failure = { kind: "unknown", detail: `${error.code}: ${error.message}`, code: error.code };
  const message = error.message;
  switch (error.code) {
    case "amount_mismatch":
      return { ...base, kind: "amount_mismatch", values: { expected: extra.expected ?? "?", actual: extra.actual ?? "?" } };
    case "onramp_failed":
    case "offramp_cancelled":
      return { ...base, kind: "anchor_rejected" };
    case "quote_expired":
      return { ...base, kind: "quote_expired" };
    case "sponsor_underfunded":
      return { ...base, kind: "onboarding_paused" };
    case "usdc_not_received":
      return { ...base, kind: "usdc_not_received" };
    case "anchor_not_matched":
      return { ...base, kind: "anchor_not_matched" };
    case "submit_failed":
    case "simulation_failed":
      return { ...base, kind: fromRelayMessage(message, "relay_rejected") };
    case "step_failed":
      if (QUOTE_RE.test(message)) return { ...base, kind: "quote_expired" };
      if (/anchor/i.test(message) && UNREACHABLE_RE.test(message)) return { ...base, kind: "anchor_unreachable" };
      return { ...base, kind: fromRelayMessage(message, "unknown") };
    default:
      if (/anchor/i.test(message) || /^(http_error|validation_error|invalid_|not_found|customer|quote)/.test(error.code)) {
        return { ...base, kind: UNREACHABLE_RE.test(message) ? "anchor_unreachable" : "anchor_rejected" };
      }
      return { ...base, kind: fromRelayMessage(message, "unknown") };
  }
}

/** Reject after `ms` so a hung RPC or relay call becomes a retryable failure instead of a frozen screen. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new StepTimeoutError(`${label} did not finish within ${Math.round(ms / 1000)} s`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export class StepTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StepTimeoutError";
  }
}

/** Whether a kind is something the presenter, not the visitor, has to act on. */
export function isPresenterState(kind: FailureKind): boolean {
  return kind === "deployment_protected" || kind === "amount_mismatch" || kind === "onboarding_paused" || kind === "relay_budget" || kind === "anchor_not_matched" || kind === "rate_limited_ref";
}
