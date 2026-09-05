/**
 * Last result of the scheduled production E2E run. GitHub Actions POSTs it
 * with the CI_STATUS_TOKEN bearer; /booth/admin reads it (GET, public, no
 * secrets: status, step, run URL, time) and shows a red banner after a failed
 * run until the next green one.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { kvGet, kvSet } from "@/lib/db/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export interface CiStatus {
  status: "ok" | "failed";
  step: string | null;
  runUrl: string | null;
  at: string;
}

const KEY = "ci_status";

export async function GET(): Promise<Response> {
  try {
    const last = await kvGet<CiStatus>(KEY);
    return NextResponse.json(last ?? { status: "unknown", step: null, runUrl: null, at: null }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: { code: "internal", message: err instanceof Error ? err.message : String(err) } }, { status: 500 });
  }
}

function authorized(request: Request): boolean {
  const expected = process.env.CI_STATUS_TOKEN?.trim();
  if (!expected || expected.length < 16) return false;
  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return Boolean(provided) && timingSafeEqual(a, b);
}

export async function POST(request: Request): Promise<Response> {
  if (!authorized(request)) return NextResponse.json({ error: { code: "unauthorized", message: "invalid CI token" } }, { status: 401 });
  let body: { status?: string; step?: string; runUrl?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "invalid JSON" } }, { status: 400 });
  }
  if (body.status !== "ok" && body.status !== "failed") return NextResponse.json({ error: { code: "invalid_status", message: "status must be ok or failed" } }, { status: 400 });
  const runUrl = typeof body.runUrl === "string" && /^https:\/\/github\.com\//.test(body.runUrl) ? body.runUrl.slice(0, 200) : null;
  const record: CiStatus = { status: body.status, step: typeof body.step === "string" ? body.step.slice(0, 80) : null, runUrl, at: new Date().toISOString() };
  try {
    await kvSet(KEY, record);
    return NextResponse.json(record, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: { code: "internal", message: err instanceof Error ? err.message : String(err) } }, { status: 500 });
  }
}
