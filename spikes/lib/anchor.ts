/**
 * SEP-1 discovery for the spikes: the anchor's stellar.toml gives the asset
 * issuer and every SEP endpoint. Nothing about the anchor is hardcoded. (The
 * Partner API client that used to live here went with the API itself.)
 */
export interface StellarTomlInfo {
  raw: string;
  usdc: { code: string; issuer: string };
  endpoints: Record<string, string>;
  networkPassphrase: string;
}

export async function fetchStellarToml(baseUrl: string): Promise<StellarTomlInfo> {
  const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/.well-known/stellar.toml`);
  if (!res.ok) throw new Error(`stellar.toml fetch failed: ${res.status}`);
  const raw = await res.text();
  const endpoints: Record<string, string> = {};
  for (const key of ["WEB_AUTH_ENDPOINT", "TRANSFER_SERVER", "KYC_SERVER", "ANCHOR_QUOTE_SERVER", "SIGNING_KEY"]) {
    const m = raw.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, "m"));
    if (m?.[1]) endpoints[key] = m[1].replace(/\/+$/, "");
  }
  const networkPassphrase = raw.match(/^NETWORK_PASSPHRASE\s*=\s*"([^"]+)"/m)?.[1] ?? "";
  const blocks = raw.split("[[CURRENCIES]]").slice(1);
  const usdcBlock = blocks.find((b) => /^code\s*=\s*"USDC"/m.test(b));
  const issuer = usdcBlock?.match(/^issuer\s*=\s*"([^"]+)"/m)?.[1];
  if (!issuer) throw new Error("stellar.toml has no USDC currency block");
  return { raw, usdc: { code: "USDC", issuer }, endpoints, networkPassphrase };
}
