# Failure states

Every state a visitor or a presenter can hit, how the app detects it, which screen it shows, the primary action, and the runbook section for the presenter. Screens come from one component (`components/FailureScreen.tsx`) fed by one classifier (`lib/failures.ts`); the copy lives in `lib/i18n.tsx` under `failures.kinds`, TR and EN. No raw error text is ever on the main surface: it sits behind a "Details" expander. Every screen can be viewed with sample data at `/failures` (`?kind=<state>` for one), which is `noindex` and not linked from the app.

All flows are resumable: a deposit or withdrawal lives in the database, the browser polls it, and reopening the app (after the phone locked, the tab closed or the connection dropped) shows the same status timeline from stored state with a "resumed" notice. A vault withdrawal that already happened is remembered server-side (`POST /api/withdraw/:id/vault`) so a resumed session never signs it twice.

| State | Detection | Screen (EN title) | Primary action | Runbook section |
| --- | --- | --- | --- | --- |
| `relay_unreachable` | `/api/relay` answers 502 `RELAY_UNREACHABLE`, or the library reports a network error / fetch failure on a relay call; pipeline `submit_failed` with "unreachable" | The relay is not answering. | Try again | Relay down |
| `relay_rejected` | Relay answered with an error that is none of the below (e.g. "Unauthorized function call") | The relay refused the request. | Try again | Relay down |
| `relay_budget` | Relay error text mentions budget / quota / insufficient funds, or HTTP 402 | The relay's fee budget is used up. | Try again (presenter tops up) | Relay down |
| `anchor_unreachable` | Kumbara API error with `source: "anchor"` and status ≥ 500 or a network error; `/api/anchor/info` failing; pipeline anchor errors ≥ 500 | The anchor is not answering. | Try again | Anchor down |
| `anchor_rejected` | Anchor 4xx on quote / on-ramp / off-ramp; pipeline `onramp_failed`, `offramp_cancelled` | The anchor refused this request. | Change the amount | – |
| `quote_expired` | Deposit step `transfer_received`: the 120 s quote ran out while the landing account was built and the rate moved (`lastError.code = quote_expired`, retried by the next poll); withdraw form: a quote older than 120 s is refetched and its age is shown | The rate expired. (inline: "fetching a fresh one") | Get a new rate (automatic) | – |
| `transfer_timeout` | Deposit still `awaiting_transfer` past `transferDeadline` (`DEPOSIT_TRANSFER_TIMEOUT_MIN`, default 30) | Your transfer has not arrived yet. | Keep waiting (30 more minutes) · Cancel this deposit | Transfer never arrives |
| `amount_mismatch` | Deposit step `onramp_pending`: the anchor's `amount_usdc` differs from the pre-authorized forward amount; record `error.code = amount_mismatch` | The anchor paid a different amount. Shows the bridge account with its explorer link and that the funds are not custodied. | Back to my kumbara | Amount mismatch |
| `vault_rejected` | Simulation or submission failure on a vault `deposit` / `withdraw` call (arrival autopilot, withdraw step 1) | The vault refused the transaction. | Try again (USDC stays put) | Vault red |
| `strategy_failed` | Same as above with "strategy" in the diagnostic | The vault's strategy failed. | Try again | Vault red |
| `limit_exceeded` | Library `spending_limit_exceeded`, or the withdraw form amount above the policy limit | Over your spending limit. | Change the limit (security page) | – |
| `passkey_cancelled` | Library `user_cancelled` / WebAuthn `NotAllowedError` | Face ID was cancelled. | Try again | – |
| `passkey_unsupported` | Library capability probe `supported === false`, `webauthn_unsupported`, `NotSupportedError` | This browser cannot use passkeys. | (instruction: open in Safari / Chrome or use the presenter's phone) | Passkey refused |
| `passkey_lost` | `connect()` finds no wallet, `wallet_not_found`, `session_expired`, `recovery_needs_address`; the "I can't find my passkey" link | Can't find your passkey? | Recover access (`/kurtar`, library recovery flow) | Passkey refused |
| `rate_limited_ip` | `/api/relay` 429 `RATE_LIMITED_IP` / `RATE_LIMITED_RELAY` | Too many kumbaras from this connection. | Try again later | Rate limited |
| `rate_limited_ref` | `/api/relay` 429 `RATE_LIMITED_REF` | This booth reached its limit. | Try again (presenter raises the cap) | Rate limited |
| `onboarding_paused` | `/api/relay` 503 `SPONSOR_UNDERFUNDED`; pipeline `sponsor_underfunded` | Opening kumbaras is paused. | Try again (presenter funds the sponsor) | Onboarding paused |
| `wrong_network` | `?net=` on the link differs from the build's network, or `/api/anchor/info` reports a different network than the browser bundle (`components/NetworkGuard.tsx`, whole app blocked) | Wrong network for this link. | Go to the start | – |
| `offline` | `navigator.onLine === false` or a fetch that never got an answer; a sticky banner while offline, polling continues by itself | You're offline. | Try again | – |
| `deployment_protected` | Any Kumbara API answer that is an HTML login page (401/403 with `text/html`, `vercel.com/sso`), detected in `lib/api.ts`; the whole app is replaced by the presenter screen | Vercel login is on. (presenter) | (instruction) | Vercel login |
| `usdc_not_received` | Withdrawal step `usdc_sent`: the bridge account never received the amount after 60 polls | The USDC never reached the bridge account. Shows the bridge account. | Back to my kumbara | Withdrawal stuck |
| `anchor_not_matched` | Withdrawal step `paid`: the anchor never matched the memo payment after 120 polls | The anchor has not matched the payment. | Back to my kumbara | Anchor down |
| `insufficient_balance` | Withdraw form amount above the vault position; API `insufficient_vault_balance` | Not enough USDC in the vault. | Change the amount | – |
| `invalid_amount` | API `amount_out_of_range` / `amount_too_small` | That amount is not allowed. | Change the amount | – |
| `unknown` | Anything else | Something unexpected happened. | Try again | – |

Resumed session (not a failure): the deposit and withdraw screens show "Deposit / Withdrawal in progress: resumed from where it stopped" whenever they picked up an in-flight record on load.

## Where the screens appear

- **Onboarding** (`/`): relay states, rate limits, onboarding paused, passkey cancelled / unsupported / lost, offline, Vercel login; "I already have a kumbara" connects an existing passkey, "I can't find my passkey" leads to `/kurtar`.
- **Savings** (`/kumbara`): spending-limit install failures (passkey cancelled and relay states, retry button).
- **Deposit** (`/yukle`): form errors (anchor, amount, offline), transfer timeout, pipeline failures (amount mismatch with the bridge account, anchor, relay, sponsor), quote refresh notice, arrival-autopilot failures (vault, strategy, limit, passkey, relay).
- **Withdraw** (`/cek`): form errors (limit, balance, anchor), quote age and refresh, client-step failures (vault, strategy, limit, passkey, relay), pipeline failures (USDC not received with the bridge account, anchor not matched, anchor cancelled, sponsor).
- **Every screen**: offline banner, wrong-network block, Vercel-login block.
- **Presenter** (`/booth/admin`): health dots, sponsor state and the CI banner; the runbook sections named above.
