# syntax=docker/dockerfile:1.7
# Kumbara on Fly.io: one machine, Next.js standalone output, SQLite on a volume.

FROM node:20-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.21.0 --activate
WORKDIR /app

# Dependencies (better-sqlite3 downloads a prebuilt binary; the toolchain is
# only a fallback for platforms without one).
FROM base AS deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Build. NEXT_PUBLIC_* values are baked into the browser bundle here.
FROM base AS build
ARG NEXT_PUBLIC_STELLAR_NETWORK=testnet
ARG NEXT_PUBLIC_STELLAR_RPC_URL=
ENV NEXT_PUBLIC_STELLAR_NETWORK=$NEXT_PUBLIC_STELLAR_NETWORK NEXT_PUBLIC_STELLAR_RPC_URL=$NEXT_PUBLIC_STELLAR_RPC_URL
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# Runtime: standalone server + static assets, data on /data (volume).
FROM node:20-bookworm-slim AS runner
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 DATA_DIR=/data NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
RUN mkdir -p /data && chown node:node /data
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]
