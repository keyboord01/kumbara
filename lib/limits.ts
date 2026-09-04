/**
 * Default spending limit installed at onboarding.
 *
 * The OpenZeppelin spending-limit policy caps the total transferred within a
 * rolling window of `period_ledgers` ledgers; it has no per-destination
 * allowlist, so the vault and landing accounts cannot be exempted. Kumbara
 * therefore uses a one-ledger window (about five seconds), which behaves as a
 * per-transaction cap: 1,000 USDC. It applies to every USDC leaving the
 * kumbara, vault deposits included. Users can change it on the security page.
 */
export const DEFAULT_LIMIT_USDC = "1000";
export const DEFAULT_LIMIT_PERIOD = { ledgers: 1 } as const;
