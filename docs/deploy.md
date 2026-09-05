# Deploying Kumbara to Fly.io

One machine, one volume, SQLite. Everything non-secret is in `fly.toml`; the image is built from the `Dockerfile` (Next.js standalone output, Node 20, `better-sqlite3`).

## Prerequisites

- `flyctl` installed and logged in (`fly auth login`).
- A Fly organisation with billing enabled (one `shared-cpu-1x` machine with 1 GB RAM and a 1 GB volume).
- The values for the four secrets below.

## Secrets

| Secret | What it is | Where it comes from |
| --- | --- | --- |
| `ANCHOR_API_KEY` | TR Mock Anchor Partner API key (`trma_test_…`) | the anchor dashboard, one per email account |
| `SEMBOL_PROJECT_KEY` | Relay key sent as `Authorization: Bearer` to `SEMBOL_CLOUD_URL` | Sembol Cloud project key; until it exists, an OpenZeppelin Channels testnet key from `https://channels.openzeppelin.com/testnet/gen` |
| `SPONSOR_SECRET` | Classic account (`S…`) that sponsors landing-account reserves and pays their setup fees | generate one (`stellar keys generate`), fund it with a few XLM; it never holds user funds |
| `BOOTH_ADMIN_TOKEN` | Presenter token for `/booth/admin` (12+ characters) | generate one (`openssl rand -base64 18`) |

Everything else (network, RPC, anchor base URL, relay URL, vault id, modes, booth start timestamp, rate limits, sponsor bounds) lives in `fly.toml` under `[env]` and can be changed with `fly deploy` or `fly secrets set` (secrets win over `[env]`).

## First deployment

```bash
# 1. Create the app from the checked-in config (no deploy yet).
fly launch --no-deploy --copy-config --name kumbara --region fra

# 2. The volume that holds /data (records, counter events).
fly volumes create kumbara_data --region fra --size 1 --yes

# 3. Secrets.
fly secrets set \
  ANCHOR_API_KEY=trma_test_... \
  SEMBOL_PROJECT_KEY=... \
  SPONSOR_SECRET=S... \
  BOOTH_ADMIN_TOKEN=...

# 4. Build and deploy the image.
fly deploy

# 5. Verify.
curl -s https://kumbara.fly.dev/api/health | jq
open https://kumbara.fly.dev/booth/admin?token=...   # paste the token once; it leaves the URL immediately
```

`/api/health` must return `ok: true` and four green dependencies (anchor, relay, rpc, vault). The admin console shows the same four plus the sponsor balance.

## Before the event

1. Set the counter start: `fly secrets set BOOTH_START_TS=$(date -d '2026-09-19 08:00:00 +03:00' +%s)` (or edit `fly.toml` and deploy).
2. Fund the sponsor to about 20 XLM (enough for six concurrent deposits): on testnet use the "Fund via Friendbot" button on `/booth/admin`; on mainnet send XLM to the address shown there. Onboarding pauses automatically below `SPONSOR_MIN_XLM`.
3. Check the anchor's treasury balance on the admin console's anchor dot (it shows the treasury USDC); ask the anchor team to refill if it is low.
4. Run the browser round trip against the deployed URL once: `APP_URL=https://kumbara.fly.dev pnpm e2e:deposit` (needs the same `.env` values locally).
5. Open `/booth?n=1` on the booth screen. Each booth gets its own `n`; the QR encodes `?ref=booth-<n>` and the counter credits that ref.

## Operating

- Logs: `fly logs`. Landing-account steps log only public keys and hashes.
- Records: `fly ssh console -C "sqlite3 /data/kumbara.sqlite 'select kind,status,count(*) from records group by 1,2'"` (install `sqlite3` in the image if you need it often; the data is also exposed by `/api/metrics`).
- Backups: `fly volumes snapshots list kumbara_data` (daily automatic snapshots) or copy `/data/kumbara.sqlite` with `fly ssh sftp get`.
- Rotate the sponsor: set a new `SPONSOR_SECRET` and deploy; landing accounts created by the old key still merge into the old key at cleanup, so leave it funded for an hour.
- Rate limits: `RATE_LIMIT_ACCOUNTS_PER_IP_HOUR`, `RATE_LIMIT_ACCOUNTS_PER_REF`, `RATE_LIMIT_RELAY_PER_IP_HOUR` in `fly.toml`.
- One machine only: the per-record locks are in memory. Do not scale to two machines without moving the locks and SQLite.

## Redeploying

`fly deploy` builds a new image and replaces the machine; the volume persists. The build bakes `NEXT_PUBLIC_STELLAR_NETWORK` from `[build.args]`, so a network change needs a rebuild.
