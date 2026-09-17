import "server-only";
import { serverEnv } from "./env.server";
import { usdTryRate } from "./reflector.server";

/**
 * The line between "confirmed without anyone pressing anything" and "a person approves it". It is written in
 * dollars, because that is what the amount is worth, and compared in lira, because that is what the visitor
 * typed. The rate is the same one the rest of the app shows; if the oracle is unreachable we fall back to a
 * conservative lira figure rather than letting a large deposit through unchecked.
 */
const FALLBACK_TRY_PER_USD = 40;

export interface AutoConfirmLimit {
  usd: number;
  /** The same limit in lira at the current rate, rounded down to whole lira. */
  try: number;
  rateUsed: number;
}

export async function autoConfirmLimit(): Promise<AutoConfirmLimit> {
  const usd = serverEnv.boothAutoConfirmMaxUsd();
  if (usd <= 0) return { usd: 0, try: 0, rateUsed: 0 };
  const rate = await usdTryRate()
    .then((r) => (Number.isFinite(r.usdTry) && r.usdTry > 0 ? r.usdTry : FALLBACK_TRY_PER_USD))
    .catch(() => FALLBACK_TRY_PER_USD);
  return { usd, try: Math.floor(usd * rate), rateUsed: rate };
}
