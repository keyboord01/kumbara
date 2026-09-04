/**
 * Server-only environment access. Secrets never leave route handlers.
 * Every variable is documented in .env.example.
 */
import "server-only";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing environment variable ${name} (see .env.example)`);
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export type StellarNetwork = "testnet" | "public";

export function stellarNetwork(): StellarNetwork {
  const value = required("STELLAR_NETWORK");
  if (value !== "testnet" && value !== "public") throw new Error("STELLAR_NETWORK must be testnet or public");
  return value;
}

export const serverEnv = {
  anchorBaseUrl: () => required("ANCHOR_BASE_URL").replace(/\/+$/, ""),
  anchorApiKey: () => required("ANCHOR_API_KEY"),
  sembolCloudUrl: () => required("SEMBOL_CLOUD_URL").replace(/\/+$/, ""),
  sembolProjectId: () => required("SEMBOL_PROJECT_ID"),
  sembolProjectKey: () => required("SEMBOL_PROJECT_KEY"),
  stellarNetwork,
  stellarRpcUrl: () => required("STELLAR_RPC_URL"),
  defindexVaultId: () => required("DEFINDEX_VAULT_ID"),
  soroswapEnabled: () => optional("SOROSWAP_ENABLED") === "true",
  boothStartTs: () => Number(optional("BOOTH_START_TS") ?? "0"),
  mainnetDemoEnabled: () => optional("MAINNET_DEMO_ENABLED") === "true",
  onrampMode: () => (optional("ONRAMP_MODE") ?? "landing") as "landing" | "direct",
  offrampMode: () => (optional("OFFRAMP_MODE") ?? "landing") as "landing" | "direct",
  reflectorRpcUrl: () => optional("REFLECTOR_RPC_URL") ?? "https://mainnet.sorobanrpc.com",
  reflectorFxOracle: () => optional("REFLECTOR_FX_ORACLE") ?? "CBKGPWGKSKZF52CFHMTRR23TBWTPMRDIYZ4O2P5VS65BMHYH4DXMCJZC",
};

export function networkPassphrase(): string {
  return stellarNetwork() === "testnet"
    ? "Test SDF Network ; September 2015"
    : "Public Global Stellar Network ; September 2015";
}
