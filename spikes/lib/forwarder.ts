/**
 * Landing accounts ("emanet hesabı"): ownerless classic accounts that let an
 * anchor which only pays or watches classic G… addresses work with contract
 * wallets, without anybody holding custody.
 *
 * Shape (decided at Gate 0 review):
 *   1. sponsor tx A: create the landing account with sponsored reserves and
 *      a USDC trustline (the landing key signs its own ops).
 *   2. build two pre-authorized transactions for the landing account:
 *        forward  (seq+1): on-ramp  → SAC transfer(landing → user's smart
 *                          account, exact quoted amount)
 *                          off-ramp → classic payment(treasury, exact amount)
 *                          with the anchor's memo id
 *        cleanup  (seq+2): drop the trustline, merge into the sponsor
 *   3. sponsor tx B: add both hashes as pre-authorized signers (weight 1)
 *      and set every threshold to 2 with the master key at weight 1. Each
 *      envelope then needs its pre-authorized signer AND the master
 *      co-signature attached in step 2 (weight 1 + 1 = 2); the master key
 *      alone authorizes nothing, and neither does a pre-authorized hash
 *      alone. (Stellar rejects envelopes carrying signatures it did not
 *      need, so the co-signature has to count.) The landing secret key is
 *      dropped when this function returns.
 *   4. forward and cleanup are later submitted through the relay, which
 *      fee-bumps them. OpenZeppelin Channels treats an envelope with zero
 *      signatures as an unsigned func/auth request (and would rebuild it under
 *      its own channel account, breaking source-account auth), which is why
 *      the pre-authorized envelopes carry the master co-signature. The relay
 *      also requires no far-future time bound and, for Soroban, an inner fee
 *      equal to the declared resource fee, so both are built that way.
 *
 * Nobody can produce any other transaction for the account, so the USDC can
 * only follow the pre-agreed path. Reserves are sponsored and the account is
 * created with zero XLM, so the sponsor's reserves return at the merge.
 */
import {
  Account,
  Address,
  Asset,
  BASE_FEE,
  Keypair,
  Memo,
  Operation,
  SorobanDataBuilder,
  TimeoutInfinite,
  TransactionBuilder,
  rpc,
  xdr,
  type Transaction,
} from "@stellar/stellar-sdk";
import { networkPassphrase } from "./env";
import { info } from "./log";
import type { SembolCloudClient } from "./relay";
import { addressScVal, i128, server, submitTransaction, type SubmitResult } from "./stellar";

export type LandingKind =
  | { type: "onramp"; destinationContract: string; amountStroops: bigint }
  | { type: "offramp"; treasury: string; memoId: string; amountStroops: bigint };

export interface LandingInput {
  sponsor: Keypair;
  usdc: Asset;
  usdcContract: string;
  kind: LandingKind;
  /** Optional XLM parked on the account (default "0": the relay pays all fees). */
  feeBufferXlm?: string;
}

export interface LandingPlan {
  publicKey: string;
  kind: LandingKind["type"];
  createTxHash: string;
  lockTxHash: string;
  forwardTxXdr: string;
  forwardTxHash: string;
  cleanupTxXdr: string;
  cleanupTxHash: string;
  /** Fees the sponsor paid for the two setup transactions, in stroops. */
  sponsorFeesStroops: bigint;
}

function transferHostFunction(usdcContract: string, from: string, to: string, amount: bigint): xdr.HostFunction {
  return xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: Address.fromString(usdcContract).toScAddress(),
      functionName: "transfer",
      args: [addressScVal(from), addressScVal(to), i128(amount)],
    }),
  );
}

function sourceAccountAuth(usdcContract: string, from: string, to: string, amount: bigint): xdr.SorobanAuthorizationEntry {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({
          contractAddress: Address.fromString(usdcContract).toScAddress(),
          functionName: "transfer",
          args: [addressScVal(from), addressScVal(to), i128(amount)],
        }),
      ),
      subInvocations: [],
    }),
  });
}

