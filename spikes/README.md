# Gate 0 spikes

Throwaway-but-kept scripts that answer the integration questions before any UI work. Findings are written up in [`docs/anchor-notes.md`](../docs/anchor-notes.md); raw outputs land in `spikes/.out/` (copied to `docs/spike-findings/`).

```bash
cp .env.example .env   # fill in ANCHOR_API_KEY and the Sembol relay values
pnpm install
pnpm spike:relay       # smart account via the relay, spending limit, failure modes
pnpm spike:anchor      # C-address test, G-address on-ramp, trustless landing account, off-ramp
pnpm spike:defindex    # find/deploy the USDC vault, deposit + withdraw from the smart account
pnpm spike:soroswap    # decides SOROSWAP_ENABLED
pnpm spike:all
```

All four run on testnet only and refuse mainnet. They keep throwaway keys (a friendbot-funded classic account, the software passkey) in `spikes/.state.json`, which is gitignored, so repeated runs reuse the same smart account, anchor customer and vault.

`lib/passkey.ts` is a software WebAuthn authenticator that satisfies the on-chain OpenZeppelin verifier; it exists so the flows can be rehearsed from Node and CI. Real users always sign with their device passkey.
