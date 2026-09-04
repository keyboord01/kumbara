/**
 * Public testnet infrastructure addresses used by the spikes.
 *
 * None of these are secrets and none belong to the anchor (the anchor's
 * endpoints and USDC issuer are always read from its stellar.toml / health).
 * Env variables override every value.
 *
 * Provenance:
 * - Smart-account contract set: smart-account-kit
 *   docs/deployments-protocol-27-2026-07-09.md (same values as
 *   SEMBOL_TESTNET_ARTIFACTS in @sembol/passkey-react).
 * - DeFindex factory: paltalabs/defindex public/testnet.contracts.json.
 * - Soroswap router/factory: soroswap/core public/testnet.contracts.json.
 */
import { optionalEnv } from "./env";

export const SMART_ACCOUNT_TESTNET = {
  accountWasmHash: "1b5f4534a76322da2ad7c745f6900857a6802b0ca79850c35a03561df997785a",
  webauthnVerifierAddress: "CC7EKIHQP3TN4CARQDND6CEOY2UXLWWC2X5GHTD5NLAT7BG5GPZIOM3F",
  ed25519VerifierAddress: "CAAVTMCBXEIBPR64EAASKFXERVPYFZA2JYP5A3BG6PESWEFUJX5IHKN4",
  spendingLimitPolicyAddress: "CABXBYJNZ7IUW4G3D6BND5YCAQF3ASSDMDAOKQQ63UYFSO7WUU2TIP5G",
  nativeTokenContract: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
} as const;

export const defindexFactoryId = () =>
  optionalEnv("DEFINDEX_FACTORY_ID") ?? "CDSCWE4GLNBYYTES2OCYDFQA2LLY4RBIAX6ZI32VSUXD7GO6HRPO4A32";

export const soroswapRouterId = () =>
  optionalEnv("SOROSWAP_ROUTER_ID") ?? "CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD";

export const soroswapFactoryId = () =>
  optionalEnv("SOROSWAP_FACTORY_ID") ?? "CDP3HMUH6SMS3S7NPGNDJLULCOXXEPSHY4JKUKMBNQMATHDHWXRRJTBY";

export const FRIENDBOT_URL = "https://friendbot.stellar.org";
