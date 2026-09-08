/**
 * Public, cacheable discovery for the browser: network, the anchor's USDC
 * (issuer from stellar.toml, contract id derived), its published limits and
 * the vault id. No keys.
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
        treasury: anchor.treasury?.address ?? null,
        treasuryUsdc: anchor.treasury?.balance ?? null,
        onrampMode: serverEnv.onrampMode(),
        offrampMode: serverEnv.offrampMode(),
        anchor: { homeDomain: anchor.homeDomain, orgName: anchor.orgName, fiatCode: anchor.fiatCode, sep6: anchor.sep6, limits: anchor.limits },
      },
      // Not cached at the edge: the presenter can switch anchors at the booth and the next page load must see the new
      // anchor's limits. Discovery itself sits in the framework data cache, and the browser keeps this for a minute.
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "anchor discovery failed" }, { status: 503 });
  }
}
