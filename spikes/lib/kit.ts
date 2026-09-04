/**
 * smart-account-kit wiring for the spikes: Sembol's testnet contract set, the
 * software authenticator and the Sembol Cloud relay. Wallet identity lives in
 * spikes/.state.json so every spike drives the same smart account.
 */
import { MemoryStorage, SmartAccountKit } from "smart-account-kit";
import { networkPassphrase, rpcUrl } from "./env";
import { info, ok, txLink } from "./log";
import { SoftwareAuthenticator } from "./passkey";
import { attachRelay, relayFromEnv, type SembolCloudClient } from "./relay";
import { loadState, saveState } from "./state";
import { SMART_ACCOUNT_TESTNET } from "./testnet";

export const RP_ID = "kumbara.local";
export const ORIGIN = "https://kumbara.local";

export interface KitBundle {
  kit: SmartAccountKit;
  authenticator: SoftwareAuthenticator;
  relay: SembolCloudClient;
}

export function makeKit(authenticator: SoftwareAuthenticator, relay = relayFromEnv()): KitBundle {
  const kit = new SmartAccountKit({
    rpcUrl: rpcUrl(),
    networkPassphrase: networkPassphrase(),
    accountWasmHash: SMART_ACCOUNT_TESTNET.accountWasmHash,
    webauthnVerifierAddress: SMART_ACCOUNT_TESTNET.webauthnVerifierAddress,
    ed25519VerifierAddress: SMART_ACCOUNT_TESTNET.ed25519VerifierAddress,
    storage: new MemoryStorage(),
    rpId: RP_ID,
    rpName: "Kumbara",
    webAuthn: authenticator as unknown as NonNullable<ConstructorParameters<typeof SmartAccountKit>[0]["webAuthn"]>,
    // A placeholder so the kit constructs its relayer path; replaced below.
    relayerUrl: "https://sembol-cloud.invalid",
    timeoutInSeconds: 60,
  });
  attachRelay(kit, relay);
  return { kit, authenticator, relay };
}

/** Create a brand-new smart account through the relay (one passkey signer). */
export async function createSmartAccount(userName: string, relay = relayFromEnv()): Promise<KitBundle & { contractId: string; hash: string }> {
  const authenticator = new SoftwareAuthenticator(RP_ID, ORIGIN);
  const bundle = makeKit(authenticator, relay);
  const result = await bundle.kit.createWallet("Kumbara", userName, { autoSubmit: true });
  if (!result.submitResult?.success) {
    const err = result.submitResult?.error;
    throw new Error(`wallet deployment failed: ${err ? `[${err.code}] ${err.message}` : "no submit result"}`);
  }
  return { ...bundle, contractId: result.contractId, hash: result.submitResult.hash ?? "" };
}

/** Load the spikes' shared smart account, creating it on first use. */
export async function ensureWallet(): Promise<KitBundle & { contractId: string; credentialId: string }> {
  const state = loadState();
  if (state.passkey) {
    const authenticator = new SoftwareAuthenticator(RP_ID, ORIGIN, state.passkey);
    const bundle = makeKit(authenticator);
    const connected = await bundle.kit.connectWallet({
      credentialId: state.passkey.credentialId,
      contractId: state.passkey.contractId,
    });
    if (!connected) throw new Error("connectWallet returned null for the stored credential");
    info(`connected smart account ${connected.contractId}`);
    return { ...bundle, contractId: connected.contractId, credentialId: connected.credentialId };
  }
  const created = await createSmartAccount(`kumbara-spike-${Date.now()}`);
  saveState({
    passkey: { ...created.authenticator.toState(), contractId: created.contractId },
  });
  ok(`created smart account ${created.contractId} via relay: ${txLink(created.hash)}`);
  return { ...created, credentialId: created.authenticator.credentialId };
}

/** Persist the authenticator's signature counter after signing. */
export function persistAuthenticator(authenticator: SoftwareAuthenticator, contractId: string): void {
  saveState({ passkey: { ...authenticator.toState(), contractId } });
}
