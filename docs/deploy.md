# Deploying Kumbara

Production runs on **Vercel (Hobby, Fluid compute)** with **Turso** for the records, the contract-to-customer map and the counter events. There is no long-lived process: every deposit and withdrawal step is resumed from database state on whichever invocation polls next, mutual exclusion is a database lease, and rate-limit windows are rows. The Fly.io files (`Dockerfile`, `fly.toml`) are kept as an alternative single-machine path with a local libsql file on a volume.

Live: **https://kumbara.sembol.xyz** (Stellar TESTNET; `kumbara.vercel.app` and `kumbara-theta.vercel.app` redirect here with a 308). Functions run in `fra1`; the Turso database is in `aws-eu-west-1` (Ireland), the closest available region to Frankfurt.

## Prerequisites

- Vercel CLI (`npm i -g vercel`) and a Vercel token (`VERCEL_TOKEN`), used non-interactively.
- A Turso platform token (`TURSO_PLATFORM_TOKEN`) for the Platform API (or the `turso` CLI).
- The values for the secrets below.

Keep both tokens out of the repository and out of logs; the steps below read them from `.env`.

## Turso (once)

The Platform API (`https://api.turso.tech/v1`) with `Authorization: Bearer $TURSO_PLATFORM_TOKEN`:

```bash
ORG=<your org slug>                               # GET /organizations
# group in the nearest available region to Frankfurt
curl -X POST $API/organizations/$ORG/groups -d '{"name":"default","location":"aws-eu-west-1"}'
curl -X POST $API/organizations/$ORG/databases -d '{"name":"kumbara","group":"default"}'
# database URL is libsql://<Hostname> from GET /organizations/$ORG/databases/kumbara
curl -X POST "$API/organizations/$ORG/databases/kumbara/auth/tokens?expiration=never&authorization=full-access"   # -> {"jwt": ...}
```

With the CLI: `turso db create kumbara --location aws-eu-west-1`, `turso db show kumbara --url`, `turso db tokens create kumbara`. The schema is created on first use (`CREATE TABLE IF NOT EXISTS`, see `lib/db/store.ts`), so nothing else is needed.

Current database: `kumbara` in organisation `keyboord01`, hostname `kumbara-keyboord01.aws-eu-west-1.turso.io`.

## Sponsor account (once)

A fresh testnet keypair funded with about 50 XLM, used only to sponsor landing-account reserves (2.5 XLM per in-flight deposit, returned at cleanup) and pay their setup fees. It never holds user funds. `scripts/new-sponsor.ts` creates and funds one and writes the secret to a file that is never printed:

```bash
node --import tsx scripts/new-sponsor.ts .data/sponsor.env 50
```

