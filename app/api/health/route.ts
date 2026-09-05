/**
 * Liveness for the Fly.io health check (process up, data dir writable) plus
 * reachability of the anchor, the relay, Stellar RPC and the vault. The HTTP
 * status reflects only the process itself; dependency trouble is reported,
 * not fatal, so a flaky upstream never gets the machine restarted.
 */
import { NextResponse } from "next/server";
import { accessSync, constants } from "node:fs";
import { dataDir } from "@/lib/db/store";
import { serverEnv } from "@/lib/env.server";
import { dependencyHealth } from "@/lib/health.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  let dataWritable = false;
  try {
    accessSync(dataDir(), constants.W_OK);
    dataWritable = true;
  } catch {
    dataWritable = false;
  }
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
  return NextResponse.json(
    { ok: dataWritable, network, dataDir: dataDir(), uptimeSeconds: Math.round(process.uptime()), dependencies },
    { status: dataWritable ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
