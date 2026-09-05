/**
 * Presenter-only, testnet only: top up the sponsor from Friendbot. Friendbot
 * funds new accounts only, so a throwaway account is created, funded with
 * 10,000 XLM, and merged into the sponsor.
 */
import { NextResponse } from "next/server";
import { Keypair, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { requireAdmin } from "@/lib/admin.server";
import { networkPassphrase, serverEnv } from "@/lib/env.server";
import { rpcServer, sponsorKeypair, sponsorStatus } from "@/lib/landing.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request): Promise<Response> {
  const denied = requireAdmin(request);
  if (denied) return denied;
  if (serverEnv.stellarNetwork() !== "testnet") {
    return NextResponse.json({ error: { code: "testnet_only", message: "Friendbot funding only exists on testnet; send XLM to the sponsor address instead" } }, { status: 400 });
  }
  try {
    const temp = Keypair.random();
    const fb = await fetch(`https://friendbot.stellar.org/?addr=${encodeURIComponent(temp.publicKey())}`, { signal: AbortSignal.timeout(30_000) });
    if (!fb.ok) throw new Error(`friendbot HTTP ${fb.status}`);
    const server = rpcServer();
    let account = null;
    for (let i = 0; i < 20 && !account; i += 1) {
      try {
        account = await server.getAccount(temp.publicKey());
      } catch {
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    if (!account) throw new Error("friendbot account did not appear");
    const tx = new TransactionBuilder(account, { fee: "1000", networkPassphrase: networkPassphrase() })
      .addOperation(Operation.accountMerge({ destination: sponsorKeypair().publicKey() }))
      .setTimeout(120)
      .build();
    tx.sign(temp);
    const sent = await server.sendTransaction(tx);
    if (sent.status === "ERROR") throw new Error(`merge rejected: ${sent.errorResult?.toXDR("base64")}`);
    const polled = await server.pollTransaction(sent.hash, { attempts: 30 });
    if (polled.status !== "SUCCESS") throw new Error(`merge ${polled.status}`);
    const status = await sponsorStatus();
    return NextResponse.json({ hash: sent.hash, ...status }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: { code: "fund_failed", message: err instanceof Error ? err.message : String(err) } }, { status: 502 });
  }
}
