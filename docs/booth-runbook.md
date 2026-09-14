# Booth runbook

Rise In × Stellar Pro Hackathon, Istanbul, 19–20 September 2026. Everything below is **Stellar testnet**: no real lira moves, and every screen says so.

## Code freeze

The tree is frozen from 16 September 2026 (`CODE_FREEZE` at the repository root; the guard is the Freeze workflow). Until the demo, a push to `main` that touches application code must be a hotfix for a red checklist item or a red E2E, with a commit subject that starts with `hotfix:`. Docs, scripts and workflows stay open. Every production deploy still runs the round trip in CI; dispatch the E2E workflow by hand after a hotfix and wait for green before the doors open.

## Pre-doors checklist (30 minutes before)

1. **The domain serves the latest deploy.** `kumbara.sembol.xyz` is the project's production domain, so every production deploy reaches it by itself (no alias step). Check `curl -s "https://kumbara.sembol.xyz/api/anchor/info?cb=$(date +%s)"` shows the vault id from `docs/deploy.md` and `/api/health` answers `ok:true`. Passkeys are bound to this domain: accounts made on the old `kumbara.vercel.app` address (which now redirects here) do not open on it, so seed the demo account fresh (step 8).
2. **CI green.** The last "Production round trip (scheduled)" run under GitHub → Actions → E2E is green, and `/booth/admin` shows no red "Last CI run failed" banner. If it is red, open the linked run: the failing step names the subsystem (onboard = relay, deposit = anchor or landing, withdraw = anchor payout, booth = admin/sponsor, stats = metrics).
3. **Sponsor topped up.** The sponsor card on `/booth/admin` says "Sufficient"; keep it around 20 XLM (Fund via Friendbot on testnet). Below 3 XLM onboarding pauses; the scheduled CI run skips itself below 8 XLM.
4. **Rate limits set.** Booth Wi-Fi shares one IP: `RATE_LIMIT_ACCOUNTS_PER_IP_HOUR=60` and `RATE_LIMIT_ACCOUNTS_PER_REF=300` in the production environment (see `docs/deploy.md`). Changing them is an env change plus a deploy.
5. **Admin token loaded on the presenter phone.** Open `https://kumbara.sembol.xyz/booth/admin?token=<BOOTH_ADMIN_TOKEN>`; the token leaves the URL immediately. Keep the tab open; the four dots must be green.
6. **Stats page open.** Second screen: `https://kumbara.sembol.xyz/stats?mode=tv` (projector mode: big numbers, live feed, auto-cycling chart). Phone or laptop: `https://kumbara.sembol.xyz/stats` for the full page with contracts and how-it-works.
7. **Booth QR screen.** `https://kumbara.sembol.xyz/booth?n=1` on the booth screen (full-screen QR + counter). Use `n=2` for a second booth; the counter credits `booth-<n>`. The link carries `&net=testnet`, so a mainnet build would refuse it.
8. **Demo account seeded.** On the admin page tap "Seed a demo account" (the presenter's passkey, then a second Face ID when the USDC arrives). About 90 seconds. Leave that account connected on the presenter's phone for the jury withdraw.
9. **Backup videos ready.** The phone recording of the round trip, and the fallback `docs/demo/round-trip.mp4` with its captions.

## The three-minute script

Times are from the automated browser runs on testnet (`pnpm e2e:onboard`, `pnpm e2e:deposit`, `pnpm e2e:withdraw`, `pnpm e2e:booth`, several runs on 5–6 September 2026, ranges given); a phone on booth Wi-Fi is within a few seconds of these. The second screen shows `/stats?mode=tv`: the counter and the live feed move as the visitor goes through the steps.

| Step | What the visitor does | What happens | Time |
| --- | --- | --- | --- |
| 1 | Scans the QR, taps **Kumbaranı aç**, passkey (Face ID, Touch ID or a password manager) | Smart account deployed through the relay, Savings screen appears with the TESTNET address and a stellar.expert link; the counter on the booth screen and the stats feed tick | 8–16 s |
| 2 | Waits on Savings | Spending limit (1,000 USDC per transaction) installs in the background; second passkey prompt; Deposit unlocks | +13–25 s |
| 3 | Taps **Yükle**, enters 100, **Devam** | IBAN, alıcı, açıklama (the reference) in the familiar transfer layout | 1–3 s |
| 4 | Presenter taps **Play the bank** on the admin page | Sandbox transfer matched; the app detects the lira, runs the landing-account on-ramp and moves the USDC into the kumbara | 35–55 s |
| 5 | Passkey once more (autopilot) | USDC deposited into the DeFindex vault (through its strategy); three TESTNET transaction links; "deposited" appears in the stats feed | 10–20 s |
| 6 | Back on Savings | Vault balance and its TRY equivalent (Reflector rate) | instant |
| 7 | Taps **Çek**, enters 1 (or **Tümünü çek**), **Devam**, two passkey approvals | Vault withdrawal, transfer to the reverse landing account, anchor payout; payout reference shown; "withdrew" in the feed | 40–65 s |

Measured totals: scan to Savings 8–16 s; scan to USDC in the vault 80–120 s; a full deposit-and-withdraw round trip 2–3 minutes. Seeding the jury demo account from the admin page takes about 90 s.

What to say while waiting (all true): the kumbara is an OpenZeppelin smart account whose only key is the visitor's passkey; Kumbara never holds their money; the lira leg is a regulated anchor's job; fees are paid by Sembol's relay so nobody needs XLM; the USDC sits in a DeFindex vault that runs DeFindex's hodl strategy on testnet (no yield accrues there, and no rate is ever promised).

If the phone locks or the visitor closes the tab mid-flow: reopening the link returns to the same status timeline from stored state ("Deposit in progress: resumed"). Nothing needs to be redone.

## Failure playbook

Every failure has its own screen in the app (TR/EN, plain language, one action, raw detail behind "Details"); the screen names the section below. The full table is `docs/failure-states.md`; every screen can be previewed at `/failures`.

### Anchor down

Red Anchor dot, "The anchor is not answering", deposits stuck on "Waiting for your transfer" after playing the bank, or "The anchor has not matched the payment" on a withdrawal. Deposits and withdrawals cannot progress; onboarding and the Savings screen still work. Say so and demo onboarding plus the security page (backup passkey, spending limit). Already-started deposits resume by themselves when the anchor returns (the pipeline retries every poll, six attempts per step). The anchor's own status page: `https://tr-mock-anchor.fly.dev/health`. If the treasury USDC is low, on-ramps wait with `pending_reason: treasury_low`; ask the anchor team to refill. An unmatched withdrawal payment leaves the SEP-6 transaction short of `completed` (the record keeps its id; the anchor's `more_info_url` shows it); the visitor's USDC is at the anchor, their lira has not been sent; the anchor team matches it by memo.

