# Anchor notes (Gate 0 spike)

Recorded 2026-09-04/05 against `https://tr-mock-anchor.fly.dev` (OpenAPI 1.0.0) on Stellar **TESTNET** (RPC reported protocol 28). Every hash below resolves on `https://stellar.expert/explorer/testnet/`. Raw outputs: [`spike-findings/`](spike-findings/). Script: [`spikes/anchor.ts`](../spikes/anchor.ts).

## Discovery (read from the anchor, never hardcoded)

| Item | Value |
| --- | --- |
| USDC issuer (`stellar.toml` and `/health` agree) | `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` (Circle testnet) |
| USDC Stellar Asset Contract (derived from the issuer) | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |
| Treasury (pays on-ramps, receives off-ramps) | `GCLCZEQZ2THTEDAOFI66LACNPLY4OBKN7VKLEZFMBIHYKYQOW2W7T3Z6` |
| SEP endpoints | `/auth` (SEP-10), `/sep6`, `/sep12`, `/sep38`; signing key `GDXYO6FJCNXZEWGXD54GT76FGFYLOLSOGSOJLNQ6WGHCGEQPO7NTE73M` |
| Rate at run time | mid 48.430010, buy 48.672160, sell 48.187859 TRY per USDC (50 bps each side, source: Reflector) |
| Deposit instructions pattern | bank `TR Mock Bank A.Ş.`, IBAN `TR05 0009 9000 0000 0000 0000 01`, alıcı `TR Mock Anchor Teknoloji A.Ş.`, açıklama = customer reference (`TRMA-XXXX-XXXX`), rails FAST/EFT/Havale |

## 1. Does `POST /v1/onramps` accept a contract (C…) destination?

**No.** With a valid quote and a deployed OpenZeppelin smart account as `destination_address` the anchor answers:

```
HTTP 400
{"error":{"code":"invalid_destination_address","message":"destination_address must be a Stellar account (G...) or muxed (M...) address. Contract addresses (C...) are not supported: USDC is a classic asset paid via a classic payment, which cannot target a contract."}}
```

The rejection is explicit and by design, not a validation accident. The SEP-6 door has the same limit one layer earlier: SEP-10 only authenticates G accounts (the anchor does not offer SEP-45), so a C… wallet cannot open a SEP-6 deposit either.

## 2. How does USDC arrive for a classic (G…) destination?

Tested with a funded classic account that has a USDC trustline:

| Step | Result |
| --- | --- |
| Quote `qt_pnvgvd1aesysy95ufkrv` | 100.00 TRY → 2.0545626 USDC @ 48.672160 |
| On-ramp `onr_xqiqg1yi9xcr9vaq2r1w` | `completed` in ~8 s, `settlement: "payment"` |
| Settlement transaction | `6cefb9639af80d95b3c491b120b048c528192715ac5129790beeffa82c208919`: one classic `payment` op from the treasury, fee 100 stroops |
| Amount received | exactly the quoted 2.0545626 USDC |

If the destination has no trustline (or does not exist) the anchor creates a claimable balance instead; claimable balances can only be claimed by classic accounts, so that path does not help a contract wallet either.

## 3. Does a contract's USDC balance show the funds?

Yes, once the USDC is moved by a Stellar Asset Contract `transfer`. A SAC transfer from the classic account into the smart account (`870ac1b768eb0ebffa4e05e6ce6a800762e41d7220f806fc9dc9f31efb00dff7`) took the smart account's SAC `balance(C…)` from 0 to 2.0545626 USDC. Contract balances live in the SAC's contract data, not in a trustline, and they are what DeFindex's `deposit` pulls from. So the only missing piece is the hop from a classic account into the contract.

## 4. Workaround tested: a trustless landing account

Because the anchor can only pay classic accounts, the on-ramp has to land on one. Kumbara must not hold that account's key, so the spike makes the landing account **ownerless**: after setup its master key has weight 0 and its only signers are two pre-authorized transactions whose contents (and therefore hashes) are fixed before the anchor pays:

1. **forward**: SAC `transfer(landing → user's smart account, exact quoted amount)` (source-account auth, Soroban footprint computed from a zero-amount simulation and padded).
2. **cleanup**: drop the USDC trustline and `accountMerge` the XLM reserve back to the sponsor.

