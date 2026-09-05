/**
 * Abuse guard for account creation. Windows are rows in the database keyed
 * by a salted hash of the client IP (the IP itself is never stored or
 * logged); the salt derives from a server secret so every instance hashes
 * the same way. The per-booth-ref cap, counted from confirmed deployments,
 * is the primary guard: booth Wi-Fi shares one IP.
 */
import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { countEvents, rateLimitHit, sourceOfRef } from "./db/store";

const HOUR_MS = 3_600_000;
let fallbackSalt: string | null = null;

function salt(): string {
  const secret = process.env.SEMBOL_PROJECT_KEY?.trim();
  if (secret) return createHash("sha256").update(`${secret}:kumbara-ratelimit`).digest("hex");
  // No shared secret: a per-instance salt (documented weaker fallback).
  if (!fallbackSalt) fallbackSalt = randomBytes(16).toString("hex");
  return fallbackSalt;
}

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
  return createHash("sha256").update(`${salt()}:${kind}:${ip}`).digest("hex");
}

export interface GuardResult {
  allowed: boolean;
  code?: "RATE_LIMITED_IP" | "RATE_LIMITED_REF" | "RATE_LIMITED_RELAY";
  message?: string;
}

export async function guardRelayCall(request: Request): Promise<GuardResult> {
  const limit = limits.relayPerIpPerHour();
  if (limit === 0) return { allowed: true };
  const result = await rateLimitHit(bucket("relay", clientIp(request)), limit, HOUR_MS);
  return result.allowed ? { allowed: true } : { allowed: false, code: "RATE_LIMITED_RELAY", message: `relay rate limit: ${limit} submissions per IP per hour` };
}

export async function guardAccountCreation(request: Request, ref: string | null): Promise<GuardResult> {
  const perRef = limits.accountsPerRef();
  // The per-ref cap protects real booth links; the automated E2E ref would
  // exhaust it within weeks and is still under the per-IP cap.
  if (ref && perRef > 0 && sourceOfRef(ref) === "user") {
    const used = await countEvents({ type: "account_created", ref });
    if (used >= perRef) return { allowed: false, code: "RATE_LIMITED_REF", message: `booth ref ${ref} reached its cap of ${perRef} accounts` };
  }
  const perIp = limits.accountsPerIpPerHour();
  if (perIp === 0) return { allowed: true };
  const result = await rateLimitHit(bucket("account", clientIp(request)), perIp, HOUR_MS);
  return result.allowed ? { allowed: true } : { allowed: false, code: "RATE_LIMITED_IP", message: `account creation limit: ${perIp} per IP per hour` };
}
