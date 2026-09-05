/** Presenter-only endpoints: bearer token compared in constant time with BOOTH_ADMIN_TOKEN. */
import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export function requireAdmin(request: Request): Response | null {
  const expected = process.env.BOOTH_ADMIN_TOKEN?.trim();
  if (!expected || expected.length < 12) {
    return NextResponse.json({ error: { code: "admin_disabled", message: "BOOTH_ADMIN_TOKEN is not configured (12+ characters)" } }, { status: 503 });
  }
  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  if (!provided || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: { code: "unauthorized", message: "invalid admin token" } }, { status: 401 });
  }
  return null;
}