Nobody can produce any other transaction for that account, so the USDC can only ever go to the user's kumbara. Full run on testnet (landing account `GCFBKAX7ACAPHABCLMVTIV6SXRGTBMDOF5S62GE6OCTCLWUGSFESAU2C`, 100.00 TRY → 2.0545626 USDC, quote `qt_povytg0zknmgogap1gyk`):

| Step | Transaction |
| --- | --- |
| trustline | `4041627d1505b905d6e064ef20f72c235c9a8a8744d3cb96128b768662c5469a` |
| lock (two pre-authorized signers, master weight 0, thresholds 1/1/1) | `40a1a4250feab7e32eafbfa4765538028f5284e57365811af6937f06cc7ddafd` |
| anchor pays the landing account (classic `payment`) | `778215b3a70debb505ad6f9a05946914ae000de4ef2165e1c9ee8e91e3c3a8f1` |
| pre-authorized forward, USDC lands in the smart account | `f580e030d4d8e15fe4aca47d07ee131152ae91417ea983459afdbe3ff22c9eab` |
| pre-authorized cleanup (trustline removed, account merged) | `6223c61c20cd3dc115f67ef5170112cab64e61ac86686545eb18c7927416291d` |

Smart account USDC balance after: 4.1091252 (2.0545626 from step 3 + 2.0545626 from this run).

What it costs and what to watch:

- Three extra classic transactions per deposit plus one Soroban transaction; ~25 s of setup before the on-ramp can be created. The 120 s quote window was comfortably enough.
- The forward amount is fixed from the quote, so the on-ramp must be created with that `quote_id`. The anchor paid exactly the quoted amount both times; if it ever paid less, the forward would fail and the dust would stay in a locked account (recoverable only by the anchor re-sending; worth a guard in the UI).
- Reserves: on testnet friendbot funds the landing account; on mainnet the sponsor (relay operator) creates it with sponsored reserves (~2 XLM base + trustline + two signers) and gets them back at cleanup.
- The landing account key exists only in process memory during setup and is never persisted. Kumbara's server still constructs the transactions, so "non-custodial" here means "cannot redirect", which is the property that matters.

## 5. Off-ramp: what the memo requirement means for a contract-initiated transfer

The off-ramp returns the treasury address plus a `memo_type: "id"` memo (12 digits) and says a muxed address with that id also works. A smart account cannot set a transaction memo through the relay (it only submits `{ func, auth }`; the relay builds the envelope), so the spike encoded the memo as a **muxed destination** in a SAC `transfer(from: C…, to: M…, amount)`, signed with the passkey and fee-bumped by the relay:

- On-chain it worked: `b320a1f02e36218d3f546a04795f9842b0f6741c0eafecb8a5b7cce50642498c` moved 1 USDC to the treasury. Horizon lists it under the treasury's `/payments` as an `invoke_host_function` operation whose `asset_balance_changes` carry `type: "transfer"`, `from: C…`, `to: GCLCZ…`, `amount: "1.0000000"`, `destination_muxed_id: "415114909797"`.
- The anchor did **not** see it. Off-ramp `ofr_ikwwjdt1dw6zfin2q10s` stayed `awaiting_deposit` (checked for 2 minutes and again later), and the transfer is absent from `/v1/sandbox/unmatched-deposits`, i.e. the watcher only handles classic `payment` operations and silently skips Soroban transfers.

So for withdrawals the same gap exists in reverse. Options:

1. **Anchor change (smallest):** the watcher also consumes `invoke_host_function` payments and reads `asset_balance_changes[].destination_muxed_id` (or the transaction memo) — the data is already in the Horizon stream it polls.
2. **Reverse landing account (same primitive as §4):** the smart account SAC-transfers to an ownerless landing account whose pre-authorized transactions are (a) a classic `payment` to the treasury with the memo id and (b) cleanup/merge. Fully non-custodial, all machinery already exists in `spikes/lib/forwarder.ts`.
3. Skip the anchor's memo routing entirely: not possible, the memo is how the anchor attributes deposits.

Note: the "cannot set a memo through the relay" limitation is what makes the muxed address the right encoding; it is also why option 2 uses a classic payment.

## Other findings from the Gate 0 spikes