Production sponsor: **`GCMQOXM2R34FLJRMRXKWL6XVJ3BQPUU2WXCMTCED3ZDSYZM7UI2EKHEQ`** ([stellar.expert, testnet](https://stellar.expert/explorer/testnet/account/GCMQOXM2R34FLJRMRXKWL6XVJ3BQPUU2WXCMTCED3ZDSYZM7UI2EKHEQ)). Onboarding pauses below `SPONSOR_MIN_XLM` (3); the admin console warns above `SPONSOR_MAX_XLM` (100) and can top it up from Friendbot on testnet.

## Vercel

```bash
vercel link --yes --project kumbara --token "$VERCEL_TOKEN"

# production environment (each value is piped on stdin, never passed on the command line)
for KV in $(cat .data/vercel-env.prod); do
  printf '%s' "${KV#*=}" | vercel env add "${KV%%=*}" production --token "$VERCEL_TOKEN"
done

vercel deploy --prod --yes --token "$VERCEL_TOKEN"
```

### Domain

`kumbara.sembol.xyz` is a **project domain attached to production** (CNAME `kumbara.sembol.xyz → cname.vercel-dns.com` at the DNS host; added with `vercel domains add kumbara.sembol.xyz kumbara --token "$VERCEL_TOKEN"`; `curl -s https://api.vercel.com/v9/projects/kumbara/domains -H "Authorization: Bearer $VERCEL_TOKEN"` lists it as `verified: true`). Every production deploy, including the ones the GitHub integration makes on a push to `main`, serves it at once: there is no alias step any more. Vercel issued the certificate (Let's Encrypt, first issued 2026-09-05, renewed automatically) as soon as the DNS resolved.

The two previous addresses redirect with a permanent 308 to the new domain, path included:

- `kumbara-theta.vercel.app` is the project's own `.vercel.app` domain; the redirect is set on the domain itself (`PATCH /v9/projects/kumbara/domains/kumbara-theta.vercel.app {"redirect":"kumbara.sembol.xyz","redirectStatusCode":308}`) and happens at the edge.
- `kumbara.vercel.app` is a deployment alias that belongs to another Vercel team, so it cannot be attached to this project; it is pointed once at a deployment that carries the host-based redirect in `next.config.mjs` (`vercel alias set <deployment-url> kumbara.vercel.app`) and needs no further updates: that deployment is immutable and keeps redirecting.

**Passkeys are bound to the domain.** `NEXT_PUBLIC_WEBAUTHN_RP_ID=kumbara.sembol.xyz` sets the WebAuthn Relying Party ID explicitly in production (the library otherwise derives it from the current host; previews and localhost leave it unset on purpose so their own hosts work). A passkey created under one RP ID cannot sign under another, so **every account created on `kumbara.vercel.app` before the move stops working on the new domain**: the old test accounts, the seeded demo account and any visitor account from the old address. Seed a fresh demo account on the new domain before the event. Their on-chain kumbaras still exist and still open on the old host, which now redirects, so the old origin is effectively retired.

Verify a deploy before running the E2Es: `curl -s "https://kumbara.sembol.xyz/api/anchor/info?cb=$(date +%s)"` must show the vault id from the table below and `/api/health` must answer `ok:true`.

### Environment variables (production)

| Variable | Kind | Value |
| --- | --- | --- |
| `TURSO_DATABASE_URL` | secret | `libsql://kumbara-keyboord01.aws-eu-west-1.turso.io` |
| `TURSO_AUTH_TOKEN` | secret | database token from Turso |
| `SEMBOL_PROJECT_KEY` | secret | relay key (Sembol Cloud project key; today an OpenZeppelin Channels testnet key) |
| `SPONSOR_SECRET` | secret | the sponsor keypair above |
| `BOOTH_ADMIN_TOKEN` | secret | presenter token for `/booth/admin` (12+ characters) |
| `STELLAR_NETWORK`, `NEXT_PUBLIC_STELLAR_NETWORK` | config | `testnet` |
| `NEXT_PUBLIC_SITE_URL` | config | `https://kumbara.sembol.xyz` (booth QR target, page metadata, stats footer; unset on previews) |
| `NEXT_PUBLIC_WEBAUTHN_RP_ID` | config | `kumbara.sembol.xyz` (production only; see Domain) |
| `STELLAR_RPC_URL` | config | `https://soroban-testnet.stellar.org` |
| `ANCHOR_HOME_DOMAINS` | config | `tr-mock-anchor.fly.dev,testanchor.stellar.org`: anchors the presenter can switch between; endpoints, issuer and limits come from each stellar.toml and SEP-6 info (no API key) |
| `ANCHOR_ASSET_CODE` | config | `USDC` |
| `SEMBOL_CLOUD_URL`, `SEMBOL_PROJECT_ID` | config | `https://channels.openzeppelin.com/testnet`, `kumbara` |
| `DEFINDEX_VAULT_ID` | config | `CAT76PQMLGFABA37ETPJDKTYONMY463Z6SINVUMAM7556YKQRPYMKSKL` |
| `SOROSWAP_ENABLED`, `ONRAMP_MODE`, `OFFRAMP_MODE` | config | `false`, `landing`, `landing` |
| `DEPOSIT_TRANSFER_TIMEOUT_MIN` | config | `30` (minutes before the "transfer has not arrived" screen) |
| `BOOTH_START_TS`, `MAINNET_DEMO_ENABLED` | config | `1789794000` (2026-09-19 08:00 Istanbul: the counter and the stats "since event start" window; before that the stats page shows all-time numbers), `false` |
| `RATE_LIMIT_ACCOUNTS_PER_IP_HOUR` | config | `60` (booth Wi-Fi shares one IP) |
| `RATE_LIMIT_ACCOUNTS_PER_REF` | config | `300` (the primary abuse guard) |
| `RATE_LIMIT_RELAY_PER_IP_HOUR` | config | `1000` |
| `SPONSOR_MIN_XLM`, `SPONSOR_MAX_XLM` | config | `3`, `100` |
| `SEED_DEPOSIT_TRY` | config | `250` |

Locally, `.env` uses `TURSO_DATABASE_URL=file:.data/kumbara.db` and no auth token; it is the same code path.

### Function limits

Vercel Hobby with Fluid compute allows up to 300 s per function invocation (default 300 s). Every route declares its own `maxDuration` well below that: the relay forwarder 120 s (it waits for on-chain confirmation), the deposit and withdrawal pollers 120 s (the longest single step, building and locking a landing account, takes about 20 s and must stay in one invocation because the landing key is never persisted), creation routes 60 s, everything else 30 s. Per-record leases last 110 s so a crashed invocation frees the record before the next poll can take over.

### Deployment protection

New Vercel projects protect their generated URLs with Vercel Authentication. That must be off for production, otherwise every request (including the booth QR link) redirects to a Vercel login. It was disabled with the API (`PATCH /v9/projects/kumbara {"ssoProtection": null}`); the dashboard setting is Settings → Deployment Protection.

### Rate limiting on Vercel

Per-IP windows are rows in Turso keyed by a salted hash of the IP; the salt derives from `SEMBOL_PROJECT_KEY`, so every instance hashes the same way and the IP itself is never stored or logged. Without that key the salt is per instance (a documented, weaker fallback). The per-booth-ref cap is the primary guard.

### Verify

```bash
curl -s https://kumbara.sembol.xyz/api/health | jq          # ok:true, database and four dependencies
APP_URL=https://kumbara.sembol.xyz pnpm e2e:onboard        # Chrome + virtual passkey against production
APP_URL=https://kumbara.sembol.xyz pnpm e2e:deposit
APP_URL=https://kumbara.sembol.xyz pnpm e2e:withdraw
```

Measured on 5 September 2026 from Istanbul: first request after deploy (cold) `/api/health` 2.4 s including a 0.58 s Turso round trip; warm requests 0.4–0.9 s; home page 0.67 s.

## Before the event

1. Set the counter start: `vercel env rm BOOTH_START_TS production` then `printf '%s' $(date -d '2026-09-19 08:00:00 +03:00' +%s) | vercel env add BOOTH_START_TS production`, and redeploy (`vercel deploy --prod`).
2. Check the sponsor balance on `/booth/admin` (keep it around 20–50 XLM).
3. Check the four dots on `/booth/admin`; the anchor dot names the anchor and, for the TR Mock Anchor, its treasury USDC.
4. Run the three E2E flows against the production URL once.
5. Open `https://kumbara.sembol.xyz/booth?n=1` on the booth screen.

## Operating

- Logs: `vercel logs kumbara.sembol.xyz --token "$VERCEL_TOKEN"` (landing steps log public keys and hashes only).
- Data: `/api/metrics` for the counts, or Turso's shell (`turso db shell kumbara`) for the `records`, `events`, `leases` and `ratelimit_hits` tables.
- Rotate the sponsor: set a new `SPONSOR_SECRET` and redeploy; landing accounts created by the old key still merge into the old key, so leave it funded for an hour.
- Redeploy: `vercel deploy --prod --yes`. `NEXT_PUBLIC_STELLAR_NETWORK` is baked at build time.

## Alternative: Fly.io (one machine, local libsql file)

`Dockerfile` and `fly.toml` still work: one machine in `fra` with a volume at `/data`, `TURSO_DATABASE_URL=file:/data/kumbara.db`, secrets via `fly secrets set SEMBOL_PROJECT_KEY=… SPONSOR_SECRET=… BOOTH_ADMIN_TOKEN=…`, then `fly deploy`. The same code runs there; leases and rate-limit rows simply live in the local file.
