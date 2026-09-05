import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { classifyError, classifyRecordError } from "./failures";

function sembol(code: string, message: string) {
  return { code, message, userMessage: message, recoverable: true, name: "SembolError" };
}

describe("classifyError", () => {
  it("maps passkey outcomes", () => {
    expect(classifyError(sembol("user_cancelled", "cancelled")).kind).toBe("passkey_cancelled");
    expect(classifyError(sembol("webauthn_unsupported", "no webauthn")).kind).toBe("passkey_unsupported");
    expect(classifyError(sembol("wallet_not_found", "none")).kind).toBe("passkey_lost");
    expect(classifyError(Object.assign(new Error("The operation was aborted"), { name: "NotAllowedError" })).kind).toBe("passkey_cancelled");
  });

  it("tells relay states apart from the text the relay route returns", () => {
    expect(classifyError(sembol("submission_failed", "relay unreachable: fetch failed"), "relay").kind).toBe("relay_unreachable");
    expect(classifyError(sembol("submission_failed", "account creation limit: 60 per IP per hour"), "relay").kind).toBe("rate_limited_ip");
    expect(classifyError(sembol("submission_failed", "booth ref booth-1 reached its cap of 300 accounts"), "relay").kind).toBe("rate_limited_ref");
    expect(classifyError(sembol("submission_failed", "onboarding paused: the sponsor account holds 1.20 XLM, below the 3 XLM threshold"), "relay").kind).toBe("onboarding_paused");
    expect(classifyError(sembol("submission_failed", "project budget exhausted"), "relay").kind).toBe("relay_budget");
    expect(classifyError(sembol("submission_failed", "Unauthorized function call"), "relay").kind).toBe("relay_rejected");
    expect(classifyError(sembol("network_error", "Unexpected token '<', \"<!doctype \"... is not valid JSON"), "relay").kind).toBe("deployment_protected");
  });

  it("classifies vault calls by context", () => {
    expect(classifyError(sembol("simulation_failed", "HostError: Error(Contract, #10)"), "vault").kind).toBe("vault_rejected");
    expect(classifyError(sembol("simulation_failed", "strategy withdraw failed: Error(Contract, #401)"), "vault").kind).toBe("strategy_failed");
    expect(classifyError(sembol("spending_limit_exceeded", "over limit"), "vault").kind).toBe("limit_exceeded");
  });

  it("classifies Kumbara API errors", () => {
    expect(classifyError(new ApiError(401, "deployment_protected", "html")).kind).toBe("deployment_protected");
    expect(classifyError(new ApiError(0, "offline", "Failed to fetch")).kind).toBe("offline");
    expect(classifyError(new ApiError(429, "http_429", "account creation limit", undefined, "RATE_LIMITED_IP")).kind).toBe("rate_limited_ip");
    expect(classifyError(new ApiError(503, "http_503", "onboarding paused: the sponsor account holds 1 XLM", undefined, "SPONSOR_UNDERFUNDED")).kind).toBe("onboarding_paused");
    expect(classifyError(new ApiError(502, "http_error", "anchor HTTP 502", "anchor")).kind).toBe("anchor_unreachable");
    expect(classifyError(new ApiError(422, "validation_error", "amount too large", "anchor")).kind).toBe("anchor_rejected");
    expect(classifyError(new ApiError(422, "insufficient_vault_balance", "holds 0.5")).kind).toBe("insufficient_balance");
    expect(classifyError(new ApiError(422, "amount_out_of_range", "50..250000")).kind).toBe("invalid_amount");
    expect(classifyError(new ApiError(409, "quote_expired", "quote expired")).kind).toBe("quote_expired");
  });

  it("classifies stored pipeline failures", () => {
    const mismatch = classifyRecordError({ code: "amount_mismatch", message: "anchor paid 2.1 USDC but the pre-authorized forward is for 2.0" }, { landingAddress: "GABC", expected: "2.0", actual: "2.1" });
    expect(mismatch.kind).toBe("amount_mismatch");
    expect(mismatch.landingAddress).toBe("GABC");
    expect(mismatch.values).toEqual({ expected: "2.0", actual: "2.1" });
    expect(classifyRecordError({ code: "step_failed", message: "quote expired while the landing account was being prepared" }).kind).toBe("quote_expired");
    expect(classifyRecordError({ code: "submit_failed", message: "relay unreachable: fetch failed" }).kind).toBe("relay_unreachable");
    expect(classifyRecordError({ code: "sponsor_underfunded", message: "sponsor holds 1 XLM" }).kind).toBe("onboarding_paused");
    expect(classifyRecordError({ code: "usdc_not_received", message: "never received" }).kind).toBe("usdc_not_received");
    expect(classifyRecordError({ code: "anchor_not_matched", message: "unmatched" }).kind).toBe("anchor_not_matched");
    expect(classifyRecordError({ code: "onramp_failed", message: "refunded" }).kind).toBe("anchor_rejected");
    expect(classifyRecordError({ code: "http_error", message: "anchor stellar.toml unavailable (503)" }).kind).toBe("anchor_unreachable");
  });
});
