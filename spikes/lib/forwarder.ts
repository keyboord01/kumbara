/**
 * Spike wrapper around the app's landing-account module (lib/landing). The
 * scheme, its secret hygiene and its invariants live and are tested there.
 */
import type { Asset, Keypair } from "@stellar/stellar-sdk";
import {
  createLandingAccount as createShared,
  submitPreauthorized as submitShared,
  type LandingDeps,
  type LandingKind,
  type LandingPlan,
  type PreauthResult,
} from "../../lib/landing/landing";
import { networkPassphrase } from "./env";
import { info } from "./log";
import type { SembolCloudClient } from "./relay";
import { server } from "./stellar";

export type { LandingKind, LandingPlan, PreauthResult };

export interface LandingInput {
  sponsor: Keypair;
  usdc: Asset;
  usdcContract: string;
  kind: LandingKind;
  feeBufferXlm?: string;
}

function deps(sponsor: Keypair, relay: SembolCloudClient): LandingDeps {
  return {
    server: server(),
    networkPassphrase: networkPassphrase(),
    sponsor,
    relay: { sendXdr: (envelope) => relay.sendXdr(envelope) },
    log: info,
  };
}

/** Create and lock a landing account for one deposit or withdrawal. */
export function createLandingAccount(input: LandingInput, relay?: SembolCloudClient): Promise<LandingPlan> {
  const relayClient = relay ?? { sendXdr: async () => ({ success: false, error: "no relay" }) };
  const { sponsor, ...rest } = input;
  return createShared(deps(sponsor, relayClient as SembolCloudClient), rest);
}

/** Submit one of the pre-authorized transactions (relay fee-bump first). */
export function submitPreauthorized(txXdr: string, relay: SembolCloudClient, sponsor?: Keypair): Promise<PreauthResult> {
  const kp = sponsor ?? ({ publicKey: () => "" } as unknown as Keypair);
  return submitShared(deps(kp, relay), txXdr);
}
