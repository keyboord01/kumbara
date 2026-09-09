# Kumbara architecture

Kumbara is a self-custodial USDC piggy bank for Turkish users, built on Stellar. A user opens it with a passkey and gets an OpenZeppelin smart account; Turkish lira goes in and out through a regulated anchor; the USDC sits in a DeFindex vault. Kumbara never holds fiat, keys or USDC.

## How it works

```mermaid
sequenceDiagram
  autonumber
  participant U as User (phone, passkey)
  participant K as Kumbara (Next.js)
  participant R as Sembol Cloud relay
  participant S as Stellar testnet
  participant A as TR Mock Anchor
  participant V as DeFindex vault

  U->>K: Tap "Kumbaranı aç"
  K->>U: WebAuthn create (passkey)
  K->>R: { func, auth } deploy smart account (project key, server-side)
  R->>S: fee-bumped createContractV2
  K->>R: { func, auth } add USDC spending-limit rule (2nd passkey approval)
  Note over K,S: Deposit (ONRAMP_MODE=landing)
  K->>A: quote (rate locked 120 s) → exact USDC amount
  K->>S: sponsor creates ownerless landing account (trustline, two pre-authorized txs)
  K->>A: onramp { quote_id, destination: landing G… }
  A->>S: classic USDC payment to the landing account
  K->>R: pre-authorized forward (SAC transfer landing → smart account)
  K->>R: pre-authorized cleanup (drop trustline, merge to sponsor)
  K->>U: passkey approval: vault.deposit(USDC)
  K->>R: { func, auth } → V
  Note over K,S: Withdraw (OFFRAMP_MODE=landing)
  K->>A: offramp → treasury address + memo id
  K->>U: passkey approval: vault.withdraw, USDC → landing account
  K->>R: pre-authorized classic payment (treasury, memo id), then cleanup
  A->>A: matches memo, simulated FAST payout to IBAN
```

## The stack, in plain English

- **Wallet**: every user is an OpenZeppelin smart account contract on Stellar whose only signer is the passkey on their phone. `@sembol/passkey-react` handles creation, signing, recovery (backup passkeys, any-of-N signers) and the spending-limit policy UI. Kumbara adds no wallet code of its own.
- **Fees**: the browser never holds XLM. Signed authorization entries go to Kumbara's own `/api/relay` route, which attaches the project key and forwards to Sembol Cloud, a relay in front of an unmodified OpenZeppelin Relayer running the Channels plugin. Until Sembol Cloud is deployed the same route can point at the hosted OpenZeppelin Channels service. If the relay is down, the app says so; it never asks the user for XLM.
- **Lira in and out**: the anchor is the regulated party, spoken to over the standard SEPs only. SEP-1 discovery from its `stellar.toml` gives the USDC issuer and every endpoint; the bridge account authenticates with SEP-10, registers with SEP-12, takes a firm SEP-38 quote and opens the SEP-6 deposit-exchange (IBAN plus reference) or withdraw-exchange (account plus memo). The TR Mock Anchor converts TRY to testnet USDC at a Reflector-sourced rate with a 50 bps spread and pays out simulated FAST transfers; its limits (50–3,000 TRY per deposit) are read from what it publishes, never hardcoded. Any SEP-6 anchor can be configured by home domain and asset code alone.
- **Landing accounts**: the anchor only pays and watches classic G… addresses, so each deposit and withdrawal passes through a throwaway classic account that nobody controls (see the threat model). It exists for about a minute and its reserves return to the sponsor.
- **Yield**: USDC is deposited into a DeFindex vault with `invest=true`, so every deposit goes through the vault's invest path into its strategy in the same transaction, and every withdrawal unwinds from the strategy. On testnet the vault (`CAT76PQM…KSKL`) was deployed through the DeFindex factory for Circle's testnet USDC with one strategy attached: Kumbara's own deployment of DeFindex's unmodified **hodl strategy** (`CDFLOE4H…DMQN`), which holds the USDC and earns nothing, because no testnet strategy produces yield for this asset (see "DeFindex strategy on testnet" below). On mainnet the app points at DeFindex's USDC vault with Blend strategies. Kumbara writes no vault or strategy code.
- **Price**: the TRY equivalent shown on the Savings screen comes from Reflector's foreign-exchange oracle on Stellar mainnet (USD/TRY, 14 decimals, 5-minute resolution), with the anchor's mid rate as fallback.
- **Booth counter and metrics**: `/api/relay` records project id, timestamp, network, booth ref and the transaction hash for every confirmed relayed submission; deposits and withdrawals carry the ref too. `/api/metrics` exposes accounts (deploy confirmed), deposits, vault deposits and withdrawals with hashes, filterable by ref and start time, cached 30 s. Nothing else is tracked.
- **Abuse guard**: account creation is capped per client IP per hour (a salted hash of the IP in process memory, never persisted) and per booth ref (counted from confirmed deployments in SQLite); relay calls have a generous per-IP cap; onboarding is refused while the sponsor is below its minimum balance. All limits are env-configurable.
- **Storage and hosting**: Vercel (Hobby, Fluid compute, functions in Frankfurt) with a Turso database in Ireland holding deposit and withdrawal records, the contract → anchor-customer map, the counter events, the per-record leases and the rate-limit windows. Nothing that matters lives in process memory: each poll resumes a pipeline from its stored state under a database lease that expires on its own, so a crashed or concurrent invocation can never double-run a step. Locally the same code uses a libsql file. The anchor's transaction lists remain the reconciliation source if the database were ever lost.

