import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "./api";

function respond(status: number, body: string, headers: Record<string, string> = {}, url = "https://kumbara.vercel.app/api/deposit") {
  const res = new Response(body, { status, headers });
  Object.defineProperty(res, "url", { value: url });
  return res;
}

describe("api()", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the JSON body on success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond(200, JSON.stringify({ active: null }), { "content-type": "application/json" })));
    await expect(api<{ active: null }>("/api/deposit?contractId=C")).resolves.toEqual({ active: null });
  });

  it("recognises Vercel's login page instead of JSON (deployment protection re-enabled)", async () => {
    const html = "<!doctype html><html><head><title>Authentication Required</title></head><body>Vercel</body></html>";
    vi.stubGlobal("fetch", vi.fn(async () => respond(401, html, { "content-type": "text/html; charset=utf-8" })));
    const err = await api("/api/deposit/dep_1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("deployment_protected");
  });

  it("recognises the SSO redirect target too", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond(200, "<html>login</html>", { "content-type": "text/html" }, "https://vercel.com/sso-api?url=...")));
    const err = await api("/api/health").catch((e: unknown) => e);
    expect((err as ApiError).code).toBe("deployment_protected");
  });

  it("maps a failed fetch to offline or unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));
    vi.stubGlobal("navigator", { onLine: false });
    expect(((await api("/api/x").catch((e: unknown) => e)) as ApiError).code).toBe("offline");
    vi.stubGlobal("navigator", { onLine: true });
    expect(((await api("/api/x").catch((e: unknown) => e)) as ApiError).code).toBe("unreachable");
  });

  it("carries the route's error code, message, source and relay errorCode", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond(422, JSON.stringify({ error: { code: "insufficient_vault_balance", message: "holds 0.5", source: "anchor" } }), { "content-type": "application/json" })));
    const err = (await api("/api/withdraw").catch((e: unknown) => e)) as ApiError;
    expect(err.status).toBe(422);
    expect(err.code).toBe("insufficient_vault_balance");
    expect(err.message).toBe("holds 0.5");
    expect(err.source).toBe("anchor");
    vi.stubGlobal("fetch", vi.fn(async () => respond(429, JSON.stringify({ success: false, error: "account creation limit: 60 per IP per hour", errorCode: "RATE_LIMITED_IP" }), { "content-type": "application/json" })));
    const relay = (await api("/api/relay").catch((e: unknown) => e)) as ApiError;
    expect(relay.errorCode).toBe("RATE_LIMITED_IP");
    expect(relay.message).toMatch(/per IP per hour/);
  });
});
