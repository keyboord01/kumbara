import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { sanitizeContext, scrubText } = await import("./monitor.server");

describe("pilot instrumentation keeps reports anonymous", () => {
  it("cuts addresses, secret seeds, hashes and IBANs out of free text", () => {
    const text = scrubText(`stuck on CDK3IMKYQN5BNGLBZQ4HWBIOITTNOBIXD6B2A5F4HRKIFSSB35N2BPZB with SBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX tx ${"ab".repeat(32)} iban TR33 0006 1005 1978 6457 8413 26`, 500);
    expect(text).not.toMatch(/CDK3IMKY|SBXXXX|abab|0006 1005/);
    expect(text).toContain("[address]");
    expect(text).toContain("[secret removed]");
  });

  it("keeps only coarse browser context and strips addresses and query strings from the path", () => {
    const ctx = sanitizeContext({ path: "/kumbara/CDK3IMKYQN5BNGLBZQ4HWBIOITTNOBIXD6B2A5F4HRKIFSSB35N2BPZB?ref=x", browser: "Chrome", os: "Android", mobile: true, locale: "tr" });
    expect(ctx).toEqual({ path: "/kumbara/…", browser: "Chrome", os: "Android", mobile: true, locale: "tr" });
    expect(sanitizeContext(undefined)).toMatchObject({ path: "/", mobile: false, locale: "en" });
  });
});
