/**
 * Self-serve test money (testnet only). A new kumbara taps once and receives
 * a capped amount of the anchor's testnet USDC from a pool account, so nobody
 * has to play the bank for them. This is the second way money gets in, next
 * to the anchor; it touches nothing in the deposit pipeline.
 *
 * Limits, all read from the environment so the presenter can tune them:
 *   TESTFUNDS_GRANT_USDC     per grant                      (default 10)
 *   TESTFUNDS_PER_ACCOUNT    grants per kumbara, ever       (default 1)
 *   TESTFUNDS_COOLDOWN_HOURS between grants to one kumbara  (default 24)
 *   TESTFUNDS_PER_DAY        grants per UTC day, everyone   (default 50)
 *   TESTFUNDS_PER_IP_HOUR    attempts per IP per hour       (default 6)
 * Only Kumbara accounts (known account WASM, read from the chain) can
 * receive, so the pool cannot be pointed at arbitrary contracts. Grants run
 * one at a time under a database lease, which also keeps the pool's sequence
 * number from colliding. Every grant and every refusal is an event, which is
 * what the admin view and the evidence read.
 */
import "server-only";
import { Address, Asset, Keypair, Operation, StrKey, TransactionBuilder, nativeToScVal, rpc, type Transaction } from "@stellar/stellar-sdk";
import { discoverAnchor } from "./anchor.server";
import { clientIp } from "./ratelimit.server";
import { countEvents, insertEvent, listEvents, rateLimitHit, withLease, type EventRow } from "./db/store";
import { networkPassphrase, serverEnv } from "./env.server";
import { rpcServer } from "./landing.server";
import { accountContracts, accountWasmHashes } from "./relay-policy.server";
import { readTokenBalance } from "./vault";
import { createHash } from "node:crypto";

const HOUR_MS = 3_600_000;
const STROOPS = 10_000_000n;
const HORIZON_TESTNET = "https://horizon-testnet.stellar.org";
const FRIENDBOT = "https://friendbot.stellar.org";

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  const value = raw ? Number(raw) : NaN;
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export const testFundsLimits = () => ({
  grantUsdc: numberEnv("TESTFUNDS_GRANT_USDC", 10),
  perAccount: numberEnv("TESTFUNDS_PER_ACCOUNT", 1),
  cooldownHours: numberEnv("TESTFUNDS_COOLDOWN_HOURS", 24),
  perDay: numberEnv("TESTFUNDS_PER_DAY", 50),
  perIpHour: numberEnv("TESTFUNDS_PER_IP_HOUR", 6),
});

export type RefusalCode = "not_testnet" | "not_configured" | "not_a_kumbara" | "account_limit" | "cooldown" | "daily_limit" | "ip_limit" | "pool_empty";

export class TestFundsError extends Error {
  constructor(public status: number, public code: RefusalCode | "grant_failed", message: string, public retryAt: string | null = null) {
    super(message);
    this.name = "TestFundsError";
  }
}

export function poolKeypair(): Keypair | null {
  const secret = process.env.TESTFUNDS_SECRET?.trim() ?? "";
  return StrKey.isValidEd25519SecretSeed(secret) ? Keypair.fromSecret(secret) : null;
}

function enabled(): boolean {
  return serverEnv.stellarNetwork() === "testnet" && poolKeypair() !== null;
}

const startOfUtcDay = (now = Date.now()) => now - (now % 86_400_000);

async function grantsFor(contractId: string): Promise<EventRow[]> {
  // Few rows by design (a handful per kumbara); the JSON column holds the contract.
  return (await listEvents({ type: "testfunds_granted" }, 5_000)).filter((e) => e.contractId === contractId);
}

export interface AccountAllowance {
  enabled: boolean;
  grantUsdc: number;
  used: number;
  remaining: number;
  nextAt: string | null;
}

