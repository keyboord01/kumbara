/**
 * Liveness (function up, database reachable) plus reachability of the anchor,
 * the relay, Stellar RPC and the vault. The HTTP status reflects only the
 * database; dependency trouble is reported, not fatal.
 */
import { NextResponse } from "next/server";
import { databaseUrl, db } from "@/lib/db/store";
import { serverEnv } from "@/lib/env.server";
import { dependencyHealth } from "@/lib/health.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(): Promise<Response> {
  let dbOk = false;
  let dbDetail = "";
  const dbStarted = Date.now();
  try {
    await (await db()).execute("SELECT 1");
    dbOk = true;
  } catch (err) {
    dbDetail = err instanceof Error ? err.message.slice(0, 160) : String(err);
  }
  const dbMs = Date.now() - dbStarted;
  let network = "unknown";
  try {
    network = serverEnv.stellarNetwork();
  } catch {
    network = "unconfigured";
  }
  let dependencies: Awaited<ReturnType<typeof dependencyHealth>> | { error: string };
  try {
    dependencies = await dependencyHealth();
  } catch (err) {
    dependencies = { error: err instanceof Error ? err.message : String(err) };
  }
  const database = { ok: dbOk, ms: dbMs, detail: dbDetail || (databaseUrl().startsWith("file:") ? "local file" : "turso") };
  return NextResponse.json(
    { ok: dbOk, network, database, dependencies },
    { status: dbOk ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
