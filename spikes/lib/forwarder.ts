/**
 * Trustless landing account ("emanet hesabı") for anchors that can only pay
 * classic G… addresses.
 *
 * The anchor refuses contract destinations, so the on-ramp has to land on a
 * classic account first. To keep Kumbara non-custodial that account must be
 * one nobody controls: its master key is discarded after setup and its only
 * signers are two pre-authorized transactions,
 *
 *   forward:  SAC transfer(landing -> user's smart account, exact quoted amount)
 *   cleanup:  drop the USDC trustline and merge the XLM reserve back to the
 *             sponsor
 *
 * Both transactions are fixed at setup (their hashes are the signers), so the
 * USDC can only ever move to the user's kumbara. Nobody (not Kumbara, not
 * Sembol, not the relay) can redirect it. The price is ~2 XLM of reserves per
 * deposit while the account exists (recovered by the cleanup merge) and three
 * extra classic transactions.
 *
 * Testnet: the landing account is funded by friendbot. Mainnet: the sponsor
 * would create it with sponsored reserves.
 */
import {
  Account,
  Address,
  Asset,
  BASE_FEE,
  Keypair,
  Operation,
  SorobanDataBuilder,
  TransactionBuilder,
  rpc,
  xdr,
  type Transaction,
} from "@stellar/stellar-sdk";
import { networkPassphrase } from "./env";
import { info } from "./log";
import { addressScVal, friendbot, i128, server, submitTransaction, type SubmitResult } from "./stellar";

export interface LandingPlan {
  /** The landing account's public key. Its secret key is never persisted. */
  publicKey: string;
  trustlineTxHash: string;
  setupTxHash: string;
  forwardTxXdr: string;
  forwardTxHash: string;
  cleanupTxXdr: string;
  cleanupTxHash: string;
  amountStroops: bigint;
}

export interface LandingInput {
  usdc: Asset;
  usdcContract: string;
  destinationContract: string;
  amountStroops: bigint;
  /** Where the XLM reserve goes when the landing account self-destructs. */
  sponsor: string;
}

function invokeTransferOp(usdcContract: string, from: string, to: string, amount: bigint, auth: xdr.SorobanAuthorizationEntry[]) {
  const args = [addressScVal(from), addressScVal(to), i128(amount)];
  return Operation.invokeHostFunction({
    func: xdr.HostFunction.hostFunctionTypeInvokeContract(
      new xdr.InvokeContractArgs({
        contractAddress: Address.fromString(usdcContract).toScAddress(),
        functionName: "transfer",
        args,
      }),
    ),
    auth,
  });
}

function sourceAccountAuthEntry(usdcContract: string, from: string, to: string, amount: bigint): xdr.SorobanAuthorizationEntry {
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

/**
 * Create and lock a landing account for one deposit. Returns the plan with the
 * two pre-authorized transactions; the landing secret key is dropped on return.
 */
export async function createLandingAccount(input: LandingInput): Promise<LandingPlan> {
  const passphrase = networkPassphrase();
  const landing = Keypair.random();
  const landingPub = landing.publicKey();
  info(`landing account ${landingPub}`);

  await friendbot(landingPub);
  const account = await server().getAccount(landingPub);
  const seq = BigInt(account.sequenceNumber());

  // tx1 (seq+1): USDC trustline, so the anchor pays with a plain payment.
  const trustTx = new TransactionBuilder(new Account(landingPub, seq.toString()), { fee: BASE_FEE, networkPassphrase: passphrase })
    .addOperation(Operation.changeTrust({ asset: input.usdc }))
    .setTimeout(300)
    .build();
  trustTx.sign(landing);
  const trust = await submitTransaction(trustTx);

  // Footprint for the forward: simulate the identical call with amount 0
  // (moves nothing, touches the same ledger entries), then inflate resources.
  const probe = new TransactionBuilder(new Account(landingPub, (seq + 2n).toString()), { fee: BASE_FEE, networkPassphrase: passphrase })
    .addOperation(invokeTransferOp(input.usdcContract, landingPub, input.destinationContract, 0n, []))
    .setTimeout(3600)
    .build();
  const sim = await server().simulateTransaction(probe);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`forward footprint simulation failed: ${sim.error}`);
  }
  const simData = sim.transactionData.build();
  const resources = simData.resources();
  const instructions = Math.min(Math.ceil(resources.instructions() * 2) + 1_000_000, 100_000_000);
  const readBytes = resources.diskReadBytes() * 2 + 2_000;
  const writeBytes = resources.writeBytes() * 2 + 2_000;
  const resourceFee = BigInt(sim.minResourceFee) * 3n + 500_000n;
  const forwardData = new SorobanDataBuilder(simData)
    .setResources(instructions, readBytes, writeBytes)
    .setResourceFee(resourceFee)
    .build();

  // forward (seq+3): exact quoted amount to the user's smart account.
  const forwardTx = new TransactionBuilder(new Account(landingPub, (seq + 2n).toString()), {
    fee: (resourceFee + 10_000n).toString(),
    networkPassphrase: passphrase,
  })
    .addOperation(
      invokeTransferOp(input.usdcContract, landingPub, input.destinationContract, input.amountStroops, [
        sourceAccountAuthEntry(input.usdcContract, landingPub, input.destinationContract, input.amountStroops),
      ]),
    )
    .setSorobanData(forwardData)
    .setTimeout(24 * 3600)
    .build();

  // cleanup (seq+4): remove the trustline, give the reserve back.
  const cleanupTx = new TransactionBuilder(new Account(landingPub, (seq + 3n).toString()), { fee: BASE_FEE, networkPassphrase: passphrase })
    .addOperation(Operation.changeTrust({ asset: input.usdc, limit: "0" }))
    .addOperation(Operation.accountMerge({ destination: input.sponsor }))
    .setTimeout(24 * 3600)
    .build();

  // tx2 (seq+2): the two pre-authorized transactions become the only signers.
  const setupTx = new TransactionBuilder(new Account(landingPub, (seq + 1n).toString()), { fee: BASE_FEE, networkPassphrase: passphrase })
    .addOperation(Operation.setOptions({ signer: { preAuthTx: forwardTx.hash(), weight: 1 } }))
    .addOperation(Operation.setOptions({ signer: { preAuthTx: cleanupTx.hash(), weight: 1 } }))
    .addOperation(Operation.setOptions({ masterWeight: 0, lowThreshold: 1, medThreshold: 1, highThreshold: 1 }))
    .setTimeout(300)
    .build();
  setupTx.sign(landing);
  const setup = await submitTransaction(setupTx);

  // The secret key goes out of scope here and is never written anywhere.
  return {
    publicKey: landingPub,
    trustlineTxHash: trust.hash,
    setupTxHash: setup.hash,
    forwardTxXdr: forwardTx.toXDR(),
    forwardTxHash: forwardTx.hash().toString("hex"),
    cleanupTxXdr: cleanupTx.toXDR(),
    cleanupTxHash: cleanupTx.hash().toString("hex"),
    amountStroops: input.amountStroops,
  };
}

/** Submit one of the pre-authorized transactions (no signature needed). */
export async function submitPreauthorized(txXdr: string): Promise<SubmitResult> {
  const tx = TransactionBuilder.fromXDR(txXdr, networkPassphrase()) as Transaction;
  return submitTransaction(tx);
}