/** What this kumbara may still claim; the Savings screen reads it to decide whether to show the button. */
export async function allowanceFor(contractId: string): Promise<AccountAllowance> {
  const limits = testFundsLimits();
  if (!enabled()) return { enabled: false, grantUsdc: limits.grantUsdc, used: 0, remaining: 0, nextAt: null };
  const grants = await grantsFor(contractId);
  const last = grants.reduce((max, e) => Math.max(max, e.ts), 0);
  const cooldownEnds = last ? last + limits.cooldownHours * HOUR_MS : 0;
  return {
    enabled: true,
    grantUsdc: limits.grantUsdc,
    used: grants.length,
    remaining: Math.max(0, limits.perAccount - grants.length),
    nextAt: cooldownEnds > Date.now() ? new Date(cooldownEnds).toISOString() : null,
  };
}

async function refuse(request: Request, contractId: string, err: TestFundsError): Promise<never> {
  await insertEvent({
    type: "testfunds_refused",
    ts: Date.now(),
    network: serverEnv.stellarNetwork(),
    projectId: serverEnv.sembolProjectId(),
    ref: null,
    contractId,
    code: err.code,
    // Salted hash, never the address itself: enough to see one source hammering the button.
    ipHash: createHash("sha256").update(`${serverEnv.sembolProjectKey()}:testfunds:${clientIp(request)}`).digest("hex").slice(0, 12),
  }).catch(() => undefined);
  throw err;
}

async function submit(server: rpc.Server, tx: Transaction): Promise<string> {
  const sent = await server.sendTransaction(tx);
  if (sent.status === "ERROR" || sent.status === "TRY_AGAIN_LATER") throw new Error(`pool transaction ${sent.status}`);
  const done = await server.pollTransaction(sent.hash, { attempts: 30, sleepStrategy: () => 1_000 });
  if (done.status !== rpc.Api.GetTransactionStatus.SUCCESS) throw new Error(`pool transaction ${sent.hash.slice(0, 8)}… ${done.status}`);
  return sent.hash;
}

export interface Grant {
  hash: string;
  amountUsdc: string;
  contractId: string;
  allowance: AccountAllowance;
}

/** One tap, one capped grant, or a refusal that says which limit applied and when it lifts. */
export async function grantTestFunds(request: Request, contractId: string, ref: string | null): Promise<Grant> {
  if (serverEnv.stellarNetwork() !== "testnet") throw new TestFundsError(403, "not_testnet", "test funds exist only on testnet");
  const pool = poolKeypair();
  if (!pool) throw new TestFundsError(503, "not_configured", "the test-funds pool is not configured (TESTFUNDS_SECRET)");
  if (!StrKey.isValidContract(contractId)) throw new TestFundsError(400, "not_a_kumbara", "contractId must be a kumbara (C…) address");
  const limits = testFundsLimits();

  const ip = await rateLimitHit(createHash("sha256").update(`${serverEnv.sembolProjectKey()}:testfunds-ip:${clientIp(request)}`).digest("hex"), limits.perIpHour, HOUR_MS);
  if (!ip.allowed) await refuse(request, contractId, new TestFundsError(429, "ip_limit", `at most ${limits.perIpHour} requests per hour from one connection`));

  return withLease("testfunds:pool", 90_000, async () => {
    const allowance = await allowanceFor(contractId);
    if (allowance.remaining <= 0) await refuse(request, contractId, new TestFundsError(429, "account_limit", `this kumbara already received its test funds (${allowance.used} of ${limits.perAccount} grants per kumbara)`));
    if (allowance.nextAt) await refuse(request, contractId, new TestFundsError(429, "cooldown", `this kumbara can ask again after ${allowance.nextAt}`, allowance.nextAt));
    const today = await countEvents({ type: "testfunds_granted", since: startOfUtcDay() });
    if (today >= limits.perDay) await refuse(request, contractId, new TestFundsError(429, "daily_limit", `the pool's daily limit of ${limits.perDay} grants is used up`, new Date(startOfUtcDay() + 86_400_000).toISOString()));
    const accounts = await accountContracts([contractId], accountWasmHashes());
    if (!accounts.has(contractId)) await refuse(request, contractId, new TestFundsError(403, "not_a_kumbara", "test funds go only to kumbara accounts"));

    const anchor = await discoverAnchor();
    const server = rpcServer();
    const amount = BigInt(Math.round(limits.grantUsdc * 1e7));
    const poolUsdc = await readTokenBalance(serverEnv.stellarRpcUrl(), networkPassphrase(), anchor.usdc.contractId, pool.publicKey()).catch(() => 0n);
    if (poolUsdc < amount) await refuse(request, contractId, new TestFundsError(503, "pool_empty", "the test-funds pool is empty; the presenter has been asked to refill it"));

    const source = await server.getAccount(pool.publicKey());
    const built = new TransactionBuilder(source, { fee: "1000000", networkPassphrase: networkPassphrase() })
      .addOperation(Operation.invokeContractFunction({
        contract: anchor.usdc.contractId,
        function: "transfer",
        args: [Address.fromString(pool.publicKey()).toScVal(), Address.fromString(contractId).toScVal(), nativeToScVal(amount, { type: "i128" })],
      }))
      .setTimeout(60)
      .build();
    const prepared = await server.prepareTransaction(built);
    prepared.sign(pool);
    let hash: string;
    try {
      hash = await submit(server, prepared);
    } catch (err) {
      throw new TestFundsError(502, "grant_failed", err instanceof Error ? err.message : String(err));
    }
    const amountUsdc = (Number(amount) / 1e7).toFixed(2);
    await insertEvent({ type: "testfunds_granted", ts: Date.now(), network: serverEnv.stellarNetwork(), projectId: serverEnv.sembolProjectId(), ref, contractId, hash, usdc: amountUsdc });
    return { hash, amountUsdc, contractId, allowance: await allowanceFor(contractId) };
  }, async () => {
    throw new TestFundsError(503, "grant_failed", "another grant is in progress; try again in a few seconds");
  }, 20_000);
}

