/**
 * Client-side wallet configuration: Sembol's audited contract set for the
 * configured network, the same-origin relay route, and Kumbara's passkey
 * relying-party name. No secrets here; this ships to the browser.
 */
import { SEMBOL_MAINNET_ARTIFACTS, SEMBOL_TESTNET_ARTIFACTS, type SembolConfig } from "@sembol/passkey-react";

export type Network = "testnet" | "public";

export const NETWORK: Network = process.env.NEXT_PUBLIC_STELLAR_NETWORK === "public" ? "public" : "testnet";

/** Canonical public URL (https://kumbara.sembol.xyz in production); empty on previews and locally, where the current origin is used. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");

/**
 * WebAuthn Relying Party ID. Set explicitly to kumbara.sembol.xyz in production so
 * passkeys are bound to the canonical domain; unset elsewhere (previews, localhost),
 * where the library derives it from the current host. A passkey created on one RP ID
 * cannot be used on another, so accounts made on kumbara.vercel.app do not open here.
 */
export const WEBAUTHN_RP_ID = process.env.NEXT_PUBLIC_WEBAUTHN_RP_ID?.trim() || undefined;

const preset = NETWORK === "public" ? SEMBOL_MAINNET_ARTIFACTS : SEMBOL_TESTNET_ARTIFACTS;

export const sembolConfig: SembolConfig = {
  ...preset,
  rpcUrl: process.env.NEXT_PUBLIC_STELLAR_RPC_URL || preset.rpcUrl,
  // Same-origin route; the browser never sees the relay URL or the project key.
  relayerUrl: "/api/relay",
  appName: "Kumbara",
  ...(WEBAUTHN_RP_ID ? { rpId: WEBAUTHN_RP_ID } : {}),
  webAuthnHints: ["client-device", "hybrid"],
};

export const NETWORK_LABEL = NETWORK === "testnet" ? "TESTNET" : "MAINNET";
export const EXPLORER_BASE = `https://stellar.expert/explorer/${NETWORK === "testnet" ? "testnet" : "public"}`;
