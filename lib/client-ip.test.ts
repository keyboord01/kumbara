import { describe, expect, it } from "vitest";
import { clientIpFrom, detectPlatform } from "./client-ip";

const h = (init: Record<string, string>) => new Headers(init);

describe("clientIpFrom", () => {
  it("ignores a spoofed fly-client-ip on Vercel", () => {
    expect(clientIpFrom(h({ "fly-client-ip": "1.2.3.4", "x-real-ip": "9.9.9.9" }), "vercel")).toBe("9.9.9.9");
  });

  it("falls back to the first x-forwarded-for entry on Vercel", () => {
    expect(clientIpFrom(h({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" }), "vercel")).toBe("9.9.9.9");
  });

  it("only reads fly-client-ip on Fly", () => {
    expect(clientIpFrom(h({ "fly-client-ip": "5.5.5.5", "x-forwarded-for": "1.1.1.1" }), "fly")).toBe("5.5.5.5");
    expect(clientIpFrom(h({ "x-forwarded-for": "1.1.1.1" }), "fly")).toBe("unknown");
  });

  it("detects the platform from the environment", () => {
    expect(detectPlatform({ VERCEL: "1" })).toBe("vercel");
    expect(detectPlatform({ FLY_APP_NAME: "kumbara" })).toBe("fly");
    expect(detectPlatform({})).toBe("local");
  });
});