/** Soroban forward: footprint from a zero-amount simulation, resources padded. */
async function buildSorobanForward(landing: string, seq: bigint, input: LandingInput, destination: string, amount: bigint): Promise<Transaction> {
  const passphrase = networkPassphrase();
  const probe = new TransactionBuilder(new Account(landing, seq.toString()), { fee: BASE_FEE, networkPassphrase: passphrase })
    .addOperation(Operation.invokeHostFunction({ func: transferHostFunction(input.usdcContract, landing, destination, 0n), auth: [] }))
    .setTimeout(3600)
    .build();
  const sim = await server().simulateTransaction(probe);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`forward footprint simulation failed: ${sim.error}`);
  const simData = sim.transactionData.build();
  const res = simData.resources();
  const instructions = Math.min(Math.ceil(res.instructions() * 1.3) + 200_000, 100_000_000);
  const readBytes = Math.ceil(res.diskReadBytes() * 1.5) + 1_000;
  const writeBytes = Math.ceil(res.writeBytes() * 1.5) + 1_000;
  const resourceFee = (BigInt(sim.minResourceFee) * 3n) / 2n + 200_000n;
  const data = new SorobanDataBuilder(simData).setResources(instructions, readBytes, writeBytes).setResourceFee(resourceFee).build();
  // TransactionBuilder adds the declared resource fee on top of this
  // inclusion fee. The relay fee-bumps with max_fee = resourceFee + ~203, and
  // a fee bump must exceed the inner fee by at least one base fee, so the
  // inner inclusion fee stays at the 100-stroop minimum.
  return new TransactionBuilder(new Account(landing, seq.toString()), { fee: BASE_FEE, networkPassphrase: passphrase })
    .addOperation(
      Operation.invokeHostFunction({
        func: transferHostFunction(input.usdcContract, landing, destination, amount),
        auth: [sourceAccountAuth(input.usdcContract, landing, destination, amount)],
      }),
    )
    .setSorobanData(data)
    .setTimeout(TimeoutInfinite)
    .build();
}

function buildClassicForward(landing: string, seq: bigint, input: LandingInput, treasury: string, memoId: string, amount: bigint): Transaction {
  return new TransactionBuilder(new Account(landing, seq.toString()), { fee: "1000", networkPassphrase: networkPassphrase() })
    .addOperation(Operation.payment({ destination: treasury, asset: input.usdc, amount: stroopsToAmount(amount) }))
    .addMemo(Memo.id(memoId))
    .setTimeout(TimeoutInfinite)
    .build();
}

function stroopsToAmount(stroops: bigint): string {
  const whole = stroops / 10_000_000n;
  const frac = (stroops % 10_000_000n).toString().padStart(7, "0");
  return `${whole}.${frac}`;
}