**Relay (`spikes/relay.ts`).** Sembol Cloud (project keys, per-project budgets, allowlists) is not deployed anywhere reachable and `.env` had no Sembol variables. The spikes therefore point `SEMBOL_CLOUD_URL` at the hosted OpenZeppelin Relayer Channels testnet service with a self-serve key, speaking the same `{ func, auth }` protocol the kit and the reference relayer-proxy use. Through it: smart account `CB5TQJAGOSCO5W6DOJRO65DKVX7ULEVRIEN52KOLGBIJNIC263JYVAPX` was deployed (`79b04c55a15832cea4cfb216d17f24edfdd3d179ff87a98c703509827b8c2ee4`, fee-bump envelope, fee source = channel account `GCNJB6V5…35CN`, the smart account holds 0 XLM) and a token-scoped spending-limit rule (100 USDC per 17,280 ledgers, rule id 1) was installed (`3372c798e3c2ef325d624d4abc252eba5a6fed864ebb8c73682747451d434ccf`). A wrong key fails with `Unauthorized`, an unreachable relay fails with `relay unreachable`, and a kit without a relay refuses before the passkey ceremony. There is no XLM fallback anywhere. Per-project budget/allowlist behaviour cannot be verified until Sembol Cloud exists.

**Passkeys in Node.** The spikes drive the real OpenZeppelin WebAuthn verifier with a software P-256 authenticator (`spikes/lib/passkey.ts`) plugged into smart-account-kit's `webAuthn` option; every smart-account transaction above was signed that way and verified on-chain. This is what `pnpm demo:*` scripts and Playwright will reuse.

**DeFindex (`spikes/defindex.ts`).** The public DeFindex testnet USDC vault (`CBMVK2JK…DWHN`) accepts `USDC:GATALTGT…` (Blend's test USDC), not Circle's testnet USDC, and its Blend strategy is bound to that asset. A vault for the anchor's USDC was deployed through the DeFindex factory `CDSCWE4GLNBYYTES2OCYDFQA2LLY4RBIAX6ZI32VSUXD7GO6HRPO4A32`: **`CBUEZTX2U7GBOOAWIFQW2QOYW6DVQJNCMSLR2I6JCD3RJQLW67VJ5ZNV`** ("DeFindex-Vault-Kumbara USDC", `KMBRUSDC`, tx `6574f636dcd64a8fb63f8bacae5c96898ebd915e8cb092eb5eec447e2bea2246`), with no strategies because no testnet strategy exists for Circle's testnet USDC (funds sit idle in the vault; on mainnet the app points at DeFindex's own USDC vault with Blend strategies). From the smart account, passkey-signed and relay-submitted: deposit 1 USDC → 0.9999 shares (`7c5ffaa587b61c7972c5d91baa08f9a1f22c5523c43885e9f37e9b103f6d5f2a`; 0.0001 USDC is the vault's one-time minimum-liquidity lock), withdraw all → 0.9999 USDC back (`a3ba2cc5d8ee850a03cf80e0601fa66004959c74fe09363480d6c1bdcc116fbd`). The DeFindex REST API/SDK needs an API key we do not have and builds classic-source XDR, so the app talks to the vault contract directly (same functions the SDK wraps).

**Spending limit vs. vault deposits.** After the 1 USDC off-ramp transfer and the 1 USDC vault deposit, the policy's `cached_total_spent` read 2.0000000: the token-scoped rule counts vault deposits too (the vault's inner `USDC.transfer` from the wallet is enforced). Kumbara's default limit must therefore be sized for deposits as well as withdrawals, or deposits above it will fail in the arrival autopilot.

**Soroswap (`spikes/soroswap.ts`).** Not required: the vault accepts the anchor's USDC as-is, `SOROSWAP_ENABLED=false`. The router `CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD` can be quoted on-chain (`router_get_amounts_out`) without an API key if it is ever needed.

## What needs a decision before Gate 1

1. **On-ramp to a contract wallet**: ask the anchor team to deliver to C… destinations with a SAC transfer from the treasury (their treasury already submits through RPC), or ship the trustless landing account from §4. Both keep Kumbara non-custodial; the landing account adds three classic transactions and ~25 s per deposit.
2. **Off-ramp detection**: ask the anchor team to match `invoke_host_function` payments (§5 option 1), or ship the reverse landing account (§5 option 2).
3. **Relay**: confirm whether Sembol Cloud will exist before the hackathon. Until then Kumbara's server-side relay route forwards to the configured `SEMBOL_CLOUD_URL` with the project key, which today is an OpenZeppelin Channels key.


