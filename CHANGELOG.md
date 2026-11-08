# Changelog

All notable changes to Kumbara. Testnet only; nothing here is a mainnet release.

## v0.2.0-testnet (9 November 2026)

The first reviewed testnet release after the hackathon prototype (Rise In × Stellar Pro Hackathon, Istanbul, September 2026). Release notes: [`docs/release-notes/v0.2.0-testnet.md`](docs/release-notes/v0.2.0-testnet.md). Security review: [`SECURITY.md`](SECURITY.md).

### Security review fixes (Deliverable 1)

| Finding | Severity | Commit |
| --- | --- | --- |
| KB-01 Rate limits bypassable with a spoofed IP header | High | [`41f66b2`](../../commit/41f66b2) |
| KB-02 Anyone could register a backup passkey for any kumbara; a verified mapping could be moved | Medium | [`570504e`](../../commit/570504e), E2E in [`9d6c3bb`](../../commit/9d6c3bb) |
| KB-03 Record ids were bearer capabilities; reported hashes were not checked | Medium | [`239946c`](../../commit/239946c), cancel guard in [`9d6c3bb`](../../commit/9d6c3bb) |
| KB-04 The relay paid fees for any Soroban call | Medium | [`2324c90`](../../commit/2324c90) |
| KB-05 Public metrics could be inflated with made-up hashes | Low | [`239946c`](../../commit/239946c) |
| KB-06 A public credential id was accepted as proof of ownership | Medium | [`9d6c3bb`](../../commit/9d6c3bb) |

### Self-serve test money (Deliverable 2)

- One tap on an empty kumbara sends 10 test USDC from a pool: one grant per kumbara, 50 per day, 6 requests per IP per hour, Kumbara accounts only, testnet only. Labelled "test money" on every surface. [`5cb24aa`](../../commit/5cb24aa)
- `/booth/admin/funds`: pool balance, grants per day, latest grants and refusals, one-step refill (Friendbot, then XLM → USDC on the testnet DEX). [`5cb24aa`](../../commit/5cb24aa)
- `pnpm e2e:testfunds`: zero to a funded kumbara, into the vault, the second grant refused. [`5cb24aa`](../../commit/5cb24aa)

### Pilot instrumentation (Deliverable 3)

- Error capture from every failure screen and uncaught error; one-tap "Report a problem"; a public status line in the footer; `/booth/admin/monitor` for the presenter. [`d5345a8`](../../commit/d5345a8)

### Drills

- `pnpm drill:recovery` (backup passkey restores access) and `pnpm drill:failures` (passkey refused, relay down, slow network then offline). [`21b62f7`](../../commit/21b62f7)

### The five highest-impact issues found on testnet, fixed

These were found by the builder on 8–9 November 2026: on the live deployment's `/api/health`, and in E2E runs against live testnet during a real relay outage. **No pilot user had reported issues yet.** The feedback capture that will collect their reports shipped in this release.

| # | Issue | Impact | Commit |
| --- | --- | --- | --- |
| 1 | Testnet moved to protocol 30 and `stellar-sdk` 16.3.0 could not parse its ledger headers (`unknown StellarValueType member for value 3`) | Production health showed RPC red; ledger reads failed | [`15b5343`](../../commit/15b5343) |
| 2 | The hackathon's mock anchor vanished from DNS while it was still the default anchor | Production `/api/anchor/info` answered 503 "fetch failed", and every screen that needs the USDC contract broke | [`06bce14`](../../commit/06bce14) |
| 3 | A relay gateway timeout (an HTML 504 page) was classified as "Vercel login is on" | During the 8 Nov relay outage users would have seen a presenter-only screen with no retry, instead of "the relay is not answering, try again" | [`4abed07`](../../commit/4abed07) |
| 4 | Buttons rendered as links: Base UI logged an accessibility error on every page, and the first fix made links read as buttons | 24 links across the app; screen readers announced them as the wrong role | [`648521c`](../../commit/648521c), [`625943e`](../../commit/625943e) |
| 5 | The scheduled and preview E2E round trips played the bank on the vanished mock anchor | Every CI run failed, so real regressions would have been hidden | [`b522dec`](../../commit/b522dec) |

Also fixed: the failure gallery's sample screens reported themselves to the new monitor ([`9f945d8`](../../commit/9f945d8)).

### Other

- Kumbara stands on its own name: the "by Sembol" tag is gone. [`d3e8521`](../../commit/d3e8521)

### Known limits

- **Withdraw to a bank account (IBAN) is unavailable.** It needs a lira anchor, and the only one, the hackathon's mock anchor, is gone. A real lira anchor is SOW 2. Taking USDC out of the vault back into the kumbara works (the test-funds E2E puts money in; the opt-out uses the same vault calls). Withdrawals to a Stellar address do not need an anchor, but their E2E (`e2e:address`) was funded through the mock anchor and has not run in this release.
- **Deposits** run through `testanchor.stellar.org` (SDF's reference anchor, USD, up to about 10 USDC). It funds its own deposits, so nobody plays the bank.

## v0.1.0 (September 2026)

The hackathon prototype: passkey smart accounts through a relay, SEP-6 deposits through a pre-authorised bridge account, a DeFindex vault, withdrawals to an IBAN through the mock anchor, 27 failure screens, a presenter console and public stats. Prior work; not part of the Instawards SOW.
