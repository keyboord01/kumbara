/**
 * The caller's IP for rate limiting, read only from the header the hosting
 * platform itself writes. A header the platform passes through untouched can
 * be set by anyone, so trusting it lets a script pick a fresh "IP" per request
 * and walk straight past every per-IP cap (SECURITY.md, KB-01).
 *
 *   Vercel  x-real-ip, then the first x-forwarded-for entry (Vercel overwrites
 *           both; it does not touch fly-client-ip, which is why that header is
 *           ignored here)
 *   Fly.io  fly-client-ip (Fly's proxy overwrites it)
 *   local   x-forwarded-for, then x-real-ip (development and E2E only)
 */
export type Platform = "vercel" | "fly" | "local";

export function detectPlatform(env: Record<string, string | undefined> = process.env): Platform {
  if (env.VERCEL) return "vercel";
  if (env.FLY_APP_NAME) return "fly";
  return "local";
}

function firstForwarded(headers: Headers): string | null {
  const xff = headers.get("x-forwarded-for");
  return xff ? xff.split(",")[0]!.trim() || null : null;
}

export function clientIpFrom(headers: Headers, platform: Platform = detectPlatform()): string {
  switch (platform) {
    case "vercel":
      return headers.get("x-real-ip")?.trim() || firstForwarded(headers) || "unknown";
    case "fly":
      return headers.get("fly-client-ip")?.trim() || "unknown";
    default:
      return firstForwarded(headers) || headers.get("x-real-ip")?.trim() || "unknown";
  }
}
