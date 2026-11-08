/**
 * Proof that the caller holds a kumbara's passkey, for the few writes that are not chain transactions (renaming a
 * kumbara, cancelling a deposit). Knowing the credential id is not enough: the kit stores it on chain in the
 * signer's key data, so anyone can read it (SECURITY.md, KB-06). Instead the browser signs a one-time server
 * challenge with the passkey (a WebAuthn assertion) and the server checks it against the public key the chain holds
 * for that signer:
 *
 *   challenge  random, single use, bound to the kumbara, five minutes
 *   clientData type webauthn.get, the challenge, an origin on the relying party
 *   authData   rpIdHash = sha256(rp id), user present
 *   signature  ECDSA P-256 over authData || sha256(clientDataJSON), with the key from the chain
 */
import "server-only";
import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";
import { signerPublicKey } from "./chain-checks.server";
import { credentialBytes } from "./registry.server";
import { db } from "./db/store";

const CHALLENGE_TTL_MS = 5 * 60_000;

export interface PasskeyProof {
  credentialId: string;
  authenticatorData: string;
  clientDataJSON: string;
  signature: string;
}

export async function issueChallenge(contractId: string): Promise<string> {
  const challenge = randomBytes(32).toString("base64url");
  const conn = await db();
  await conn.execute({ sql: "DELETE FROM kv WHERE key LIKE 'challenge:%' AND updated_at < ?", args: [new Date(Date.now() - CHALLENGE_TTL_MS).toISOString()] });
  await conn.execute({ sql: "INSERT INTO kv (key, json, updated_at) VALUES (?, ?, ?)", args: [`challenge:${challenge}`, JSON.stringify({ contractId }), new Date().toISOString()] });
  return challenge;
}

/** Single use: the row is deleted by the same statement that reads it, so a replayed assertion finds nothing. */
async function consumeChallenge(challenge: string, contractId: string): Promise<boolean> {
  const res = await (await db()).execute({ sql: "DELETE FROM kv WHERE key = ? RETURNING json, updated_at", args: [`challenge:${challenge}`] });
  const row = res.rows[0];
  if (!row) return false;
  const fresh = Date.now() - Date.parse(String(row.updated_at)) < CHALLENGE_TTL_MS;
  return fresh && (JSON.parse(String(row.json)) as { contractId: string }).contractId === contractId;
}

function rpIdFor(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_WEBAUTHN_RP_ID?.trim();
  if (configured) return configured;
  return (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").split(":")[0]!;
}

function p256Key(uncompressed: Buffer) {
  return createPublicKey({ key: { kty: "EC", crv: "P-256", x: uncompressed.subarray(1, 33).toString("base64url"), y: uncompressed.subarray(33, 65).toString("base64url") }, format: "jwk" });
}

/** Null when the proof holds; otherwise why not (for the logs, never shown to the user). */
export async function checkPasskeyProof(request: Request, contractId: string, proof: Partial<PasskeyProof> | undefined): Promise<string | null> {
  if (!proof?.credentialId || !proof.authenticatorData || !proof.clientDataJSON || !proof.signature) return "no passkey proof";
  const credential = credentialBytes(proof.credentialId);
  if (!credential) return "malformed credential id";
  let client: { type?: string; challenge?: string; origin?: string };
  const clientRaw = Buffer.from(proof.clientDataJSON, "base64url");
  try {
    client = JSON.parse(clientRaw.toString("utf8")) as typeof client;
  } catch {
    return "malformed clientDataJSON";
  }
  if (client.type !== "webauthn.get") return "not an assertion";
  const rpId = rpIdFor(request);
  let originHost = "";
  try {
    originHost = new URL(String(client.origin)).hostname;
  } catch {
    return "malformed origin";
  }
  if (!rpId || (originHost !== rpId && !originHost.endsWith(`.${rpId}`))) return `origin ${originHost} is not on ${rpId}`;
  const auth = Buffer.from(proof.authenticatorData, "base64url");
  if (auth.length < 37) return "short authenticatorData";
  if (!auth.subarray(0, 32).equals(createHash("sha256").update(rpId).digest())) return "rp id hash mismatch";
  if ((auth[32]! & 0x01) === 0) return "user not present";
  const key = await signerPublicKey(contractId, credential).catch(() => null);
  if (!key) return "this passkey is not a signer of that kumbara";
  const signed = Buffer.concat([auth, createHash("sha256").update(clientRaw).digest()]);
  if (!verify("sha256", signed, p256Key(key), Buffer.from(proof.signature, "base64url"))) return "bad signature";
  // Last, so a malformed or forged proof never burns someone else's challenge.
  if (!(await consumeChallenge(String(client.challenge), contractId))) return "unknown, used or expired challenge";
  return null;
}
