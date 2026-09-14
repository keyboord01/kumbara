/**
 * Invite links. Every kumbara has a deterministic invite code derived from
 * its contract id, used as the booth-style `?ref=` of a link; accounts opened
 * through it carry that ref in their account_created event, so the referrer's
 * count is a query, not a table. Invite refs are exempt from the per-ref cap
 * (that cap guards printed booth links) and still under the per-IP cap; they
 * count in /stats like any other ref. E2E runs use `e2e-` + the code so their
 * accounts stay out of the public numbers but still count for the referrer.
 */
import "server-only";
import { createHash } from "node:crypto";
import { countEvents } from "./store.server";

export const INVITE_PREFIX = "inv-";

export function inviteCode(contractId: string): string {
  return INVITE_PREFIX + createHash("sha256").update(`kumbara-invite:${contractId}`).digest("hex").slice(0, 10);
}

export function isInviteRef(ref: string | null | undefined): boolean {
  return Boolean(ref && /^(e2e-)?inv-[0-9a-f]{10}$/.test(ref));
}

/** Accounts opened through this kumbara's link (real ones, plus E2E ones tagged with the same code). */
export async function inviteCount(contractId: string): Promise<number> {
  const code = inviteCode(contractId);
  const [real, e2e] = await Promise.all([countEvents({ type: "account_created", ref: code }), countEvents({ type: "account_created", ref: `e2e-${code}` })]);
  return real + e2e;
}
