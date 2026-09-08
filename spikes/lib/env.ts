/**
 * Environment access for the Gate 0 spikes. Every variable is documented in
 * .env.example. Missing required variables fail loudly; the spikes never fall
 * back to defaults for secrets, endpoints or the anchor's asset issuer.
 */

export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`\n✗ Missing environment variable ${name}. Copy .env.example to .env and fill it in.\n`);
    process.exit(1);
  }
  return value;
}

export function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export type StellarNetwork = "testnet" | "public";

export function network(): StellarNetwork {
  const value = requireEnv("STELLAR_NETWORK");
  if (value !== "testnet" && value !== "public") {
    console.error(`✗ STELLAR_NETWORK must be "testnet" or "public" (got "${value}")`);
    process.exit(1);
  }
  return value;
}

/** The spikes move real testnet assets around; they refuse to run on mainnet. */
export function assertTestnet(): void {
  if (network() !== "testnet") {
    console.error("✗ The spikes only run on testnet (STELLAR_NETWORK=testnet).");
    process.exit(1);
  }
}

export function rpcUrl(): string {
  return requireEnv("STELLAR_RPC_URL");
}

export function horizonUrl(): string {
  return (
    optionalEnv("STELLAR_HORIZON_URL") ??
    (network() === "testnet" ? "https://horizon-testnet.stellar.org" : "https://horizon.stellar.org")
  );
}

export function networkPassphrase(): string {
  return network() === "testnet"
    ? "Test SDF Network ; September 2015"
    : "Public Global Stellar Network ; September 2015";
}

export function explorerBase(): string {
  return `https://stellar.expert/explorer/${network() === "testnet" ? "testnet" : "public"}`;
}

/** The default anchor's base URL: the first home domain in ANCHOR_HOME_DOMAINS (the app reads everything else from its stellar.toml). */
export const anchorBaseUrl = () => {
  const first = requireEnv("ANCHOR_HOME_DOMAINS").split(",")[0]!.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `https://${first}`;
};

export const sembolEnv = () => ({
  url: requireEnv("SEMBOL_CLOUD_URL"),
  projectId: requireEnv("SEMBOL_PROJECT_ID"),
  projectKey: requireEnv("SEMBOL_PROJECT_KEY"),
});