## 6. Landing accounts, final shape: ten deposits and one withdrawal through the relay

Recorded 2026-09-04 with [`spikes/landing.ts`](../spikes/landing.ts) (raw: [`spike-findings/landing.json`](spike-findings/landing.json)). Shape as decided at the Gate 0 review: quote → exact `destination_amount` → sponsor creates the landing account with sponsored reserves and a USDC trustline (zero XLM on the account) → two pre-authorized transactions built for the exact amount, forward at seq+1 and cleanup-merge-to-sponsor at seq+2 → lock (pre-authorized signers weight 1 each, master weight 1, thresholds 2/2/2, master co-signature attached to both envelopes) → on-ramp created with the quote id and the landing address → forward and cleanup submitted through the relay, which fee-bumps them.

Two relay facts shaped the envelopes: OpenZeppelin Channels treats an envelope with zero signatures as a func/auth request and rebuilds it under its own channel account (which breaks source-account authorization), so the pre-authorized envelopes carry the landing master key's co-signature and that signature has to be *needed* (Stellar rejects unused signatures with `txBAD_AUTH_EXTRA`, hence weights 1+1 against threshold 2). The relay also rejects far-future time bounds and Soroban envelopes whose fee exceeds the declared resource fee by more than one base fee, so the pre-authorized transactions carry no time bound and a 100-stroop inclusion fee.

| run | quoted USDC | paid USDC | match | forward | cleanup | sponsor Δ XLM | relay fees XLM | seconds |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 2.0541582 | 2.0541582 | yes | `40570e7c…` (relay) | `a674c2ae…` (relay) | -0.0000900 | 0.0015158 | 43.9 |
| 2 | 2.0541582 | 2.0541582 | yes | `3895d8c2…` (relay) | `c7359da0…` (relay) | -0.0000900 | 0.0015158 | 49.6 |
| 3 | 2.0541582 | 2.0541582 | yes | `d85e799b…` (relay) | `4d4d176f…` (relay) | -0.0000900 | 0.0015158 | 45.3 |
| 4 | 2.0541582 | 2.0541582 | yes | `0b963ce1…` (relay) | `99238547…` (relay) | -0.0000900 | 0.0015158 | 46.9 |
| 5 | 2.0541582 | 2.0541582 | yes | `3ca73848…` (relay) | `1389cb7c…` (relay) | -0.0000900 | 0.0015158 | 42.3 |
| 6 | 2.0541582 | 2.0541582 | yes | `7c9941ea…` (relay) | `47cffe61…` (relay) | -0.0000900 | 0.0015158 | 42.2 |
| 7 | 2.0541582 | 2.0541582 | yes | `7d0b000d…` (relay) | `4edeecc1…` (relay) | -0.0000900 | 0.0015158 | 50.9 |
| 8 | 2.0541582 | 2.0541582 | yes | `31c107d1…` (relay) | `2fae9e59…` (relay) | -0.0000900 | 0.0015158 | 43.3 |
| 9 | 2.0541582 | 2.0541582 | yes | `6e758004…` (relay) | `98622214…` (relay) | -0.0000900 | 0.0015158 | 45.5 |
| 10 | 2.0541582 | 2.0541582 | yes | `247d6eca…` (relay) | `1feecd26…` (relay) | -0.0000900 | 0.0015158 | 40.7 |