// ---------------------------------------------------------------------------
// The presenter's view of the pool, and its one-step refill.
// ---------------------------------------------------------------------------

export interface PoolStatus {
  configured: boolean;
  network: string;
  address: string | null;
  usdc: string | null;
  xlm: string | null;
  limits: ReturnType<typeof testFundsLimits>;
  grantsToday: number;
  grantsTotal: number;
  refusedToday: number;
  /** Grants per UTC day, last 7 days, oldest first. */
  perDay: { day: string; grants: number; refused: number }[];
  recent: { ts: number; contractId: string; hash: string; usdc: string }[];
  refusals: { ts: number; contractId: string; code: string }[];
}

async function horizonXlm(address: string): Promise<string | null> {
  const res = await fetch(`${HORIZON_TESTNET}/accounts/${address}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (res.status === 404) return null;
  const body = (await res.json()) as { balances?: { asset_type: string; balance: string }[] };
  return body.balances?.find((b) => b.asset_type === "native")?.balance ?? null;
}

export async function poolStatus(): Promise<PoolStatus> {
  const pool = poolKeypair();
  const limits = testFundsLimits();
  const since = startOfUtcDay() - 6 * 86_400_000;
  const [granted, refused] = await Promise.all([listEvents({ type: "testfunds_granted", since }, 5_000), listEvents({ type: "testfunds_refused", since }, 5_000)]);
  const perDay = Array.from({ length: 7 }, (_, i) => {
    const start = since + i * 86_400_000;
    const inDay = (e: EventRow) => e.ts >= start && e.ts < start + 86_400_000;
    return { day: new Date(start).toISOString().slice(0, 10), grants: granted.filter(inDay).length, refused: refused.filter(inDay).length };
  });
  let usdc: string | null = null;
  let xlm: string | null = null;
  if (pool) {
    const anchor = await discoverAnchor().catch(() => null);
    [usdc, xlm] = await Promise.all([
      anchor ? readTokenBalance(serverEnv.stellarRpcUrl(), networkPassphrase(), anchor.usdc.contractId, pool.publicKey()).then((v) => (Number(v) / 1e7).toFixed(2), () => null) : Promise.resolve(null),
      horizonXlm(pool.publicKey()).catch(() => null),
    ]);
  }
  return {
    configured: pool !== null,
    network: serverEnv.stellarNetwork(),
    address: pool?.publicKey() ?? null,
    usdc,
    xlm,
    limits,
    grantsToday: perDay[6]!.grants,
    grantsTotal: await countEvents({ type: "testfunds_granted" }),
    refusedToday: perDay[6]!.refused,
    perDay,
    recent: granted.slice(0, 10).map((e) => ({ ts: e.ts, contractId: String(e.contractId), hash: String(e.hash), usdc: String(e.usdc) })),
    refusals: refused.slice(0, 10).map((e) => ({ ts: e.ts, contractId: String(e.contractId), code: String(e.code) })),
  };
}

/**
 * One step: make sure the pool exists and trusts the anchor's USDC, top up its XLM from Friendbot when it runs low
 * (Friendbot only creates accounts, so a fresh one is funded and merged in), then swap `xlm` XLM into USDC on the
 * testnet DEX. Returns every transaction hash so the console can link them.
 */
export async function refillPool(xlm: number): Promise<{ hashes: string[]; usdcAfter: string | null }> {
  if (serverEnv.stellarNetwork() !== "testnet") throw new TestFundsError(403, "not_testnet", "the pool exists only on testnet");
  const pool = poolKeypair();
  if (!pool) throw new TestFundsError(503, "not_configured", "TESTFUNDS_SECRET is not set");
  if (!(xlm >= 10 && xlm <= 5_000)) throw new Error("swap between 10 and 5,000 XLM per refill");
  return withLease("testfunds:pool", 120_000, async () => {
    const hashes: string[] = [];
    const server = rpcServer();
    const anchor = await discoverAnchor();
    const usdc = new Asset(anchor.usdc.code, anchor.usdc.issuer);
    const friendbot = async (address: string) => {
      const res = await fetch(`${FRIENDBOT}?addr=${address}`, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`friendbot HTTP ${res.status}`);
      hashes.push(String(((await res.json()) as { hash?: string }).hash ?? ""));
    };
    if ((await horizonXlm(pool.publicKey())) === null) await friendbot(pool.publicKey());
    const balance = Number((await horizonXlm(pool.publicKey())) ?? "0");
    if (balance < xlm + 50) {
      const donor = Keypair.random();
      await friendbot(donor.publicKey());
      const merge = new TransactionBuilder(await server.getAccount(donor.publicKey()), { fee: "10000", networkPassphrase: networkPassphrase() })
        .addOperation(Operation.accountMerge({ destination: pool.publicKey() }))
        .setTimeout(60)
        .build();
      merge.sign(donor);
      hashes.push(await submit(server, merge));
    }
    const account = await server.getAccount(pool.publicKey());
    const trusts = await fetch(`${HORIZON_TESTNET}/accounts/${pool.publicKey()}`, { cache: "no-store" })
      .then((r) => r.json() as Promise<{ balances?: { asset_code?: string; asset_issuer?: string }[] }>)
      .then((b) => (b.balances ?? []).some((x) => x.asset_code === usdc.getCode() && x.asset_issuer === usdc.getIssuer()));
    const builder = new TransactionBuilder(account, { fee: "10000", networkPassphrase: networkPassphrase() });
    if (!trusts) builder.addOperation(Operation.changeTrust({ asset: usdc }));
    builder.addOperation(Operation.pathPaymentStrictSend({ sendAsset: Asset.native(), sendAmount: xlm.toFixed(7), destination: pool.publicKey(), destAsset: usdc, destMin: "0.0000001", path: [] }));
    const swap = builder.setTimeout(60).build();
    swap.sign(pool);
    hashes.push(await submit(server, swap));
    const after = await readTokenBalance(serverEnv.stellarRpcUrl(), networkPassphrase(), anchor.usdc.contractId, pool.publicKey()).catch(() => null);
    return { hashes: hashes.filter(Boolean), usdcAfter: after === null ? null : (Number(after) / Number(STROOPS)).toFixed(2) };
  }, async () => {
    throw new Error("a grant or refill is running; try again in a few seconds");
  }, 30_000);
}
