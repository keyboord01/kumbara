# Gate 0 spikes

Throwaway-but-kept scripts that answer the integration questions before any UI work. Findings are written up in [`docs/anchor-notes.md`](../docs/anchor-notes.md); raw outputs land in `spikes/.out/` (copied to `docs/spike-findings/`).

```bash
cp .env.example .env   # fill in ANCHOR_HOME_DOMAINS and the Sembol relay values
pnpm install
pnpm spike:relay       # smart account via the relay, spending limit, failure modes
pnpm spike:sep6        # SEP-6 deposit and withdrawal through locked bridge accounts; testanchor.stellar.org as a second anchor
pnpm spike:soroswap    # decides SOROSWAP_ENABLED
pnpm spike:all
```

All three run on testnet only and refuse mainnet. They keep throwaway keys (a friendbot-funded classic account, the software passkey) in `spikes/.state.json`, which is gitignored, so repeated runs reuse the same smart account and vault.

The Gate 0 anchor, landing-account and DeFindex spikes funded their USDC through the TR Mock Anchor's Partner API; that API was removed on 8 September 2026 and those scripts went with it. Their findings stay in [`docs/anchor-notes.md`](../docs/anchor-notes.md) and `docs/spike-findings/`.

`lib/passkey.ts` is a software WebAuthn authenticator that satisfies the on-chain OpenZeppelin verifier; it exists so the flows can be rehearsed from Node and CI. Real users always sign with their device passkey.
