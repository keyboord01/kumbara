/**
 * Presenter-only endpoints: the token is compared in constant time with BOOTH_ADMIN_TOKEN.
 * It arrives either as a bearer header (scripts, the cron, the console's own calls) or as the
 * http-only session cookie the console sets through /api/booth/admin/session, so that a reload
 * mid-demo does not ask the presenter to paste the token again.
 */
import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

/** The presenter's session cookie. http-only: the console's own JavaScript can never read it. */
export const ADMIN_COOKIE = "kumbara_booth";

const digest = (value: string) => createHash("sha256").update(value).digest();

/** The configured token, or null when the booth endpoints are disabled. */
export function adminTokenConfigured(): string | null {
  const expected = process.env.BOOTH_ADMIN_TOKEN?.trim();
  return expected && expected.length >= 12 ? expected : null;
}

/** Constant-time comparison against the configured token. */
export function verifyAdminToken(provided: string): boolean {
  const expected = adminTokenConfigured();
  if (!expected || !provided) return false;
  return timingSafeEqual(digest(provided), digest(expected));
}

function bearerToken(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

function cookieToken(request: Request): string {
  const raw = request.headers.get("cookie") ?? "";
  for (const part of raw.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === ADMIN_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return "";
}

export function adminDisabledResponse(): Response {
  return NextResponse.json({ error: { code: "admin_disabled", message: "BOOTH_ADMIN_TOKEN is not configured (12+ characters)" } }, { status: 503 });
}

export function unauthorizedResponse(): Response {
  return NextResponse.json({ error: { code: "unauthorized", message: "invalid admin token" } }, { status: 401 });
}

export function requireAdmin(request: Request): Response | null {
  if (!adminTokenConfigured()) return adminDisabledResponse();
  if (verifyAdminToken(bearerToken(request)) || verifyAdminToken(cookieToken(request))) return null;
  return unauthorizedResponse();
}
