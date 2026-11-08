# Security review: Kumbara testnet release

Scope: Kumbara as deployed on Stellar **testnet** (`https://kumbara.sembol.xyz`), reviewed 8–9 November 2026 as Deliverable 1 of the Instawards SOW. This is a self-review by the builder with fixes, not a third-party audit. Nothing here makes a mainnet claim.

Reporting a problem: open a private security advisory on this repository, or email keyboord01@gmail.com. Please do not file public issues for vulnerabilities.

## What was reviewed

| Area | Code |
| --- | --- |
| Bridge (landing) account and its pre-authorised transactions | `lib/landing/landing.ts`, `lib/landing.server.ts`, `lib/deposit.server.ts`, `lib/withdraw.server.ts`, `lib/sweep.server.ts` |
| Relay route (fee sponsorship) | `app/api/relay/route.ts`, `lib/relay.server.ts`, `lib/ratelimit.server.ts` |
| Admin endpoints and the presenter session | `lib/admin.server.ts`, `app/api/booth/admin/*`, `app/api/pipeline/tick`, `app/api/ci/status` |
| Recovery registry and profile writes | `app/api/registry`, `app/api/profile`, `lib/registry.server.ts`, `lib/db/store.ts` |
| Browser reports the server trusts | `app/api/deposit/[id]/vault`, `app/api/deposit/[id]/cancel`, `app/api/withdraw/[id]/{vault,sent}`, `app/api/vault/direct` |
| New in this release | test-funds pool (`lib/testfunds.server.ts`), feedback and error capture (`lib/monitor.server.ts`), passkey proofs (`lib/passkey-proof.server.ts`) |

## Threat model

**Assets.** Users' USDC in their smart accounts and the vault. The sponsor account's XLM, which pays bridge reserves and setup fees. The relay's fee budget. The test-funds pool's test USDC. The integrity of the public metrics on `/stats`. Users' privacy: no names, IPs or IBANs are stored.

**Who holds which key.**

| Key | Where | What it can do | What it cannot do |
| --- | --- | --- | --- |
| User passkey | User's device (WebAuthn) | Sign for that user's smart account | – |
| Sponsor secret | Server env | Create bridge accounts, pay reserves and setup fees | Move any USDC: it is never a signer of a smart account, and a locked bridge needs a pre-authorised hash *and* the bridge's own co-signature |
| Bridge (landing) secret | Server memory, a few seconds per deposit | Sign its own setup, one SEP-10 challenge and the two pre-authorised envelopes | Anything after the lock: master weight 1 against thresholds 2; the secret is wiped in place |
| Relay project key | Server env | Ask the relay to fee-bump and submit | Sign for any account |
| Presenter token | Server env, the presenter's http-only cookie | Admin endpoints: play the sandbox bank, resume or sweep records, refill the test pool | Sign for any user account |
| Test-funds pool secret | Server env | Send test USDC to Kumbara accounts | Exists only on testnet; the code refuses on mainnet |

**Attackers considered.**

1. An anonymous internet client that can call every public API route, with no browser and no passkey.
2. A user acting against another user, who knows the victim's public kumbara address and anything else that is public on chain.
3. Someone abusing the sponsored relay or the test-funds pool to spend Kumbara's budget.
4. A compromised dependency or anchor is out of scope beyond what is noted under "accepted risks".

**Trust boundaries.** The browser is untrusted. Anything it reports (transaction hashes, passkey ids) is checked against the chain before the server acts on it. Public on-chain data is not a secret: smart-account signer key data contains the passkey's credential id, so a credential id proves nothing on its own.

## Findings

Severity is for this testnet deployment. Every finding below was fixed in this release, with a test that fails without the fix, unless it is marked "accepted".