### Relay down

Red Relay dot; "The relay is not answering", "The relay refused the request" or "The relay's fee budget is used up". Nothing that needs a signature can go through: no new accounts, no vault deposits, no withdrawals. Do not ask anyone for XLM; the app never will. Use the seeded account to walk through Savings and the security page, and show the backup video for the round trip. Pre-authorized landing transactions have no expiry, so in-flight deposits complete once the relay is back. Budget exhausted: top up the project's budget on the relay (OpenZeppelin Channels: the channel accounts' XLM) and retry. If only the hosted Channels service is down, switching `SEMBOL_CLOUD_URL` to another relay and redeploying takes about three minutes.

### Passkey on another device, or lost

"Kumbaram zaten var" opens the kumbara on any device that has the passkey (iCloud Keychain, 1Password, Google Password Manager): the address derives from the passkey itself, no service in between. "Passkey'imi bulamıyorum" (`/kurtar`) is for a backup passkey enrolled on the security screen, or for typing the address; the kumbara's address is on its Savings screen and on stellar.expert. Without a backup passkey or the address, nobody can open a kumbara, Kumbara included.

### Passkey refused

"The passkey prompt was cancelled", "This browser cannot use passkeys", "Can't find your passkey?", or nothing happens on tap. On iPhone, Safari needs a tap for every WebAuthn prompt: the deposit and withdraw screens show a button ("Put it in the vault", "Send") whenever an automatic prompt was refused; tap it. Private browsing on iOS blocks passkeys; ask the visitor to open the link in normal Safari. Android Chrome works with a screen lock set. If the visitor's device has no platform authenticator at all, the screen says so; hand them the presenter's phone for the demo. A visitor who already has a kumbara taps "I already have a kumbara" (their passkey) or, if the passkey is gone, "I can't find my passkey" → `/kurtar`, which uses the backup passkey or recovery key they enrolled on the security page. Without an enrolled backup there is no way in, for anyone.