## Deposit pipeline (Gate 2)

`lib/deposit.server.ts` runs the deposit as a state machine that advances one step per poll from the browser, so it fits ordinary request handlers and survives reloads (the record lives in the store, the browser resumes the active deposit on load):

| Status | What happened / what the next poll does |
| --- | --- |
| `awaiting_transfer` | Indicative quote and the anchor's IBAN + reference are shown. The poll watches the customer's TRY balance rise by at least 50 TRY over the baseline recorded at creation. |
| `transfer_received` | Firm quote for the received amount, sponsor balance check, landing account created and locked for the quoted USDC, on-ramp created with the quote id and the landing address. |
| `onramp_pending` | Waits for the anchor's settlement worker. Paid amount must equal the quote; otherwise `failed` with `amount_mismatch` and the funds parked in the ownerless landing account. |
| `onramp_paid` | Pre-authorized forward submitted through the relay: USDC lands in the smart account. |
| `forwarded` | Pre-authorized cleanup through the relay: trustline dropped, reserves back to the sponsor (a cleanup failure is recorded, never blocks the user). |
| `in_wallet` | Arrival autopilot in the browser: `vault.deposit` signed with the passkey and relayed; the browser reports the hash. |
| `in_vault` | Done. A `deposit_completed` counter event is recorded with the three hashes. |

Anchor or relay outages and an under-funded sponsor are transient: the status stays and the next poll retries (six attempts per step before `failed`). `pnpm demo:deposit` plays the bank for the newest pending deposit so the flow can be rehearsed identically every time; measured in `scripts/e2e-deposit.mjs`, the USDC is in the vault about 60 s after the simulated transfer.

## Withdrawal pipeline (Gate 3)

`lib/withdraw.server.ts` mirrors the deposit pipeline with the reverse landing account:

