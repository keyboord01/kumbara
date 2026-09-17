/**
 * Presenter-only: exchange the admin token for an http-only session cookie, so reloading the console
 * mid-demo does not ask for the token again. The cookie is never readable by the page's JavaScript and
 * never written to localStorage, sessionStorage or the URL; DELETE ends the session ("Forget the token").
 */
import { NextResponse } from "next/server";
import { ADMIN_COOKIE, adminDisabledResponse, adminTokenConfigured, unauthorizedResponse, verifyAdminToken } from "@/lib/admin.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_AGE_SECONDS = 12 * 60 * 60;

/** Secure only over https: a presenter testing on http://localhost would otherwise never keep the cookie. */
function isHttps(request: Request): boolean {
  if (request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https") return true;
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!adminTokenConfigured()) return adminDisabledResponse();
  let body: { token?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!verifyAdminToken(token)) return unauthorizedResponse();
  const res = NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  res.cookies.set({ name: ADMIN_COOKIE, value: token, httpOnly: true, secure: isHttps(request), sameSite: "strict", path: "/", maxAge: MAX_AGE_SECONDS });
  return res;
}

export async function DELETE(request: Request): Promise<Response> {
  const res = NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  res.cookies.set({ name: ADMIN_COOKIE, value: "", httpOnly: true, secure: isHttps(request), sameSite: "strict", path: "/", maxAge: 0 });
  return res;
}
