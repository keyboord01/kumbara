/**
 * Client-side wallet configuration: Sembol's audited contract set for the
 * configured network, the same-origin relay route, and Kumbara's passkey
 * relying-party name. No secrets here; this ships to the browser.
 */
import { SEMBOL_MAINNET_ARTIFACTS, SEMBOL_TESTNET_ARTIFACTS, type SembolConfig } from "@sembol/passkey-react";

export type Network = "testnet" | "public";

export const NETWORK: Network = process.env.NEXT_PUBLIC_STELLAR_NETWORK === "public" ? "public" : "testnet";

const preset = NETWORK === "public" ? SEMBOL_MAINNET_ARTIFACTS : SEMBOL_TESTNET_ARTIFACTS;

export const sembolConfig: SembolConfig = {
  ...preset,
  rpcUrl: process.env.NEXT_PUBLIC_STELLAR_RPC_URL || preset.rpcUrl,
  // Same-origin route; the browser never sees the relay URL or the project key.
  relayerUrl: "/api/relay",
  appName: "Kumbara",
  webAuthnHints: ["client-device", "hybrid"],
};

export const NETWORK_LABEL = NETWORK === "testnet" ? "TESTNET" : "MAINNET";
export const EXPLORER_BASE = `https://stellar.expert/explorer/${NETWORK === "testnet" ? "testnet" : "public"}`;