| Status | What happened / what the next poll does |
| --- | --- |
| `created` | Off-ramp opened at the anchor (treasury address + memo id, rate locked 30 min), sell quote shown. The next poll checks the sponsor and builds the landing account whose pre-authorized payment carries the memo id. Meanwhile the browser already withdraws from the vault (first passkey approval). |
| `awaiting_usdc` | The browser transfers the exact amount from the kumbara to the landing account (second passkey approval; this is the transfer the spending limit applies to) and reports both hashes. |
| `usdc_sent` | Landing balance verified on-chain, pre-authorized classic payment to the treasury with the memo relayed. |
| `paid` | Waits for the anchor to match the memo, convert and pay out (simulated FAST to the customer's IBAN). |
| `completed` | Payout reference and TRY amount recorded, cleanup relayed, `withdrawal_completed` counter event. |

Amounts above the spending limit are refused in the form with a link to the security page, and an on-chain `spending_limit_exceeded` rejection is shown the same way. The vault withdrawal burns just enough shares to pay out at least the requested amount; any excess USDC stays in the kumbara.

## Hardening (Gate 5)

**Every failure has a screen.** `lib/failures.ts` reduces everything that can go wrong to 25 named states and classifies thrown errors (library, WebAuthn), Kumbara API errors (`lib/api.ts`, which also recognises Vercel's login page and an offline browser) and stored pipeline failures onto them. `components/FailureScreen.tsx` renders each state in TR and EN with a plain explanation, one primary action, the bridge account (with explorer link) when funds are visibly parked, the runbook section for presenter states, and the raw detail only behind a "Details" expander. The table is `docs/failure-states.md`; `/failures` previews every screen with sample data.

**Every flow is resumable.** Deposits and withdrawals live in the database and the browser only polls them, so reopening the app after a locked phone or a closed tab shows the same status timeline from stored state with a "resumed" notice. The one client-side step that must not repeat, the passkey-signed vault withdrawal, is reported to the server the moment it confirms (`POST /api/withdraw/:id/vault`) so a resumed session starts at the transfer step. Every status transition is appended to the record's `history` with a timestamp, which is where the public timings come from.

**Round trips in CI.** `.github/workflows/e2e.yml` runs the real-browser flows (Chromium, virtual passkey, live testnet and the sandbox anchor) against a fresh Vercel preview deployment on every push and pull request, and against production every six hours. Every account the runs create carries `ref=e2e`; counter events carry a `source` (`user`, `seed`, `e2e`), backfilled from the ref, and `/api/metrics` and `/stats` count `user` only unless asked for `?include=seed,e2e`. The scheduled run skips itself when the sponsor is below `SPONSOR_MIN_XLM + 5` XLM, and a failure opens a GitHub issue naming the failing step (with the screenshot artifact) and posts to `/api/ci/status`, which `/booth/admin` shows as a red banner until the next green run. Secrets live only in GitHub Actions secrets and Vercel's environment.

**Public stats.** `/stats` is read-only and reads `/api/metrics` (cached 30 s) plus `/api/health`. Headline numbers carry a TESTNET badge, the live USDC-in-vault figure is read from the vault contract on every snapshot, addresses are truncated, there are no per-user timelines, timings show medians and p90 only with at least five samples (otherwise "not enough data"), and the sponsor appears as a fraction of its threshold, never as an address. `?mode=tv` is the projector variant.

## DeFindex strategy on testnet

Goal: deposits should follow DeFindex's real invest path (vault → strategy) instead of sitting idle in a strategy-less vault. Surveyed on 2026-09-05 against the [`defindex`](https://github.com/paltalabs/defindex) repo at commit `e611011` (the 22 Dec 2025 testnet deployment; the deployed testnet vault WASM `f345228d…` was built from it) and its `public/testnet.contracts.json`. Testnet only; the mainnet configuration was not touched.

**What exists on DeFindex testnet**

| Deployment | Asset | Usable for Kumbara? |
| --- | --- | --- |
| `USDC_blend_strategy` `CALLOM5I…FSUY` | Blend's test USDC (`USDC:GATALTGT…`, SAC `CAQCFVLO…RCJU`) | No. Kumbara's USDC is Circle's testnet USDC (issuer `GBBD47IF…FLA5`, SAC `CBIELTK6…DAMA`), the asset the anchor delivers, and a DeFindex strategy is bound to exactly one asset: its `asset()` must equal the vault asset, and the factory checks it at deployment. |
| `XLM_blend_strategy` `CDVLOSPJ…3HPM` | XLM | No, wrong asset. |
| `usdc_paltalabs_vault`, `xlm_paltalabs_vault` | Blend test USDC, XLM | No. These are vaults for the same Blend assets, not strategies. |

**What could be built from the repo (`apps/contracts/strategies/`)**

- `blend`: supplies the asset to a Blend pool. Blend's testnet pools are built on Blend's own test USDC (`blend_pool_usdc` = `CAQCFVLO…RCJU`); none lists Circle's USDC, so a Blend strategy for our asset would need a Blend pool deployed and funded by us, which would be our own yield theatre, not DeFindex's.
- `soroswap`: liquidity-provider strategy that needs the Soroswap router and a liquid pair for the asset. The only Circle-USDC pool on testnet Soroswap is a tiny, imbalanced Circle-USDC/Blend-USDC pair; investing into it would not produce a meaningful position and would expose deposits to that pool's price.
- `xycloans`: flash-loan liquidity provider; it needs a xycloans pool for the asset, and none exists on testnet for Circle's USDC.
- `fixed_apr`: pays a configured APR out of a pre-funded balance. Rejected: that is mock yield, and Kumbara never shows a rate or implies yield that is not real.
- `hodl`: holds the asset, reports `balance`, `harvest` is a no-op. Works for any asset. **Chosen**: a real DeFindex strategy contract on the real invest path that makes no yield claim.

**What was done**

- Built DeFindex's `hodl_strategy` crate unmodified at commit `e611011` (soroban-sdk 22.0.3, target `wasm32v1-none`, `stellar contract build --optimize`) and deployed it for Circle's testnet USDC: strategy [`CDFLOE4HGKNV3JJQGIS3Y7BT2K2DTT4SBF2NKARMBVB4RBJZ5YJLDMQN`](https://stellar.expert/explorer/testnet/contract/CDFLOE4HGKNV3JJQGIS3Y7BT2K2DTT4SBF2NKARMBVB4RBJZ5YJLDMQN) (deploy tx [`449010c8…`](https://stellar.expert/explorer/testnet/tx/449010c8c610b5abd4b1b6a0e3c56ff3303a8d124c416bae6240b1dff02cfd38)); its `asset()` returns `CBIELTK6…DAMA`.
- The vault contract has no `add_strategy`, so the vault was redeployed through the DeFindex factory with the strategy attached from the start: vault [`CAT76PQMLGFABA37ETPJDKTYONMY463Z6SINVUMAM7556YKQRPYMKSKL`](https://stellar.expert/explorer/testnet/contract/CAT76PQMLGFABA37ETPJDKTYONMY463Z6SINVUMAM7556YKQRPYMKSKL) (factory tx [`dbf0d5b7…`](https://stellar.expert/explorer/testnet/tx/dbf0d5b777ef056337dc05348f7bf1d8d11b63f6a3272efaec2c208f6faa8f96), vault fee 0, all roles held by the testnet spike key). The previous vault `CBUEZTX2…5ZNV` (no strategy) stays deployed but is no longer configured anywhere; an intermediate vault `CDVPZHG7…ALDJ` from the first attempt holds 1 USDC of the spike's test funds and is unused.
- Invest-on-deposit is proportional to the vault's *current* allocation (`vault/src/investment.rs`: `generate_investment_allocations` invests only when the asset already has invested funds), so a fresh vault leaves deposits idle until the Manager runs one `rebalance(Invest)`. Done once, tx [`bc5119d5…`](https://stellar.expert/explorer/testnet/tx/bc5119d52b2c994ee9144b0cf9c666c5b87b93ecdaddfb60890d26e41f252aad); the 1 USDC invested there stays in the vault as a seed position owned by the spike's test smart account, so the allocation never returns to zero. The app never needs the Manager afterwards.
- Proof on-chain: a deposit with `invest=true` moved the deposited USDC into the strategy in the same transaction, invest tx [`b615e7dc…`](https://stellar.expert/explorer/testnet/tx/b615e7dc09a46a5f0bad37003e2a2f46f22edc9f9a89064de545931d76b7f981) (vault invested 1 → 2 USDC, strategy balance 2 USDC); withdrawing those shares unwound them from the strategy, divest tx [`466f48d2…`](https://stellar.expert/explorer/testnet/tx/466f48d235ecb2c3e6532e1894a706a0a872c9a0e586990ad7c80db607a9f5ca) (strategy balance back to 1 USDC). `DEFINDEX_STRATEGY_ID=… pnpm spike:defindex` re-runs the proof; findings in `docs/spike-findings/defindex.json`. The production E2Es show the same on Horizon: the deposit round trip's vault tx [`44316ecc…`](https://stellar.expert/explorer/testnet/tx/44316ecc30e1fc70caa11e4d4e3520a937d60c7f085bab60837d0ac022d80823) carries two balance changes, kumbara → vault and vault → strategy, for the same 2.0544777 USDC; the withdrawal's vault tx [`64f0f816…`](https://stellar.expert/explorer/testnet/tx/64f0f816f84f57f15e1d74dd0521f8a5c52cae6d75787f807debf6a3169d3bcc) moves the USDC straight from the strategy to the kumbara.
- App changes: the deposit autopilot calls `deposit(amounts, mins, from, invest=true)`; the withdraw path is unchanged because the vault's `withdraw` pays from idle funds first and unwinds the rest from its strategies. Timings against production after the change: the deposit E2E completed 51.1 s after the bank transfer (57.1 s before the change), with the vault step itself at 12.1 s (12.0 s before); the withdraw E2E completed 48.9 s after confirm (48.9 s before). The strategy hop adds nothing measurable because it is one more cross-contract call inside the same transaction.
- No yield: hodl earns nothing, so the Savings copy stays as it was (the testnet vault earns no yield). A strategy name and a "yield varies" line ship only if a testnet strategy ever produces real yield for this asset.

## Design tradeoffs

**Per-user contract wallets over pooled custody.** A pooled account would make the anchor integration trivial (one G… address) and remove the landing-account machinery. It would also make Kumbara a custodian of user USDC, which is exactly what the regulatory note in the README says it is not. Contract wallets cost one deployment per user (paid by the relay) and the landing-account detour; they keep the user's funds under the user's passkey alone.

**Anchor-hosted rails over an own ramp.** Building a TRY ramp means banking, KYC and licensing. The anchor is the licensed party; Kumbara only drives its API and shows the IBAN pattern Turkish users already know. The price is dependence on the anchor's constraints (classic-only delivery, memo-based attribution), absorbed by the landing accounts.

**Prepaid fee budgets over metered billing.** Users never see XLM, so someone pays. A project-scoped relay budget (Sembol Cloud) keeps that predictable and keeps the relay key off the client. The relay validates what it will pay for; a compromised page cannot drain more than the budget.

**Vault choice delegated to DeFindex.** Kumbara picks a vault id from configuration and calls the vault's public `deposit`/`withdraw`/`balance`; strategy selection, rebalancing and fees are DeFindex's. The Savings screen states that yield is possible, never a rate, and says plainly that no yield accrues on the testnet vault.

**Spending limit as a per-transaction cap.** The OpenZeppelin spending-limit policy caps the USDC moved within a rolling window and has no destination allowlist, so the vault and the landing accounts cannot be exempted. Kumbara installs it on a USDC-scoped rule with a one-ledger window, which acts as a 1,000 USDC per-transaction cap. It applies to vault deposits too (verified on testnet: the policy's spent counter rose for a vault deposit). Users can raise or lower it on the security page.

### The driver

A record only moves when something calls its poll route. Until September 2026 that was the user's open page; at the booth the visitor closes the tab after the IBAN step, so two drivers call `POST /api/pipeline/tick` (presenter token): the console at `/booth/admin` every 5 s while it is open, and a GitHub Actions cron every 5 minutes as the backstop. A tick lists every deposit in `awaiting_transfer`, `transfer_received`, `onramp_pending`, `onramp_paid` or `forwarded` and every withdrawal in `created`, `usdc_sent` or `paid`, and advances each through the same `advanceDeposit` / `advanceWithdrawal` a poll would use, as far as it can within a 40 s budget (a paid deposit goes forward → cleanup → `in_wallet` in one tick). `in_wallet` and `awaiting_usdc` need the user's passkey and are left alone; the user's screen says which steps are ours ("Kapatabilirsin, biz devam ediyoruz") and which are theirs, and on return shows "USDC geldi — kumbarana koymak için dokun". Ticks are serialised by a global lease and respect the per-record leases, attempt counters and the 10 s backoff after a failed step, so they are idempotent and safe to overlap with a user's own polls.

## Threat model

### What the relay can and cannot do

The relay only sees signed authorization entries (or, for landing accounts, fully signed pre-authorized envelopes). It supplies a channel account as transaction source and pays the fee. It **cannot** forge a user signature, change what a signed entry authorizes, or move USDC: a smart account's `require_auth` binds the passkey signature to the exact invocation and to the context rules it was signed under. What it **can** do: refuse service (denial of service, mitigated by failing loudly and by the pre-authorized transactions having no expiry, so they can be resubmitted later), spend its own XLM on fees, and see metadata (which contract was called, when). The project key lives only in the server route; the browser talks to `/api/relay` on the same origin.

### What a compromised anchor could do

The anchor holds TRY balances and the USDC treasury; if it were compromised it could refuse or delay payouts, pay wrong amounts, or misprice quotes. It cannot touch USDC already in a smart account or the vault, and it cannot spend from a landing account (whose only transactions are pre-authorized). Kumbara guards against wrong amounts by creating on-ramps with a locked quote and refusing to forward if the paid amount differs from the quote, and it shows every anchor status, including failed and refunded.

### Landing accounts

A landing account is a classic Stellar account created by Kumbara's sponsor key for exactly one deposit or withdrawal:

- **Who can move the funds: nobody.** After setup the account has three signers: its master key with weight 1 and two pre-authorized transaction hashes with weight 1 each, and all thresholds are 2. A pre-authorized signer alone or the master key alone reaches weight 1; only the exact pre-agreed envelope (pre-authorized hash plus the master co-signature attached at setup) reaches 2. Even if the master key leaked, it could not authorize any transaction that was not already pre-authorized, and thresholds cannot be changed (that needs weight 2). The forward transaction sends the exact quoted USDC amount to the user's smart account (deposit) or to the anchor's treasury with the anchor's memo (withdrawal); the cleanup transaction drops the trustline and merges the account into the sponsor. Neither has a time bound, so a relay outage delays them but cannot invalidate them.
- **The master secret is discarded in-process.** `lib/landing/landing.ts` generates the landing keypair inside `createLandingAccount` and uses it to sign exactly four envelopes: the sponsor's creation transaction and the sponsor's lock transaction (in both, the landing account is the source of its own operations, so its signature is required alongside the sponsor's), and the two pre-authorized envelopes, forward and cleanup (these two signatures are the co-signatures that later count as weight 1 next to the pre-authorized hash). It then zeroes the keypair's seed buffers in place (`wipeKeypair`) and drops the reference before the function returns; a `finally` block wipes it on every error path too. `lib/landing/landing.test.ts` checks that the landing key's signature appears on exactly those four envelopes and nowhere else. The returned plan carries only the public key, transaction hashes and the two signed envelopes. The secret is never logged (the logger receives public data only), never written to the deposit store, and never part of a counter event: `assertNoSecret` scans every plan before it is returned, every record before it is persisted and every event before it is recorded, and refuses if a secret seed appears. `lib/landing/landing.test.ts` asserts all of this against a fake network, including that the keypair object is garbage-collected after the call (`pnpm test` runs with `--expose-gc`).
- **Amount mismatch.** The forward amount is fixed from the anchor's quote. If the anchor paid a different amount the forward would fail (`insufficient balance`) or leave dust, so Kumbara checks the anchor's `amount_usdc` against the quote before submitting and, on mismatch, stops and surfaces the order id; the USDC stays in the landing account, which nobody can drain, until the anchor corrects the payment. On testnet the paid amount equaled the quote in every one of the recorded runs (see `anchor-notes.md`).
- **Reserve recovery.** The sponsor creates the account with zero XLM and sponsored reserves (base reserve, trustline, two signers: 2.5 XLM on the current base reserve). The cleanup merge releases every sponsored entry, so the sponsor's net cost per deposit is the fee of its two setup transactions (900 stroops); the relay pays the two pre-authorized transactions (about 15,000 stroops for the Soroban forward after refunds, 300 for the cleanup). Measured over ten deposits and one withdrawal in `anchor-notes.md`.
- **`SPONSOR_SECRET` is a reserves-only account with a bounded balance.** The sponsor key exists to lock 2.5 XLM of reserves per in-flight landing account and pay two setup fees; it never holds USDC, is never a signer on any kumbara, and is never a transaction source for user funds. Its balance is deliberately small: enough for the expected number of concurrent deposits (about 3 XLM each while in flight, all returned at cleanup) plus fees. The server refuses to create landing accounts when the sponsor holds less than 3 XLM and logs a warning when it holds more than 100 XLM, so a leak of the key costs at most the parked balance and can never reach user funds. On mainnet the key lives only in the deployment's secret store, and rotating it is a config change: new landing accounts use the new key, cleanup transactions still merge into whichever sponsor created them.
- **Replay.** Each pre-authorized transaction is bound to the landing account's next sequence numbers and is removed as a signer once applied; it cannot run twice.

### Replay and limit enforcement on the smart account

Every passkey signature covers a nonce and an expiration ledger inside the authorization entry, so an entry cannot be replayed. The spending-limit policy is evaluated on-chain for every USDC `transfer` the account authorizes, including the vault's inner transfer during `deposit`; the auth digest binds the context rule ids, so a signature cannot be re-targeted at a rule without the policy. Limits are per account and per rule; the relay cannot bypass them because it never signs for the account.

## Production gap (from the anchor's own "Mainnet: what to expect")

The list below is the anchor's "What will likely change" section, reproduced verbatim so the seams are visible in this codebase.

1 · Authentication: from a static key to OAuth2. The sandbox's X-API-Key is the training-wheels version. Production Turkish partner APIs typically use OAuth2 client-credentials: you hold a client_id + client_secret, exchange them at a token endpoint for a short-lived JWT plus a refresh token, and send the JWT as Authorization: Bearer. Expect: Granular scopes — read scopes separated from create/confirm scopes; request only what you need. An IP allowlist — your calls must originate from a static egress IP you register with the anchor. Home connections and default cloud egress IPs don't qualify. Token expiry mid-flow — refresh handling is your problem, not an edge case.

2 · The ramp may decompose into deposit + swap + withdrawal. This sandbox gives you an atomic POST /v1/onramps. A production anchor is often an exchange underneath, and its API shows it: the TRY you deposit becomes a TL-stablecoin balance, conversion is an explicit swap (quote → confirm, with a TTL and a commission in the from-asset — that's what this sandbox's flat spread stands in for), and the on-chain leg is a separate crypto withdrawal. Budget for composing two to four calls, each with its own status machine, where the sandbox has one.

3 · Compliance fields become real. Travel rule: originator information on crypto deposits (name, address ownership, VASP fields). Purpose & source of funds on stablecoin withdrawals, plus free-text descriptions with length rules. Pre-registration: withdrawal addresses and bank accounts often must be saved (and verified) before the API will use them — "send to any address" is a sandbox luxury. 2FA / verification codes on sensitive writes; KYC tiers that set your limits; compliance rejections as first-class API errors.

4 · Fiat deposits may be observe-only. There is often no API call to initiate a TRY deposit: the customer pays through the bank rail and your integration observes the deposit appearing in a fiat-transactions list. The sandbox's simulate-endpoint disappears; the watching, matching and unmatched-handling remain.

5 · Notifications may be a websocket. Some anchors stream quotes and status changes over Socket.IO-style websockets (authenticated with the same bearer token) instead of — or in addition to — webhooks. Keep your status handling transport-agnostic; polling the transaction endpoints always works and doubles as your reconciliation.

6 · Money details. Mainnet USDC issuer is GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN — trustlines, treasury addresses and explorers all change; never hardcode the testnet issuer. Live pricing: quotes come from a real book, expire faster, and move with liquidity; commissions may be tiered by volume. Fees appear as line items: network withdrawal fees, swap commission, sometimes fixed payout fees — not one blended spread. Limits: per-transaction and per-tier minimums/maximums on every leg.

7 · Operations. Rate limits (HTTP 429) with backoff; idempotency discipline on writes. Separate sandbox and production environments with separate credentials — never assume one implies the other. Real incident behaviour: maintenance windows (503), partial outages, delayed settlements. Your state machine, not your happy path, is the product.

Where those seams live in Kumbara: anchor auth in one module (`lib/anchor.server.ts`), conversion behind quote/execute functions, the ramp modeled as a pipeline with per-leg status, the asset issuer and endpoints discovered from the toml, and pre-registered withdrawal addresses handled by the landing-account design (the anchor only ever sees classic addresses that Kumbara registers per transaction).

## SEP-6 path (default since 8 September 2026)

The anchor is configured by home domain and everything else is read from its `stellar.toml`. Per deposit: the sponsor creates the bridge account with the USDC trustline; inside the bridge module's `beforeLock` hook the account authenticates with SEP-10 (its master key is still held), registers with SEP-12, takes a firm SEP-38 quote for the exact fiat amount and opens SEP-6 `deposit-exchange` with `account` = bridge; the pre-authorized forward is built for the quoted USDC, an abort envelope at the same sequence returns the reserves if no lira arrives, then the lock and the wipe. The pipeline polls `GET /transaction` with the bridge's token; `completed` with the exact `amount_out` releases the forward. Withdrawals mirror this with `withdraw-exchange`, whose `account_id` and id memo the pre-authorized payment carries. `pending_trust` cannot occur because the trustline precedes the request; if an anchor reports it anyway, the deposit fails into its own screen.
