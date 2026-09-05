# Booth runbook

Rise In × Stellar Pro Hackathon, Istanbul, 19–20 September 2026. Everything below is **Stellar testnet**: no real lira moves, and every screen says so.

## Setup (10 minutes before)

1. Open `https://kumbara.vercel.app/booth/admin?token=<BOOTH_ADMIN_TOKEN>` on the presenter's phone or laptop. The token leaves the URL immediately; keep the tab open.
2. Check the four dots: Anchor, Relay, Stellar RPC, DeFindex vault must all be green. The sponsor card must say "Sufficient" (≥ 3 XLM; keep it around 20 XLM, use "Fund via Friendbot" on testnet).
3. Open `https://kumbara.vercel.app/booth?n=1` on the booth screen (full-screen QR + counter). Use `n=2` for a second booth; the counter credits `booth-<n>`.
4. Seed one demo account for the jury withdraw: on the admin page tap "Seed a demo account" (Face ID on the presenter's device, then a second Face ID when the USDC arrives). About 90 seconds. Leave that account connected on the presenter's phone.

## The three-minute script

Times are from the automated browser runs on testnet (`pnpm e2e:onboard`, `pnpm e2e:deposit`, `pnpm e2e:withdraw`, `pnpm e2e:booth`, several runs on 5 September 2026, ranges given); a phone on booth Wi-Fi is within a few seconds of these.

| Step | What the visitor does | What happens | Time |
| --- | --- | --- | --- |
| 1 | Scans the QR, taps **Kumbaranı aç**, Face ID | Smart account deployed through the relay, Savings screen appears with the TESTNET address and a stellar.expert link | 8–16 s |
| 2 | Waits on Savings | Spending limit (1,000 USDC per transaction) installs in the background; second Face ID prompt; Deposit unlocks | +13–25 s |
| 3 | Taps **Yükle**, enters 100, **Devam** | IBAN, alıcı, açıklama (the reference) in the familiar transfer layout | 1–3 s |
| 4 | Presenter taps **Play the bank** on the admin page | Sandbox transfer matched; the app detects the lira, runs the landing-account on-ramp and moves the USDC into the kumbara | 35–55 s |
| 5 | Face ID once more (autopilot) | USDC deposited into the DeFindex vault; three TESTNET transaction links | 10–20 s |
| 6 | Back on Savings | Vault balance and its TRY equivalent (Reflector rate) | instant |
| 7 | Taps **Çek**, enters 1 (or **Tümünü çek**), **Devam**, two Face IDs | Vault withdrawal, transfer to the reverse landing account, anchor payout; payout reference shown | 40–65 s |

Measured totals: scan to Savings 8–16 s; scan to USDC in the vault 80–120 s; a full deposit-and-withdraw round trip 2–3 minutes. The counter on the booth screen goes up by one at step 1 (deploy confirmed). Seeding the jury demo account from the admin page takes about 90 s.

What to say while waiting (all true): the kumbara is an OpenZeppelin smart account whose only key is the visitor's passkey; Kumbara never holds their money; the lira leg is a regulated anchor's job; fees are paid by Sembol's relay so nobody needs XLM; the USDC sits in a DeFindex vault that can earn yield (no active strategy on testnet, and no rate is ever promised).

## Failure playbook

**Anchor down (red Anchor dot, or deposits stuck on "Waiting for your transfer" after playing the bank).**
Deposits and withdrawals cannot progress; onboarding and the Savings screen still work. Say so and demo onboarding plus the security page (backup passkey, spending limit). Already-started deposits resume by themselves when the anchor returns (the pipeline retries every poll, six attempts per step). The anchor's own status page: `https://tr-mock-anchor.fly.dev/health`. If the treasury USDC is low, on-ramps wait with `pending_reason: treasury_low`; ask the anchor team to refill.

**Relay down (red Relay dot, onboarding shows "Sembol Cloud could not be reached").**
Nothing that needs a signature can go through: no new accounts, no vault deposits, no withdrawals. Do not ask anyone for XLM; the app never will. Use the seeded account to walk through Savings and the security page, and show the recorded backup video for the round trip. Pre-authorized landing transactions have no expiry, so in-flight deposits complete once the relay is back. If only the hosted Channels service is down, switching `SEMBOL_CLOUD_URL` to another relay and redeploying takes about three minutes.

**Passkey refused ("Face ID was cancelled", or nothing happens on tap).**
On iPhone, Safari needs a tap for every WebAuthn prompt: the deposit and withdraw screens show a button ("Put it in the vault", "Send") whenever an automatic prompt was refused; tap it. Private browsing on iOS blocks passkeys; ask the visitor to open the link in normal Safari. Android Chrome works with a screen lock set. If the visitor's device has no platform authenticator at all, the button explains it; hand them the presenter's phone for the demo.

**Onboarding paused ("sponsor account is low on XLM").**
The sponsor dropped below `SPONSOR_MIN_XLM`. On the admin page tap "Fund via Friendbot" (testnet) and retry; on mainnet send XLM to the address shown.

**Rate limited ("No new kumbaras from this device or booth for now").**
Per-IP cap is 5 accounts per hour (booth Wi-Fi shares one IP: raise `RATE_LIMIT_ACCOUNTS_PER_IP_HOUR` in `fly.toml` before the event, e.g. to 60) and the per-ref cap is 300; both are env-configurable.

**Deposit stuck on "The anchor is sending USDC" (order `pending`, reason `treasury_low`).**
The amount was larger than the anchor's shared testnet USDC treasury (the anchor dot on the admin page shows the balance; the deposit form now refuses amounts above about 90% of it). The anchor keeps the order and pays when its treasury is refilled; the app cannot cancel it on the anchor's side. After 90 seconds the Deposit screen offers "Abandon and start over": the visitor can then make a smaller deposit, and the abandoned one appears under "Waiting at the anchor / abandoned" on the admin page with a Resume button for after the refill. Keep booth deposits between 100 and 2,000 TRY.

**Vault red, everything else green.**
The vault contract does not answer simulations (RPC hiccup or a testnet reset). Deposits stop at "USDC arrived; putting it in the vault" and withdrawals cannot start; the USDC stays in the visitor's kumbara. Retry after a minute; if a testnet reset happened, the contract set in `fly.toml` must be redeployed (see `docs/anchor-notes.md`).

## After the event

`https://kumbara.vercel.app/api/metrics?since=<BOOTH_START_TS>` is the traction evidence: accounts (deploy confirmed) with hashes, by booth ref, deposits, vault deposits and withdrawals, each with transaction links. It is public and cached for 30 seconds.