### Onboarding paused

"Opening kumbaras is paused": the sponsor dropped below `SPONSOR_MIN_XLM`. On the admin page tap "Fund via Friendbot" (testnet) and have the visitor tap "Try again"; on mainnet send XLM to the address shown on the admin page.

### Rate limited

"Too many kumbaras from this connection" (per-IP cap, 60 per hour on booth Wi-Fi) or "This booth reached its limit" (per-ref cap, 300 per booth link). Wait, or raise `RATE_LIMIT_ACCOUNTS_PER_IP_HOUR` / `RATE_LIMIT_ACCOUNTS_PER_REF` (env change + deploy). A second booth link (`/booth?n=2`) has its own per-ref count.

### Deposit stuck at the anchor (treasury low)

"The anchor is sending USDC" for more than 90 seconds (the SEP-6 transaction stays `pending_anchor` or `pending_stellar`). The amount was larger than the anchor's shared testnet USDC treasury (the anchor dot shows the balance; the deposit form refuses amounts above about 90% of it). The anchor keeps the order and pays when its treasury is refilled; the app cannot cancel it on the anchor's side. The Deposit screen offers "Abandon and start over": the visitor makes a smaller deposit, and the abandoned one appears under "Waiting at the anchor / abandoned" on the admin page with a Resume button for after the refill. The TR Mock Anchor caps a deposit at 3,000 TRY (the form enforces the limits it publishes); keep booth deposits between 100 and 2,000 TRY.

### Transfer never arrives

"Your transfer has not arrived yet" after `DEPOSIT_TRANSFER_TIMEOUT_MIN` (30) minutes on the IBAN screen. On testnet this means nobody played the bank: tap "Play the bank" on the admin page for that reference (the newest pending deposit is preselected). The visitor can also keep waiting (30 more minutes) or cancel; a late transfer still completes the deposit because the record stays open.

### Amount mismatch

"The anchor paid a different amount" (presenter screen, shows the bridge account with its explorer link). The anchor sent an amount that differs from what the pre-authorized forward was signed for, so the forward cannot fire and the USDC sits on the ownerless bridge account: visible on-chain, spendable by nobody, not custodied by Kumbara. Procedure:

1. Open the bridge account on stellar.expert (link on the screen, or from "Waiting at the anchor / abandoned" on the admin page, which shows paid / expected) and read its USDC balance.
2. **Paid more than expected**: tap **Resume** on the admin page. The pre-authorized forward moves exactly the expected amount into the kumbara; the surplus stays on the bridge account (nobody can move it; on testnet that is the end of it, on mainnet the anchor reconciles it with the visitor).
3. **Paid less than expected**: the bridge account needs topping up to the expected amount before the forward can fire. On testnet, send the difference in USDC to the bridge address from a funded test account (any testnet wallet holding the anchor's USDC, for example one funded through the anchor's own `/explorer`), then tap **Resume**. On mainnet the anchor, as the paying party, sends the difference.
4. Tell the visitor: the USDC is theirs on-chain the moment the forward fires; nothing was lost and nobody else holds it. Retry the deposit with the same amount only after the record shows "Done. USDC is in the vault."

### Vault red

The vault dot is red while the others are green: "The vault refused the transaction" or "The vault's strategy failed". The vault contract does not answer simulations (RPC hiccup or a testnet reset). Deposits stop at "USDC arrived; putting it in the vault" and withdrawals cannot start; the USDC stays in the visitor's kumbara. Retry after a minute; if a testnet reset happened, the contract set in `docs/deploy.md` (vault, strategy) must be redeployed (`docs/architecture.md`, "DeFindex strategy on testnet").

### Withdrawal stuck

"The USDC never reached the bridge account": the browser reported the transfer but the bridge account shows no USDC after three minutes. Check the transfer link on the screen; if that transaction failed, the USDC is still in the kumbara and the visitor can start a new withdrawal. A reload never repeats the vault withdrawal: the app remembers it server-side.

### Vercel login

"Vercel login is on" (presenter screen) or `/api/health` answers an HTML page: deployment protection was switched back on for the deployment. Fix from a laptop: `curl -X PATCH "https://api.vercel.com/v9/projects/kumbara" -H "Authorization: Bearer $VERCEL_TOKEN" -H "content-type: application/json" -d '{"ssoProtection": null}'` (or Vercel dashboard → Project → Settings → Deployment Protection → off). No redeploy needed; reload the app.