| ID | Severity | Finding | Fix |
| --- | --- | --- | --- |
| KB-01 | High | **Rate limits bypassable by a spoofed IP header.** `clientIp` trusted `fly-client-ip` first. Vercel passes that header through untouched, so a script could send a fresh value per request and skip the per-IP caps on account creation and relay calls. | Only the header the hosting platform writes is read: `x-real-ip` or `x-forwarded-for` on Vercel, `fly-client-ip` only on Fly (`lib/client-ip.ts`, unit tests). Commit `41f66b2`. |
| KB-02 | Medium | **Anyone could register a backup passkey for any kumbara, and the profile route accepted it.** `POST /api/registry` stored any credential → kumbara pair, and `PUT /api/profile` accepted those rows, so a stranger could rename someone's kumbara or change its goal. A follow-on: a verified mapping could be moved to another kumbara, so an attacker who copied a victim's (public) credential id into their own account as a signer could steer the victim's recovery to that account. | The registry stores a backup only when the chain lists the credential as a signer of that kumbara (simulated `get_context_rule` read). A verified mapping never moves to another kumbara, and the primary stays primary. Commit `570504e`; the recovery E2E's new expectations are in `9d6c3bb`. |
| KB-06 | Medium | **"Knowing the credential id" was used as proof of ownership, but the credential id is public.** The profile route (and, briefly, the KB-03 cancel fix) treated the passkey credential id as a secret only the holder's browser has. The kit stores it on chain in the signer's key data. | Writes that are not chain transactions (profile, cancelling a deposit) now need a WebAuthn assertion over a one-time, five-minute server challenge bound to the kumbara. It is verified against the P-256 key the chain holds for that signer: origin and rp id, user presence, signature, then the challenge is consumed. The goal E2E sends the kumbara's real credential id without a signature and expects 403. Commit `9d6c3bb`. |
| KB-03 | Medium | **Record ids worked as bearer capabilities, came from `Math.random`, and are listed publicly.** `GET /api/deposit?contractId=` lists deposit ids for any (public) kumbara address. With an id, anyone could cancel a stranger's pending deposit. They could also mark it "in the vault" with a made-up hash, or advance a withdrawal with made-up hashes, so the user's screen and the metrics would show money moved that never did. | Ids come from the CSPRNG. Every reported hash must be a successful transaction on this network whose footprint touches the kumbara's own contract (`txTouchesContract`). Cancelling needs a passkey proof (KB-06) or the presenter token. Commits `239946c`, `9d6c3bb`. |
| KB-04 | Medium | **The relay paid fees for any Soroban call.** `/api/relay` forwarded any `{ func, auth }` or `{ xdr }`, so anyone could run their own contracts on Kumbara's fee budget (up to the per-IP cap, which KB-01 made unlimited). | `lib/relay-policy.server.ts`: only deployments of the known account WASM, calls on a Kumbara account itself, and USDC or vault calls that a Kumbara account authorises. A Kumbara account is identified by its instance's WASM hash read from the chain, so all 215 existing accounts pass (all run `1b5f4534…`). Unit tests, plus the onboarding, recovery, test-funds and deposit E2Es through the policy. Commit `2324c90`. |
| KB-05 | Low | **Public metrics could be inflated.** `POST /api/vault/direct` recorded any hash as a vault deposit on `/stats`. | Same on-chain check as KB-03. Commit `239946c`. |
| KB-07 | Low, accepted | **Relay requests without an `Origin` header pass the same-origin check.** Non-browser clients can call `/api/relay`. | Accepted: KB-04 limits what can be relayed, and KB-01's caps now hold. |
| KB-08 | Low, accepted | **One shared presenter token; the session cookie carries it.** The cookie is http-only, `SameSite=Strict`, `Secure` over https and lasts 12 hours, but the token itself has no per-person identity or rotation. | Accepted for testnet. Before any mainnet beta: per-person admin login and an audit log of admin actions. |
| KB-09 | Low, accepted | **500 responses echo internal error text** (for example an upstream anchor message or a missing environment variable's name). Stored records pass `assertNoSecret`, but responses do not. | Accepted. No secret values are in these messages; the generic-error pass belongs with the mainnet hardening. |

### The bridge (landing) account: no finding

The construction was reviewed against its four claims:

1. **The server never has custody after the lock.** After step C the master key's weight (1) is below every threshold (2), and the only other signers are the two pre-authorised hashes (weight 1 each). The thresholds can no longer be changed, because changing them needs weight 2. The secret is wiped in place and never logged, stored or returned (`assertNoSecret` guards the plan; unit test "locks with two pre-authorized signers…").
2. **The forward pays exactly the quoted amount, to the user.** The forward envelope is built inside the pre-lock hook with the anchor's firm quote, and it is submitted only after the anchor reports `completed` with the same amount. A different amount is a hard `amount_mismatch` failure: the funds stay in the ownerless bridge, are shown to the user with an explorer link, and the presenter can resume the record. They cannot be taken.
3. **Order is enforced by the chain.** Forward is `seq+1` and cleanup is `seq+2`, so cleanup (trustline removal and merge into the sponsor) cannot run before the forward. Removing a trustline that still holds USDC fails on chain.
4. **No expiry trap.** The envelopes carry no time bounds, so a relay outage delays the forward but never invalidates it.

Residual risks, all accepted: the sponsor key is a hot key on the server. Its compromise exposes the sponsor's XLM and lets an attacker create junk bridges, but it gives no access to USDC. A bridge whose amount mismatches needs a person to resolve it. Abandoned bridges lock the sponsor's reserves until they are swept (`/api/booth/admin/sweep`, and the five-minute cron).

### Admin endpoints

Every `app/api/booth/admin/*` route and `/api/pipeline/tick` calls `requireAdmin`, which compares a SHA-256 of the token in constant time. It refuses when `BOOTH_ADMIN_TOKEN` is shorter than 12 characters. `/api/ci/status` POST has its own `CI_STATUS_TOKEN` (16+ characters), and its GET returns only a status, step, run URL and time. No admin route returns a secret. See KB-08 for the accepted limits.

### Recovery registry

The registry maps `sha256(credential id)` to a kumbara. A primary passkey is registered by the relay route from the deployment preimage itself, so it is verified without asking the client anything. A backup passkey is registered only when it appears as a signer on chain (KB-02). A verified mapping never moves to another kumbara. Lookups reveal nothing that is not already public on chain: a credential id and the account that lists it as a signer.

## New surfaces in this release

- **Test-funds pool** (`/api/testfunds`). It works on testnet only (the code refuses on mainnet), and only Kumbara accounts can receive (WASM check on chain). Limits: one grant per kumbara, 50 grants per day and 6 requests per IP per hour, all configurable. Grants run one at a time under a database lease. Every grant and refusal is an event the presenter can see on `/booth/admin/funds`.
- **Feedback and error capture** (`/api/feedback`, `/api/errors`). Reports carry only the page path (addresses stripped), browser family, OS, phone or not, language, and the failure kind. Free text has addresses, secret seeds, long hashes and IBANs cut out before storage (unit tests). Both endpoints are rate-limited per IP through a salted hash.
- **Passkey proofs** (`/api/auth/challenge`). Challenges are random, single use, bound to one kumbara and expire after five minutes. A forged proof is rejected before the challenge is consumed, so it cannot burn someone else's challenge.

## Fix commits

| Finding | Commit(s) |
| --- | --- |
| KB-01 | `41f66b2` |
| KB-02 | `570504e`, `9d6c3bb` (E2E) |
| KB-03 | `239946c`, `9d6c3bb` (cancel) |
| KB-04 | `2324c90` |
| KB-05 | `239946c` |
| KB-06 | `9d6c3bb` |

Verification: `pnpm test` (unit tests for KB-01, KB-02, KB-04 and the report scrubbing), and the E2E checks `e2e:recover` (KB-02), `e2e:goal` (KB-06), `e2e:onboard`, `e2e:testfunds` and `e2e:deposit` (KB-03 and KB-04 on real transactions), all run against live testnet on 9 November 2026. Results are in `docs/evidence/sow1/`.
