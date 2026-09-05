/**
 * Abuse guard for account creation. Per-IP sliding windows live in memory
 * only (hashed with a process salt; the IP itself is never stored or logged;
 * single machine). The per-booth-ref cap counts confirmed accounts in SQLite.
 */
import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { countEvents } from "./db/store";

const salt = randomBytes(16).toString("hex");
const windows = new Map<string, number[]>();

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  const value = raw ? Number(raw) : NaN;
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export const limits = {
  accountsPerIpPerHour: () => numberEnv("RATE_LIMIT_ACCOUNTS_PER_IP_HOUR", 5),
  accountsPerRef: () => numberEnv("RATE_LIMIT_ACCOUNTS_PER_REF", 300),
  relayPerIpPerHour: () => numberEnv("RATE_LIMIT_RELAY_PER_IP_HOUR", 120),
};

export function clientIp(request: Request): string {
  const fly = request.headers.get("fly-client-ip");
  if (fly) return fly.trim();
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

function bucket(kind: string, ip: string): string {
  return createHash("sha256").update(`${salt}:${kind}:${ip}`).digest("hex");
}

/** Count hits in the last hour for this bucket; record one when allowed. */
function hit(kind: string, ip: string, limit: number): { allowed: boolean; count: number } {
  const key = bucket(kind, ip);
  const now = Date.now();
  const recent = (windows.get(key) ?? []).filter((t) => now - t < 3_600_000);
  if (limit > 0 && recent.length >= limit) {
    windows.set(key, recent);
    return { allowed: false, count: recent.length };
  }
  recent.push(now);
  windows.set(key, recent);
  if (windows.size > 50_000) windows.clear(); // bounded memory; resets are harmless
  return { allowed: true, count: recent.length };
}

export interface GuardResult {
  allowed: boolean;
  code?: "RATE_LIMITED_IP" | "RATE_LIMITED_REF" | "RATE_LIMITED_RELAY";
  message?: string;
}

export function guardRelayCall(request: Request): GuardResult {
  const limit = limits.relayPerIpPerHour();
  const result = hit("relay", clientIp(request), limit);
  return result.allowed ? { allowed: true } : { allowed: false, code: "RATE_LIMITED_RELAY", message: `relay rate limit: ${limit} submissions per IP per hour` };
}

export async function guardAccountCreation(request: Request, ref: string | null): Promise<GuardResult> {
  const perRef = limits.accountsPerRef();
  if (ref && perRef > 0) {
    const used = await countEvents({ type: "account_created", ref });
    if (used >= perRef) return { allowed: false, code: "RATE_LIMITED_REF", message: `booth ref ${ref} reached its cap of ${perRef} accounts` };
  }
  const perIp = limits.accountsPerIpPerHour();
  const result = hit("account", clientIp(request), perIp);
  return result.allowed ? { allowed: true } : { allowed: false, code: "RATE_LIMITED_IP", message: `account creation limit: ${perIp} per IP per hour` };
}
