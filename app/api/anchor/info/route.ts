/**
 * Public, cacheable discovery for the browser: network, the anchor's USDC
 * (issuer from stellar.toml, contract id derived) and the vault id. No keys.
 */
import { NextResponse } from "next/server";
import { discoverAnchor } from "@/lib/anchor.server";
import { serverEnv } from "@/lib/env.server";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(): Promise<Response> {
  try {
    const anchor = await discoverAnchor();
    const network = serverEnv.stellarNetwork();
    return NextResponse.json(
      {
        network,
        networkPassphrase: anchor.networkPassphrase,
        explorerBase: `https://stellar.expert/explorer/${network === "testnet" ? "testnet" : "public"}`,
        usdc: anchor.usdc,
        vault: { id: serverEnv.defindexVaultId() },
        treasury: anchor.treasury,
        treasuryUsdc: anchor.treasuryUsdc,
        onrampMode: serverEnv.onrampMode(),
        offrampMode: serverEnv.offrampMode(),
      },
      { headers: { "cache-control": "public, max-age=60, s-maxage=60, stale-while-revalidate=300" } },
    );
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "anchor discovery failed" }, { status: 503 });
  }
}
