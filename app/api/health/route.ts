/** Liveness for the Fly.io health check: process up, data dir writable. */
import { NextResponse } from "next/server";
import { accessSync, constants } from "node:fs";
import { dataDir } from "@/lib/db/store";
import { serverEnv } from "@/lib/env.server";

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
  return NextResponse.json({ ok: dataWritable, network, dataDir: dataDir(), uptimeSeconds: Math.round(process.uptime()) }, { status: dataWritable ? 200 : 503, headers: { "cache-control": "no-store" } });
}
