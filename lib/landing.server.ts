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

const BASE_RESERVE_XLM = 0.5;

export interface SponsorBalance {
  balanceXlm: number;
  /** Ledger entries this account sponsors (each bridge account locks 3–4 of them until it is merged back). */
  sponsoring: number;
  subentries: number;
  /** What the sponsor can actually spend: balance minus its own reserve, which grows with every bridge it sponsors. */
  availableXlm: number;
}

/**
 * The sponsor's spendable balance. A sponsored bridge account locks reserves on the sponsor, not on the bridge, so the
 * raw balance overstates what is left: 97 unmerged bridges once held 48.5 of 49.98 XLM and every new bridge failed.
 */
export async function sponsorBalance(): Promise<SponsorBalance> {
  const key = xdr.LedgerKey.account(new xdr.LedgerKeyAccount({ accountId: Keypair.fromPublicKey(sponsorKeypair().publicKey()).xdrAccountId() }));
  const res = await rpcServer().getLedgerEntries(key);
  const entry = res.entries[0];
  if (!entry) return { balanceXlm: 0, sponsoring: 0, subentries: 0, availableXlm: 0 };
  const account = entry.val.account();
  const balanceXlm = Number(account.balance().toBigInt()) / 1e7;
  const subentries = account.numSubEntries();
  let sponsoring = 0;
  try {
    sponsoring = account.ext().v1().ext().v2().numSponsoring();
  } catch {
    sponsoring = 0;
  }
  const reserve = BASE_RESERVE_XLM * (2 + subentries + sponsoring);
  return { balanceXlm, sponsoring, subentries, availableXlm: Math.max(0, balanceXlm - reserve) };
}

export async function sponsorBalanceXlm(): Promise<number> {
  return (await sponsorBalance()).availableXlm;
}

export interface SponsorStatus {
  publicKey: string;
  balanceXlm: number;
  availableXlm: number;
  sponsoring: number;
  minXlm: number;
  maxXlm: number;
  ok: boolean;
  network: string;
}

export async function sponsorStatus(): Promise<SponsorStatus> {
  const b = await sponsorBalance();
  const min = sponsorMinXlm();
  return { publicKey: sponsorKeypair().publicKey(), balanceXlm: b.balanceXlm, availableXlm: b.availableXlm, sponsoring: b.sponsoring, minXlm: min, maxXlm: sponsorMaxXlm(), ok: b.availableXlm >= min, network: serverEnv.stellarNetwork() };
}

/** Refuse when the spendable balance is below the minimum, warn when the raw balance is above the maximum. */
export async function assertSponsorReady(): Promise<number> {
  const b = await sponsorBalance();
  const min = sponsorMinXlm();
  const max = sponsorMaxXlm();
  if (b.availableXlm < min) {
    throw new LandingError("sponsor_underfunded", `sponsor ${sponsorKeypair().publicKey()} has ${b.availableXlm.toFixed(2)} XLM to spend (${b.balanceXlm.toFixed(2)} held, ${b.sponsoring} sponsored reserves locked), below the ${min} XLM needed to sponsor a landing account`);
  }
  if (b.balanceXlm > max) {
    console.warn(`[landing] sponsor ${sponsorKeypair().publicKey()} holds ${b.balanceXlm.toFixed(1)} XLM, above the ${max} XLM bound; keep this account small`);
  }
  return b.availableXlm;
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
