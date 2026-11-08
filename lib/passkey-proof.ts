/**
 * Browser side of the passkey proof (server: lib/passkey-proof.server.ts): fetch a one-time challenge for the kumbara
 * and have the passkey sign it. One passkey prompt; used only for writes that are not chain transactions.
 */
import { api } from "./api";
import { WEBAUTHN_RP_ID } from "./config";

const b64url = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), (c) => c.charCodeAt(0));

export interface PasskeyProof {
  credentialId: string;
  authenticatorData: string;
  clientDataJSON: string;
  signature: string;
}

export async function provePasskey(contractId: string, credentialId: string): Promise<PasskeyProof> {
  const { challenge } = await api<{ challenge: string }>("/api/auth/challenge", { method: "POST", body: JSON.stringify({ contractId }) });
  const id = /^[A-Za-z0-9_-]+$/.test(credentialId) ? credentialId : credentialId.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: fromB64url(challenge),
      ...(WEBAUTHN_RP_ID ? { rpId: WEBAUTHN_RP_ID } : {}),
      allowCredentials: [{ type: "public-key", id: fromB64url(id) }],
      userVerification: "preferred",
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new DOMException("no passkey approval", "NotAllowedError");
  const response = cred.response as AuthenticatorAssertionResponse;
  return { credentialId: b64url(cred.rawId), authenticatorData: b64url(response.authenticatorData), clientDataJSON: b64url(response.clientDataJSON), signature: b64url(response.signature) };
}
