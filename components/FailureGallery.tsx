"use client";

import { useSearchParams } from "next/navigation";
import { FailureScreen } from "@/components/FailureScreen";
import { type Failure, type FailureKind } from "@/lib/failures";
import { useLocale } from "@/lib/i18n";

const ZERO_ACCOUNT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

/** Sample failure per kind, so every screen can be viewed and screenshotted without a real outage. */
export const SAMPLE_FAILURES: Record<FailureKind, Failure> = {
  relay_unreachable: { kind: "relay_unreachable", code: "RELAY_UNREACHABLE", detail: "relay unreachable: fetch failed (preview)" },
  relay_rejected: { kind: "relay_rejected", code: "submission_failed", detail: "relay HTTP 400: Unauthorized function call (preview)" },
  relay_budget: { kind: "relay_budget", code: "submission_failed", detail: "relay HTTP 402: project budget exhausted (preview)" },
  anchor_unreachable: { kind: "anchor_unreachable", code: "http_error", detail: "anchor HTTP 503 (preview)" },
  anchor_rejected: { kind: "anchor_rejected", code: "validation_error", detail: "anchor HTTP 422: amount exceeds the per-order maximum (preview)" },
  quote_expired: { kind: "quote_expired", code: "quote_expired", detail: "quote expired while the landing account was being prepared (preview)" },
  transfer_timeout: { kind: "transfer_timeout", values: { minutes: "31" }, detail: "reference TRMA-XXXX-XXXX; deadline passed (preview)" },
  amount_mismatch: { kind: "amount_mismatch", code: "amount_mismatch", values: { expected: "2.0544777", actual: "2.0500000" }, landingAddress: ZERO_ACCOUNT, detail: "anchor paid 2.0500000 USDC but the pre-authorized forward is for 2.0544777 (preview)" },
  vault_rejected: { kind: "vault_rejected", code: "simulation_failed", detail: "HostError: Error(Contract, #10) (preview)" },
  strategy_failed: { kind: "strategy_failed", code: "simulation_failed", detail: "strategy withdraw failed: Error(Contract, #401) (preview)" },
  limit_exceeded: { kind: "limit_exceeded", code: "spending_limit_exceeded", detail: "limit 1,000 USDC per transaction (preview)" },
  passkey_cancelled: { kind: "passkey_cancelled", code: "user_cancelled", detail: "NotAllowedError: the operation was cancelled (preview)" },
  passkey_unsupported: { kind: "passkey_unsupported", code: "webauthn_unsupported", detail: "PublicKeyCredential is undefined (preview)" },
  passkey_lost: { kind: "passkey_lost", code: "wallet_not_found", detail: "no wallet found for this passkey (preview)" },
  rate_limited_ip: { kind: "rate_limited_ip", code: "RATE_LIMITED_IP", detail: "account creation limit: 60 per IP per hour (preview)" },
  rate_limited_ref: { kind: "rate_limited_ref", code: "RATE_LIMITED_REF", detail: "booth ref booth-1 reached its cap of 300 accounts (preview)" },
  onboarding_paused: { kind: "onboarding_paused", code: "SPONSOR_UNDERFUNDED", detail: "onboarding paused: the sponsor account holds 1.20 XLM, below the 3 XLM threshold (preview)" },
  wrong_network: { kind: "wrong_network", values: { linkNetwork: "MAINNET", appNetwork: "TESTNET" }, detail: "link network: public; browser build: testnet (preview)" },
  offline: { kind: "offline", code: "offline", detail: "Failed to fetch (preview)" },
  deployment_protected: { kind: "deployment_protected", code: "deployment_protected", detail: "HTTP 401 with an HTML login page from /api/anchor/info (preview)" },
  usdc_not_received: { kind: "usdc_not_received", code: "usdc_not_received", landingAddress: ZERO_ACCOUNT, detail: "landing account never received 1.0000000 USDC (preview)" },
  anchor_not_matched: { kind: "anchor_not_matched", code: "anchor_not_matched", detail: "the anchor did not match the payment (preview)" },
  insufficient_balance: { kind: "insufficient_balance", code: "insufficient_vault_balance", detail: "the kumbara holds 0.5000000 USDC in the vault (preview)" },
  invalid_amount: { kind: "invalid_amount", code: "amount_out_of_range", detail: "amount must be between 50 and 250000 TRY (preview)" },
  unknown: { kind: "unknown", code: "internal", detail: "TypeError: something unexpected (preview)" },
};

/** All failure screens on one page (`?kind=` narrows to one) for QA and the runbook screenshots. */
export function FailureGallery() {
  const { t } = useLocale();
  const kind = useSearchParams().get("kind");
  const kinds = (Object.keys(SAMPLE_FAILURES) as FailureKind[]).filter((k) => !kind || k === kind);
  return (
    <div className="flex flex-col gap-5 py-2">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t.failures.label}</h1>
        <p className="mt-1 text-sm text-muted">{t.failures.previewNote}</p>
      </div>
      {kinds.map((k) => (
        <div key={k} data-testid={`gallery-${k}`}>
          <p className="microlabel mb-1">{k}</p>
          <FailureScreen failure={SAMPLE_FAILURES[k]} onRetry={() => undefined} secondary={k === "transfer_timeout" ? { label: t.failures.kinds.transfer_timeout.secondary, onClick: () => undefined } : null} />
        </div>
      ))}
    </div>
  );
}
