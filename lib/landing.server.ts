/**
 * Wires the env-free landing module to this deployment: RPC, network, the
 * sponsor key and the relay. Also enforces the sponsor's balance bounds.
 */
import "server-only";
import { Keypair, StrKey, rpc, xdr } from "@stellar/stellar-sdk";
import { networkPassphrase, serverEnv } from "./env.server";
import { LandingError, type LandingDeps } from "./landing/landing";
import { serverRelay } from "./relay.server";

/** Below this the sponsor cannot lock a landing account's reserves (2.5 XLM) and fees. */
export const SPONSOR_MIN_XLM = 3;
/** Above this the key holds more than it needs; a leak would cost more than intended. */
export const SPONSOR_MAX_XLM = 100;

let sponsor: Keypair | null = null;

export function sponsorKeypair(): Keypair {
  if (!sponsor) {
    const secret = process.env.SPONSOR_SECRET?.trim() ?? "";
    if (!StrKey.isValidEd25519SecretSeed(secret)) throw new Error("SPONSOR_SECRET is missing or not a valid secret seed (see .env.example)");
    sponsor = Keypair.fromSecret(secret);
  }
  return sponsor;
}

let server: rpc.Server | null = null;

export function rpcServer(): rpc.Server {
  if (!server) server = new rpc.Server(serverEnv.stellarRpcUrl());
  return server;
}

export async function sponsorBalanceXlm(): Promise<number> {
  const key = xdr.LedgerKey.account(new xdr.LedgerKeyAccount({ accountId: Keypair.fromPublicKey(sponsorKeypair().publicKey()).xdrAccountId() }));
  const res = await rpcServer().getLedgerEntries(key);
  const entry = res.entries[0];
  if (!entry) return 0;
  return Number(entry.val.account().balance().toBigInt()) / 1e7;
}

/** Refuse below the minimum, warn above the maximum. */
export async function assertSponsorReady(): Promise<number> {
  const balance = await sponsorBalanceXlm();
  if (balance < SPONSOR_MIN_XLM) {
    throw new LandingError("sponsor_underfunded", `sponsor ${sponsorKeypair().publicKey()} holds ${balance.toFixed(2)} XLM, below the ${SPONSOR_MIN_XLM} XLM needed to sponsor a landing account`);
  }
  if (balance > SPONSOR_MAX_XLM) {
    console.warn(`[landing] sponsor ${sponsorKeypair().publicKey()} holds ${balance.toFixed(1)} XLM, above the ${SPONSOR_MAX_XLM} XLM bound; keep this account small`);
  }
  return balance;
}

export function landingDeps(): LandingDeps {
  return {
    server: rpcServer(),
    networkPassphrase: networkPassphrase(),
    sponsor: sponsorKeypair(),
    relay: serverRelay,
    log: (message) => console.info(`[landing] ${message}`),
  };
}