- **Amount match: 10/10.** With a locked quote the anchor paid exactly the quoted amount every time.
- **Net XLM cost per deposit**: sponsor -0.0000900 XLM (the two setup transactions, 900 stroops; all sponsored reserves came back at the merge) plus 0.0015158 XLM paid by the relay (Soroban forward 14858 stroops after refunds, classic cleanup 300). Total ≈ 0.0016 XLM per deposit.
- **Time**: 40.7–50.9 s per deposit end to end (about 25 s of that is the two sponsor transactions plus the anchor's settlement worker).

**Reverse landing account (withdrawal)**: off-ramp `ofr_ai5okm1w4nvuv09q89th` → landing `GDOD4WQL…` (create `e3e7ef89…`, lock `7d51460f…`) → the smart account paid 2 USDC to it with the passkey via the relay (`c9174308…`) → the pre-authorized classic payment to the treasury with memo id, fee-bumped by the relay (`cee3f93f…`) → the anchor matched it and completed the off-ramp: received 2.0000000 USDC → 96.39 TRY, payout `po_gktucan14xmwxwdi824y` → cleanup via relay (`a3bb546c…`), sponsor Δ -0.0000900 XLM. This closes the off-ramp detection gap from §5 without any anchor change.

### Envelopes co-signed by the landing key

For the record, and matching the threat model in `architecture.md`, the landing master key produces exactly four signatures, all inside `createLandingAccount` in `lib/landing/landing.ts`, before the key is zeroed in place and dropped:

| # | Envelope | Source | Why the landing key signs |
| --- | --- | --- | --- |
| 1 | creation (sponsored `createAccount` + `changeTrust`) | sponsor | the trustline and the `endSponsoringFutureReserves` operations have the landing account as their source |
| 2 | forward (pre-authorized, seq+1) | landing | co-signature that counts as weight 1 next to the pre-authorized hash when the relay fee-bumps it |
| 3 | cleanup (pre-authorized, seq+2) | landing | same, for the trustline removal and merge |
| 4 | lock (`setOptions` ×3 under sponsorship) | sponsor | the signer and threshold changes have the landing account as their source |

Nothing else is ever signed with it, and the unit test asserts that the key's signature hint appears on exactly these four envelopes.

## 7. SEP-6 as the primary path (spike of 8 September 2026)

The organizer's message: the Partner API is unreliable and will likely be removed. The spike (`spikes/sep6.ts`, raw findings in [`spike-findings/sep6.json`](spike-findings/sep6.json)) checked the one ordering question the bridge account raises: SEP-10 needs the account's master key, and after the lock (master weight 1 against thresholds 2) that key authorizes nothing. So the anchor conversation has to sit between creation and lock.

Sequence, as run against the TR Mock Anchor with a throwaway bridge (friendbot standing in for the sponsor):

| step | result | time |
| --- | --- | --- |
| create + USDC trustline | account exists with the trustline before any anchor call | (sponsor tx) |
| SEP-10 as the bridge, master key still held | token issued; lifetime 86,400 s | 578 ms |
| SEP-12 `PUT /customer` (all fields optional on the sandbox) | `ACCEPTED` | 224 ms |
| SEP-38 firm quote, sell 100 TRY | `2.0533494` USDC at 48.458623 | 141 ms |
| SEP-6 `deposit-exchange` with the quote, `account` = bridge | id, bank name, IBAN, reference, `more_info_url` | 133 ms |
| lock (sponsor-sourced, bridge-sourced ops; the bridge's sequence untouched) | pre-authorized forward at seq+1, cleanup at seq+2 | 3.1 s |
| SEP-10 again, after the lock | refused: "signers with weight 1 do not meet threshold 2" | |
| sandbox: `POST /sep6/tx/{id}/simulate-bank-transfer` with the bridge token | `pending_anchor` → `completed` | 4.6 s |
| anchor payment | classic `payment` from the treasury, **2.0533494 USDC, exact match**; never `pending_trust`, no claimable balance | |
| pre-authorized forward, then cleanup | both accepted | 5.0 s, 5.7 s |

Withdrawal mirror with a reverse bridge: SEP-10, SEP-12, SEP-38 quote (sell 1 USDC → 48.21 TRY), SEP-6 `withdraw-exchange` (`dest` = the sandbox IBAN) returned the treasury `account_id` and an id memo; the pre-authorized payment carried the memo, the anchor completed in 5.2 s with a `FAST-…` payout id, and the cleanup merged the bridge. Partner API on the same day, for comparison: on-ramp created → completed in 11.0 s (bank credited first).

**testanchor.stellar.org** (SEP-1/10/12/38/6 all present): USDC deposits take `SEPA`/`SWIFT`, 1–10 USDC; SEP-12 demands `address`, `birth_date` and id fields before the deposit leaves `pending_customer_info_update`; the instructions are a US routing and account number, and there is no sandbox hook to simulate the wire. It therefore validates the request path (discovery, auth, KYC, quote, instructions) but cannot settle.

What this changed in the app (`ANCHOR_MODE=sep6`, the default): the bridge is created at request time, authenticates and quotes inside `createLandingAccount`'s `beforeLock` hook, and the SEP-6 request names it as `account`; the lock now also pre-authorizes an **abort** envelope at seq+1 (drop the trustline, merge into the sponsor) so a deposit cancelled before any lira moves returns the sponsor's reserves. Anchors are configured by home domain (`ANCHOR_HOME_DOMAINS`), everything else is read from each `stellar.toml`, and the presenter switches the active anchor from `/booth/admin`. (The Partner API mode that shipped alongside was removed the next day; see §8.)

## 8. SEP-only anchor (8 Sep 2026): the Partner API is gone

The organizer's update: the mock anchor is SEP-only (SEP-1/10/6/12/38, no SEP-24), the API key, signup and dashboard are removed, identity is the wallet key via SEP-10, and a deposit is capped at 3,000 TRY. Read from the anchor itself (`/sep`, `/explorer`, the reference wallet at kaankacar.github.io/tr-mock-wallet, `/sep6/info`, `/health`):

| Question | Answer |
| --- | --- |
| Play the bank | `POST {TRANSFER_SERVER}/tx/{id}/simulate-bank-transfer` with `{"amount": "200.00"}`, **no authentication** (the reference wallet and the explorer send only a content type). Returns the transaction, now `pending_anchor`; the anchor pays real testnet USDC and walks to `completed`. A bogus id is a 404. |
| Limits as enforced | `deposit-exchange` refuses 40 TRY with `amount below minimum (50.00 TRY)` and 3,001 TRY with `amount above maximum (3000 TRY)`; 2,999 TRY is accepted. The limits are in lira. |
| Limits as published | SEP-6 `/info` states `min_amount 0.5`, `max_amount 300` in USDC for every endpoint (300 USDC is about 14,500 TRY, so the lira cap always binds first); the anchor's status page `/health` states `limits.min_onramp_try 50.00`, `max_onramp_try 3000`, `min_offramp_usdc 1.0000000`, plus the treasury address and balance. |
| SEP-38 | `sell_asset=iso4217:TRY` → USDC: `price` is the mid rate (48.46 TRY per USDC), `total_price` includes the 50 bps spread. |
| Withdrawals | `withdraw-exchange` still returns the treasury `account_id` and a 12-digit id memo; a 400 USDC request was accepted (the USDC cap in `/info` is not enforced there), `min_amount: 1`. |

What changed in the app:

- **No Partner API anywhere.** `ANCHOR_BASE_URL`, `ANCHOR_API_KEY` and `ANCHOR_MODE` are gone from the code, the env files, Vercel and CI; the `/v1` client, the customer table and the spikes that needed on-ramps through it were deleted. The only anchor configuration is `ANCHOR_HOME_DOMAINS` and `ANCHOR_ASSET_CODE`; a record that predates the SEP-6 path fails with `anchor_path_gone` instead of calling an endpoint that no longer exists.
- **Play the bank** (`/booth/admin` and `pnpm demo:deposit`) calls the transaction's `simulate-bank-transfer` hook with the deposit's amount and no bearer, exactly like the reference wallet. Verified: a 100 TRY deposit created through the API in 8 s reached `onramp_paid` 7 s after the button.
- **Limits follow the anchor.** Discovery keeps the SEP-6 asset limits and, when the anchor has a status page that also lists its SEP endpoints, its lira limits. The deposit form shows and enforces those (50–3,000 TRY on the mock; other anchors get their USDC limits converted at today's rate), the server checks the fiat limits before touching the anchor and the quote against the asset limits, and the anchor's own refusal text is shown verbatim as `amount_out_of_range`. Nothing is hardcoded.
- **Withdrawal rate.** SEP-38 states a sell price in USDC per lira; the app inverts it once, at the source, so both the indicative price and the firm quote read in lira per USDC (48.2, not 0.02). The withdraw E2E now asserts the displayed rate is above 1 and accepts any non-empty payout id (the mock's `FAST-…`).
- **testanchor.stellar.org** (timeboxed): its reference server answers per-transaction KYC only if the base customer is registered first and the full field set arrives in **one** `PUT /customer` carrying `transaction_id` right after the `deposit-exchange`; answering the fixture before the request parks the transaction in `pending_customer_info_update` for good. With that order a fresh account goes `pending_customer_info_update` → `pending_user_transfer_start` with SEPA/SWIFT instructions (+2 s) → `pending_anchor` "Funds received from user" (+5 s): the reference anchor simulates the wire itself, so a full round trip is possible without a sandbox hook. It stays a second config that must at least reach the instructions step; the mock is the deliverable.
