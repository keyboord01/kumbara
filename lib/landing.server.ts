/**
 * Wires the env-free landing module to this deployment: RPC, network, the
 * sponsor key and the relay. Also enforces the sponsor's balance bounds.
 */
import "server-only";
import { Keypair, StrKey, rpc, xdr } from "@stellar/stellar-sdk";
import { networkPassphrase, serverEnv } from "./env.server";
import { LandingError, type LandingDeps } from "./landing/landing";
import { serverRelay } from "./relay.server";

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  const value = raw ? Number(raw) : NaN;
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** Below this the sponsor cannot lock a landing account's reserves (2.5 XLM) and fees; onboarding is refused too. */
export const sponsorMinXlm = (): number => numberEnv("SPONSOR_MIN_XLM", 3);
/** Above this the key holds more than it needs; a leak would cost more than intended. */
export const sponsorMaxXlm = (): number => numberEnv("SPONSOR_MAX_XLM", 100);
/** Kept for callers that only need the defaults. */
export const SPONSOR_MIN_XLM = 3;
export const SPONSOR_MAX_XLM = 100;

export function sponsorKeypair(): Keypair {
  const secret = process.env.SPONSOR_SECRET?.trim() ?? "";
  if (!StrKey.isValidEd25519SecretSeed(secret)) throw new Error("SPONSOR_SECRET is missing or not a valid secret seed (see .env.example)");
  return Keypair.fromSecret(secret);
}

export function rpcServer(): rpc.Server {
  return new rpc.Server(serverEnv.stellarRpcUrl());
}

export async function sponsorBalanceXlm(): Promise<number> {
  const key = xdr.LedgerKey.account(new xdr.LedgerKeyAccount({ accountId: Keypair.fromPublicKey(sponsorKeypair().publicKey()).xdrAccountId() }));
  const res = await rpcServer().getLedgerEntries(key);
  const entry = res.entries[0];
  return entry ? Number(entry.val.account().balance().toBigInt()) / 1e7 : 0;
}

export interface SponsorStatus {
  publicKey: string;
  balanceXlm: number;
  minXlm: number;
  maxXlm: number;
  ok: boolean;
  network: string;
}

export async function sponsorStatus(): Promise<SponsorStatus> {
  const balance = await sponsorBalanceXlm();
  const min = sponsorMinXlm();
  return { publicKey: sponsorKeypair().publicKey(), balanceXlm: balance, minXlm: min, maxXlm: sponsorMaxXlm(), ok: balance >= min, network: serverEnv.stellarNetwork() };
}

/** Refuse below the minimum, warn above the maximum. */
export async function assertSponsorReady(): Promise<number> {
  const balance = await sponsorBalanceXlm();
  const min = sponsorMinXlm();
  const max = sponsorMaxXlm();
  if (balance < min) {
    throw new LandingError("sponsor_underfunded", `sponsor ${sponsorKeypair().publicKey()} holds ${balance.toFixed(2)} XLM, below the ${min} XLM needed to sponsor a landing account`);
  }
  if (balance > max) {
    console.warn(`[landing] sponsor ${sponsorKeypair().publicKey()} holds ${balance.toFixed(1)} XLM, above the ${max} XLM bound; keep this account small`);
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