export async function createLandingAccount(input: LandingInput): Promise<LandingPlan> {
  const passphrase = networkPassphrase();
  const landing = Keypair.random();
  const landingPub = landing.publicKey();
  const sponsorPub = input.sponsor.publicKey();
  info(`landing account ${landingPub} (${input.kind.type})`);

  // A: sponsored creation + trustline. The landing key signs its own ops.
  const sponsorAccount = await server().getAccount(sponsorPub);
  const createTx = new TransactionBuilder(sponsorAccount, { fee: "1000", networkPassphrase: passphrase })
    .addOperation(Operation.beginSponsoringFutureReserves({ sponsoredId: landingPub }))
    .addOperation(Operation.createAccount({ destination: landingPub, startingBalance: input.feeBufferXlm ?? "0" }))
    .addOperation(Operation.changeTrust({ asset: input.usdc, source: landingPub }))
    .addOperation(Operation.endSponsoringFutureReserves({ source: landingPub }))
    .setTimeout(300)
    .build();
  createTx.sign(input.sponsor, landing);
  const created = await submitTransaction(createTx);

  const landingAccount = await server().getAccount(landingPub);
  const seq = BigInt(landingAccount.sequenceNumber());

  // Pre-authorized transactions: forward at seq+1, cleanup at seq+2.
  // TransactionBuilder uses account.sequenceNumber() + 1, so an Account at
  // `seq` yields the seq+1 transaction and one at `seq+1` yields seq+2.
  const forwardTx =
    input.kind.type === "onramp"
      ? await buildSorobanForward(landingPub, seq, input, input.kind.destinationContract, input.kind.amountStroops)
      : buildClassicForward(landingPub, seq, input, input.kind.treasury, input.kind.memoId, input.kind.amountStroops);
  const cleanupTx = new TransactionBuilder(new Account(landingPub, (seq + 1n).toString()), { fee: "1000", networkPassphrase: passphrase })
    .addOperation(Operation.changeTrust({ asset: input.usdc, limit: "0" }))
    .addOperation(Operation.accountMerge({ destination: sponsorPub }))
    .setTimeout(TimeoutInfinite)
    .build();
  // Co-sign both envelopes now (see the header comment); the key is dropped after.
  forwardTx.sign(landing);
  cleanupTx.sign(landing);

  // B: lock. Two pre-authorized signers (sponsored), master weight 0.
  const sponsorAccount2 = await server().getAccount(sponsorPub);
  const lockTx = new TransactionBuilder(sponsorAccount2, { fee: "1000", networkPassphrase: passphrase })
    .addOperation(Operation.beginSponsoringFutureReserves({ sponsoredId: landingPub }))
    .addOperation(Operation.setOptions({ source: landingPub, signer: { preAuthTx: forwardTx.hash(), weight: 1 } }))
    .addOperation(Operation.setOptions({ source: landingPub, signer: { preAuthTx: cleanupTx.hash(), weight: 1 } }))
    .addOperation(Operation.setOptions({ source: landingPub, masterWeight: 1, lowThreshold: 2, medThreshold: 2, highThreshold: 2 }))
    .addOperation(Operation.endSponsoringFutureReserves({ source: landingPub }))
    .setTimeout(300)
    .build();
  lockTx.sign(input.sponsor, landing);
  const locked = await submitTransaction(lockTx);

  // The landing secret key goes out of scope here; nothing persists it.
  return {
    publicKey: landingPub,
    kind: input.kind.type,
    createTxHash: created.hash,
    lockTxHash: locked.hash,
    forwardTxXdr: forwardTx.toXDR(),
    forwardTxHash: forwardTx.hash().toString("hex"),
    cleanupTxXdr: cleanupTx.toXDR(),
    cleanupTxHash: cleanupTx.hash().toString("hex"),
    sponsorFeesStroops: BigInt(createTx.fee) + BigInt(lockTx.fee),
  };
}

export interface PreauthResult extends SubmitResult {
  /** "relay" when the relay fee-bumped it, "direct" when the landing account paid. */
  via: "relay" | "direct";
  relayError?: string;
}

/**
 * Submit a pre-authorized transaction: through the relay (fee-bumped) first,
 * falling back to direct submission paid from the landing account's buffer.
 */
export async function submitPreauthorized(txXdr: string, relay: SembolCloudClient): Promise<PreauthResult> {
  const tx = TransactionBuilder.fromXDR(txXdr, networkPassphrase()) as Transaction;
  const relayed = await relay.sendXdr(tx);
  if (relayed.success && relayed.hash) {
    const polled = await server().pollTransaction(relayed.hash, { attempts: 40 });
    if (polled.status === "SUCCESS") {
      return { hash: relayed.hash, ledger: polled.ledger, via: "relay" };
    }
    throw new Error(`relayed pre-authorized transaction ${relayed.hash} ended ${polled.status}`);
  }
  info(`relay refused to fee-bump (${relayed.errorCode ?? ""} ${relayed.error ?? ""}) details=${JSON.stringify(relayed.details).slice(0, 600)}; trying direct submission`);
  const direct = await submitTransaction(tx);
  const out: PreauthResult = { ...direct, via: "direct" };
  if (relayed.error) out.relayError = relayed.error;
  return out;
}
