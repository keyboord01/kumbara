/**
 * Gate 0 spike: Soroswap, only needed if the vault rejects the anchor's USDC.
 *
 * Decides whether SOROSWAP_ENABLED must be true by comparing the anchor's USDC
 * SAC with the vault's asset, and dry-runs a router quote on-chain
 * (router_get_amounts_out) so the "no route" answer is recorded rather than
 * assumed. No API key is required for the on-chain dry run.
 *
 *   pnpm spike:soroswap
 */
import { Asset, xdr } from "@stellar/stellar-sdk";
import { fetchStellarToml } from "./lib/anchor";
import { anchorBaseUrl, assertTestnet, networkPassphrase, optionalEnv } from "./lib/env";
import { Findings, fail, info, ok, step, warn } from "./lib/log";
import { loadState } from "./lib/state";
import { addressScVal, i128, readNative, simulateRead } from "./lib/stellar";
import { soroswapRouterId } from "./lib/testnet";

assertTestnet();
const findings = new Findings("soroswap");

step("Anchor payout asset vs. vault asset");
const toml = await fetchStellarToml(anchorBaseUrl());
const anchorUsdc = new Asset(toml.usdc.code, toml.usdc.issuer).contractId(networkPassphrase());
const vaultId = optionalEnv("DEFINDEX_VAULT_ID") ?? loadState().vaultId;
if (!vaultId) fail("no vault known: set DEFINDEX_VAULT_ID or run pnpm spike:defindex first");
const assets = await readNative<Array<{ address: string }>>(vaultId, "get_assets");
const vaultAsset = assets[0]?.address;
if (!vaultAsset) fail(`vault ${vaultId} reports no assets`);
const swapNeeded = vaultAsset !== anchorUsdc;
info(`anchor USDC SAC ${anchorUsdc}`);
info(`vault ${vaultId} asset ${vaultAsset}`);
findings.set("assets", { anchorUsdc, vaultAsset, swapNeeded });

step("Soroswap router dry run (on-chain simulation, no API key)");
const router = soroswapRouterId();
const path = xdr.ScVal.scvVec([addressScVal(anchorUsdc), addressScVal(vaultAsset === anchorUsdc ? "CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU" : vaultAsset)]);
try {
  const out = await simulateRead(router, "router_get_amounts_out", [i128(10_000_000n), path]);
  info(`router_get_amounts_out(1 USDC): ${JSON.stringify(out)}`);
  findings.set("routerQuote", { router, ok: true, raw: out.toXDR("base64") });
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  info(`router ${router}: ${message.slice(0, 200)}`);
  findings.set("routerQuote", { router, ok: false, error: message.slice(0, 500) });
}
if (optionalEnv("SOROSWAP_API_KEY")) {
  info("SOROSWAP_API_KEY is set; the aggregator API could be queried here (skipped in the spike)");
}

step("Decision");
const flag = optionalEnv("SOROSWAP_ENABLED") === "true";
if (swapNeeded && !flag) fail("the vault does not accept the anchor's USDC: set SOROSWAP_ENABLED=true and wire the swap");
if (!swapNeeded && flag) warn("SOROSWAP_ENABLED=true but no swap is needed; set it to false");
if (!swapNeeded) ok("the vault accepts the anchor's USDC as-is: Soroswap is not required (SOROSWAP_ENABLED=false)");
findings.set("decision", swapNeeded ? "swap required" : "not required");

const file = findings.write();
ok(`findings written to ${file}`);
