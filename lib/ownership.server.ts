/**
 * "This browser holds the kumbara's passkey", for the writes that are not chain transactions (profile, cancelling a
 * deposit): a WebAuthn assertion over a one-time challenge, checked against the key the chain holds for that signer
 * (lib/passkey-proof.server.ts). The credential id alone proves nothing: it is public in the signer's key data.
 */
import "server-only";
import { checkPasskeyProof, type PasskeyProof } from "./passkey-proof.server";

export async function provesOwnership(request: Request, contractId: string, proof: Partial<PasskeyProof> | undefined): Promise<boolean> {
  const problem = await checkPasskeyProof(request, contractId, proof).catch((err: unknown) => `proof check failed: ${err instanceof Error ? err.message : String(err)}`);
  if (problem) console.warn(`[kumbara] ownership refused for ${contractId.slice(0, 6)}…: ${problem}`);
  return problem === null;
}
