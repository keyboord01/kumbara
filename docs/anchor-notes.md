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