### CI failed

Red "Last CI run failed at step X" banner on `/booth/admin`: the 6-hourly production round trip failed. Open the run (link on the banner) and the issue it opened (label `e2e-failure`, with the screenshot artifact). The failing step tells you where to look: onboard → relay or sponsor, deposit → anchor or landing account, withdraw → anchor payout, booth → admin token or sponsor, stats → metrics. The banner clears on the next green run (Actions → E2E → Run workflow to trigger one by hand), which also closes the issue.

## Presenter laptop and the driver

The visitor's page is not what moves a deposit any more. The presenter console (`/booth/admin`) runs the **driver**: every 5 seconds it calls `POST /api/pipeline/tick`, which advances every pending deposit and withdrawal through the steps the server can take alone (anchor status, bridge forward, cleanup, anchor payout). The chip at the top of the console reads **driver: on** with the last tick's result. A visitor can therefore scan, get the IBAN, close the tab, and come back later to a screen that says "USDC arrived — tap to put it in your kumbara": only the vault step needs their passkey. The timeline tells them so under every step: "Kapatabilirsin, biz devam ediyoruz" during our steps, "Bu adım passkey'ini istiyor" on theirs.

Before doors:

1. In a terminal on the presenter laptop: `caffeinate -d` (leave it running; it keeps the display, and so the tab, awake).
2. System Settings → Lock Screen: never turn the display off, never require a password after sleep, for the day.
3. Open `/booth/admin?token=…` in its own window, confirm **driver: on**, and never close that tab. If it shows **driver: off** with a reason, read the reason (it is the server's own message) and fix that first.
4. Wi-Fi drops: the console shows "Bağlantı koptu; yeniden bağlanıyor…" and resumes by itself when the network is back (it re-ticks on `online` and when the tab becomes visible). Nothing to do.

Backstop: a GitHub Actions cron (`.github/workflows/pipeline-tick.yml`) calls the same tick every 5 minutes with the admin token, so a closed laptop delays a visitor's deposit by at most a few minutes instead of stalling it. Both are idempotent and share the record leases.

Sponsor reserves: every bridge account locks three or four base reserves (0.5 XLM each) **on the sponsor** until the bridge is merged back, so the console's sponsor figure is the *spendable* balance (held minus locked reserves; the line under it says how many reserves are locked). On 9 September 97 unmerged bridges had locked 48.5 of 49.98 XLM and every new deposit failed at bridge creation while the raw balance still looked fine. Press **Köprüleri kapat / Merge finished bridges** whenever the locked count grows (the cron does it every 5 minutes too); a bridge that still holds USDC (amount mismatch) is skipped on purpose. Below 3 XLM spendable, onboarding and deposits refuse with `sponsor_underfunded`; top up with the Friendbot button (testnet).

Every admin action renders the server's reason under it (status, code, message): "no deposit is awaiting a transfer", "already paid", "no sandbox hook on this anchor", "another step is running on this deposit; try again in a few seconds". Read it before pressing again.

## After the event

`https://kumbara.sembol.xyz/stats` and `https://kumbara.sembol.xyz/api/metrics?since=<BOOTH_START_TS>` are the traction evidence: accounts (deploy confirmed) with hashes, by booth ref, deposits, vault deposits and withdrawals with transaction links, TRY in/out, the live vault total and the timings. Both are public; the seeded demo account and the automated E2E runs are excluded unless `?include=seed,e2e`.

## Backup videos

- The phone recording of the round trip made at the booth is the backup demo.
- `docs/demo/round-trip.mp4` (+ `round-trip.captions.md`, `round-trip.vtt`) is the fallback to that fallback: the same round trip recorded against production by `pnpm demo:record` (Playwright, virtual passkey), under five minutes, with a caption per step.

## Anchor switch

The choice is stored per deployment environment (production, preview, local): a CI run switching a preview deployment to testanchor.stellar.org never touches the booth's production anchor.

`/booth/admin` lists the configured anchors (from `ANCHOR_HOME_DOMAINS`) with what their `stellar.toml` says. New deposits and withdrawals use the selected one; anything in flight stays on the anchor it started on. Only the TR Mock Anchor has a sandbox bank-transfer hook, so "play the bank" works there; on testanchor.stellar.org a deposit stops at the bank instructions and must be cancelled (the abort envelope returns the sponsor's reserves).
