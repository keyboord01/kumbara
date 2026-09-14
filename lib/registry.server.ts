/**
 * Passkey → kumbara lookups without a third-party indexer. The smart-account
 * kit deploys every kumbara at an address derived from sha256(credential id)
 * (the salt of the deployment preimage) and a public deployer, so the primary
 * passkey finds its kumbara on any device by derivation alone. This registry
 * remembers the same salt → contract pair at deployment (verified by the relay
 * from the preimage itself) and, unverified, the backup passkeys a user
 * enrols later, so "I can't find my passkey" can look them up.
 */
import "server-only";
import { createHash } from "node:crypto";

/** sha256 of the credential id's bytes, hex: exactly the salt the kit puts in the deployment preimage. */
export function credentialSaltHex(credentialId: string): string | null {
  const bytes = credentialBytes(credentialId);
  if (!bytes || bytes.length < 8 || bytes.length > 1024) return null;
  return createHash("sha256").update(bytes).digest("hex");
}

/** Accepts the id as base64url (WebAuthn), standard base64 (CDP, some libraries) or hex. */
function credentialBytes(id: string): Buffer | null {
  const trimmed = id.trim();
  if (!trimmed) return null;
  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0 && trimmed.length >= 32) return Buffer.from(trimmed, "hex");
  if (/^[A-Za-z0-9_-]+$/.test(trimmed)) return Buffer.from(trimmed, "base64url");
  if (/^[A-Za-z0-9+/]+=*$/.test(trimmed)) return Buffer.from(trimmed, "base64");
  return null;
}

export function isContractId(value: string): boolean {
  return /^C[A-Z2-7]{55}$/.test(value);
}
