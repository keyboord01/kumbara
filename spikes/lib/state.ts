/**
 * Persistent scratch state for the spikes (spikes/.state.json, gitignored).
 * Holds throwaway testnet keys so repeated runs reuse the same smart account,
 * funder account, anchor customer and vault instead of creating new ones.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export interface SpikeState {
  funder?: { secret: string; publicKey: string };
  passkey?: {
    credentialId: string;
    privateKeyPem: string;
    publicKeyHex: string;
    contractId: string;
    counter: number;
  };
  anchorCustomerId?: string;
  vaultId?: string;
}

const FILE = "spikes/.state.json";

export function loadState(): SpikeState {
  if (!existsSync(FILE)) return {};
  return JSON.parse(readFileSync(FILE, "utf8")) as SpikeState;
}

export function saveState(patch: Partial<SpikeState>): SpikeState {
  const next = { ...loadState(), ...patch };
  writeFileSync(FILE, JSON.stringify(next, null, 2));
  return next;
}
