# Kumbara

**Kumbara** is a self-custodial USDC piggy bank on Stellar for Turkish users, by [Sembol](https://github.com/keyboord01/sembol). Open it with Face ID, load Turkish lira through a regulated anchor, hold USDC in a DeFindex vault, withdraw back to lira. No seed phrase, no XLM, no app store. Testnet today.

Scale Track entry for the Rise In × Stellar Pro Hackathon (Istanbul, 19–20 September 2026) and the traction exhibit for a Stellar Community Fund Build Award (Integration Track) submission.

## What Kumbara is

A Next.js web app. A user opens it on their phone, taps Face ID, and gets an OpenZeppelin smart account on Stellar with the passkey as its only signer. They deposit lira through a SEP-compliant anchor, receive USDC in that account, the USDC goes into a DeFindex vault, and they can withdraw back to lira through the same anchor. Fees are sponsored by Sembol Cloud, so the user never sees XLM.

Kumbara is non-custodial software. It never holds fiat, never holds keys, never takes custody of USDC. The anchor is the regulated party. Deposit, hold, withdraw; no payments, no sending to friends.

## Problem

Saving in dollars is something Turkish households already do, in cash and in bank accounts, against a currency that lost most of its value in five years. The on-chain version, a stablecoin, has been out of reach for anyone who is not already a crypto user: seed phrases, gas tokens, exchange sign-ups, and a wallet UX designed for traders. A piggy bank should be as simple as the one on a child's shelf: put lira in, take lira out, and in between keep it in something that holds its value. That is the whole product.

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
  K->>U: WebAuthn create (Face ID)
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

The anchor only pays and watches classic addresses, so each deposit and withdrawal passes through a throwaway classic "landing" account that nobody controls: after setup its only usable authorization is two pre-authorized transactions built for the exact quoted amount. Details, tradeoffs and the threat model are in [`docs/architecture.md`](docs/architecture.md); the measurements are in [`docs/anchor-notes.md`](docs/anchor-notes.md).

Build status: Gate 0 (spikes), Gate 1 (onboard + savings), Gate 2 (deposit round trip with the arrival autopilot) and Gate 3 (withdraw round trip to a simulated FAST payout) are done. Booth mode and metrics (Gate 4) and hardening (Gate 5) follow.

## Integrations

- **DeFindex**: the kumbara's USDC is deposited into a DeFindex vault (`deposit` / `withdraw` / `balance` / `get_asset_amounts_per_shares` on the vault contract). The testnet vault was deployed through the DeFindex factory for the anchor's USDC and has **no active strategy**, so no yield accrues on testnet; on mainnet the app points at DeFindex's USDC vault. The Savings screen says that USDC can earn yield through DeFindex, with a risk disclosure, and never shows a rate.
- **Anchor (TR Mock Anchor)**: Partner API from server-side route handlers (customers, deposit instructions, sandbox bank transfer, quotes, on-ramps, off-ramps, events); SEP-1 `stellar.toml` for discovery (the USDC issuer and SEP endpoints are read from it); SEP-38 pricing and SEP-6 demonstrated from a classic test account for standards evidence, since SEP-10 cannot authenticate a contract wallet.
- **Sembol Cloud**: fee-sponsoring relay in front of an unmodified OpenZeppelin Relayer (Channels plugin). The browser posts signed authorization entries to Kumbara's own `/api/relay`, which adds the project key. Until Sembol Cloud is deployed, the same route can point at the hosted OpenZeppelin Channels testnet service.
- **OpenZeppelin smart accounts**: every kumbara is an audited OpenZeppelin smart account with a passkey signer and the spending-limit policy, via [`@sembol/passkey-react`](https://www.npmjs.com/package/@sembol/passkey-react) and [`smart-account-kit`](https://github.com/stellar/smart-account-kit). Recovery (backup passkeys, recovery keys) and the limit UI come from the same library.
- **Reflector**: the TRY equivalent on the Savings screen is USD/TRY from Reflector's foreign-exchange oracle on Stellar mainnet (read by simulation, cached one minute), with the anchor's Reflector-sourced mid rate as fallback.
- **Soroswap**: not wired. The vault accepts the anchor's USDC directly (`SOROSWAP_ENABLED=false`); the spike in `spikes/soroswap.ts` records the on-chain router dry run for the day that changes.

## Contracts

All on **Stellar TESTNET**.

| Contract | ID | Link |
| --- | --- | --- |
| Kumbara USDC vault (DeFindex) | `CBUEZTX2U7GBOOAWIFQW2QOYW6DVQJNCMSLR2I6JCD3RJQLW67VJ5ZNV` | [stellar.expert (testnet)](https://stellar.expert/explorer/testnet/contract/CBUEZTX2U7GBOOAWIFQW2QOYW6DVQJNCMSLR2I6JCD3RJQLW67VJ5ZNV) |
| DeFindex factory | `CDSCWE4GLNBYYTES2OCYDFQA2LLY4RBIAX6ZI32VSUXD7GO6HRPO4A32` | [stellar.expert (testnet)](https://stellar.expert/explorer/testnet/contract/CDSCWE4GLNBYYTES2OCYDFQA2LLY4RBIAX6ZI32VSUXD7GO6HRPO4A32) |
| USDC Stellar Asset Contract (issuer `GBBD47IF…FLA5`, from the anchor's toml) | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` | [stellar.expert (testnet)](https://stellar.expert/explorer/testnet/contract/CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA) |
| Smart account WASM (OpenZeppelin, per-user instances) | `1b5f4534a76322da2ad7c745f6900857a6802b0ca79850c35a03561df997785a` | [example kumbara (testnet)](https://stellar.expert/explorer/testnet/contract/CCA3M6MEMU76ATTABWE7LFQI67F7C25PGJCFBJ75WZRQMTN255TTPOXB) |
| WebAuthn verifier (OpenZeppelin) | `CC7EKIHQP3TN4CARQDND6CEOY2UXLWWC2X5GHTD5NLAT7BG5GPZIOM3F` | [stellar.expert (testnet)](https://stellar.expert/explorer/testnet/contract/CC7EKIHQP3TN4CARQDND6CEOY2UXLWWC2X5GHTD5NLAT7BG5GPZIOM3F) |
| Ed25519 verifier (OpenZeppelin) | `CAAVTMCBXEIBPR64EAASKFXERVPYFZA2JYP5A3BG6PESWEFUJX5IHKN4` | [stellar.expert (testnet)](https://stellar.expert/explorer/testnet/contract/CAAVTMCBXEIBPR64EAASKFXERVPYFZA2JYP5A3BG6PESWEFUJX5IHKN4) |
| Spending-limit policy (OpenZeppelin) | `CABXBYJNZ7IUW4G3D6BND5YCAQF3ASSDMDAOKQQ63UYFSO7WUU2TIP5G` | [stellar.expert (testnet)](https://stellar.expert/explorer/testnet/contract/CABXBYJNZ7IUW4G3D6BND5YCAQF3ASSDMDAOKQQ63UYFSO7WUU2TIP5G) |
| Reflector FX oracle (MAINNET, read-only, for USD/TRY) | `CBKGPWGKSKZF52CFHMTRR23TBWTPMRDIYZ4O2P5VS65BMHYH4DXMCJZC` | [stellar.expert (mainnet)](https://stellar.expert/explorer/public/contract/CBKGPWGKSKZF52CFHMTRR23TBWTPMRDIYZ4O2P5VS65BMHYH4DXMCJZC) |

Anchor accounts (testnet): treasury `GCLCZEQZ2THTEDAOFI66LACNPLY4OBKN7VKLEZFMBIHYKYQOW2W7T3Z6`, SEP-10 signing key `GDXYO6FJCNXZEWGXD54GT76FGFYLOLSOGSOJLNQ6WGHCGEQPO7NTE73M`.

## Run it locally

```bash
git clone https://github.com/keyboord01/kumbara && cd kumbara
pnpm install
cp .env.example .env        # fill in ANCHOR_API_KEY, SEMBOL_* and SPONSOR_SECRET
pnpm dev                    # http://localhost:3000
```

Node 20.19+, pnpm 10. Every variable is documented in [`.env.example`](.env.example). Useful scripts:

```bash
pnpm build && pnpm start    # production build
pnpm typecheck
pnpm spike:all              # Gate 0 spikes against testnet (see spikes/README.md)
pnpm spike:landing          # ten landing-account deposits + one withdrawal
pnpm demo:deposit           # play the bank: simulate the TRY transfer for the newest pending deposit (or use /booth/admin)
pnpm test                   # unit tests (landing-account secret hygiene and lock invariants)
APP_URL=http://localhost:3000 pnpm e2e:onboard   # Chrome + virtual passkey, live testnet
APP_URL=http://localhost:3000 pnpm e2e:deposit   # onboard → deposit 100 TRY → vault, live testnet
APP_URL=http://localhost:3000 pnpm e2e:withdraw  # … → withdraw 1 USDC → simulated FAST payout
```

Deposit rehearsal: open the app, tap Deposit, enter an amount, and when the IBAN screen shows, run `pnpm demo:deposit` in a terminal. The app detects the lira, runs the landing-account on-ramp, moves the USDC into the kumbara, and asks for one Face ID approval to put it in the vault. Records live under `.data/kumbara/` locally.

### Deploy to Fly.io

One machine with a volume; records and counter events live in SQLite on `/data`.

```bash
fly launch --no-deploy --copy-config --name kumbara     # uses fly.toml and the Dockerfile
fly volumes create kumbara_data --region fra --size 1
fly secrets set ANCHOR_API_KEY=trma_test_… SEMBOL_PROJECT_KEY=… SPONSOR_SECRET=S… BOOTH_ADMIN_TOKEN=…
fly deploy
```

Non-secret configuration is in `fly.toml` (`[env]`); `NEXT_PUBLIC_STELLAR_NETWORK` is a build argument because it is baked into the browser bundle. `/api/health` is the machine's health check. `DATA_DIR` points the SQLite file elsewhere for local runs (default `./.data`; a relative path resolves against the server's working directory). To run the exact standalone server the image runs, locally:

```bash
pnpm build
ln -sfn "$(pwd)/.next/static" .next/standalone/.next/static   # the Dockerfile copies this
PORT=3100 node --env-file=.env .next/standalone/server.js
```

### Presenter controls

`/booth/admin` (not linked anywhere, `noindex`) shows the newest deposit waiting for a bank transfer and has one button, "Bankayı oynat / Play the bank", which does exactly what `pnpm demo:deposit` does. It requires `BOOTH_ADMIN_TOKEN` (12+ characters), passed once as `?token=` (removed from the URL immediately) or typed into the page, and sent as a bearer header; nothing is stored in the browser.

## Demo

Live URL and demo video: to be added when Gate 5 lands. Until then, `pnpm e2e:onboard` and `pnpm e2e:deposit` perform the flows in a real browser against testnet and print the created kumbara's address and the transaction links.

## Resources used

- skills.stellar.org: [Anchors](https://raw.githubusercontent.com/CheesecakeLabs/stellar-anchor-skill/main/SKILL.md) (SEP-1/6/10/12/38 flows), [DeFindex SDK](https://raw.githubusercontent.com/paltalabs/defindex-sdk/main/defindex-sdk-skill.md) (vault deposit/withdraw semantics; the app calls the vault contract directly because the SDK builds classic-source XDR), [Soroswap SDK](https://raw.githubusercontent.com/soroswap/sdk/main/skills/soroswap-sdk/SKILL.md) (evaluated, not wired), [SEPs, CAPs & Ecosystem](https://skills.stellar.org/skills/standards/SKILL.md), [Smart Accounts (Passkeys) & Fee Sponsorship](https://skills.stellar.org/skills/dapp/smart-accounts.md), [Stellar Assets & SAC](https://skills.stellar.org/skills/assets/SKILL.md).
- TR Mock Anchor docs: `llms-full.txt`, `/docs` (OpenAPI), `/guide`, `/mainnet`, `stellar.toml`.
- smart-account-kit source and its reference relayer proxy; OpenZeppelin stellar-contracts (WebAuthn verifier, spending-limit policy) source, read to match the on-chain checks exactly.
- stellar-cli 28 for contract interfaces and simulations; no stellar-build / Raven MCP usage.

## Team

Ahmed ([keyboord01](https://github.com/keyboord01)), author of Sembol and `@sembol/passkey-react`. Built with Claude Code.

## Post-hackathon roadmap

1. Mainnet path behind `MAINNET_DEMO_ENABLED`, budget-capped, presenter-only, with DeFindex's mainnet USDC vault and Circle's mainnet USDC.
2. Sembol Cloud as a deployed multi-tenant relay with per-project budgets and allowlists; Kumbara as its first project.
3. Anchor-side SAC delivery to contract wallets and Soroban-aware deposit matching, so the landing accounts become optional (`ONRAMP_MODE=direct`).
4. A real Turkish anchor behind the same interface (OAuth2 client credentials, travel-rule fields, observe-only fiat deposits), following the seams listed in `docs/architecture.md`.

## Regulatory note

Kumbara is non-custodial software: it never holds lira, USDC or keys, and every transfer is authorized by the user's own passkey on their own smart account. The anchor is the licensed party for fiat on- and off-ramping and for KYC. Kumbara has no payments, send or peer-to-peer feature and offers none in Türkiye.
