"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { classifyError, type Failure } from "./failures";

export interface AnchorInfo {
  network: "testnet" | "public";
  networkPassphrase: string;
  explorerBase: string;
  usdc: { code: string; issuer: string; contractId: string };
  vault: { id: string };
  treasury: string | null;
  treasuryUsdc: string | null;
  /** Which anchor the server uses for new requests, with the limits it publishes (SEP-6 /info in the asset; lira limits when the anchor states them). */
  anchor?: { homeDomain: string; orgName: string | null; fiatCode: string | null; limits?: { deposit: { min: number | null; max: number | null }; withdraw: { min: number | null; max: number | null }; fiat: { min: number | null; max: number | null; source: "anchor" | "derived" } | null } };
  /** Deposits at or below this many lira are confirmed without anyone pressing anything. */
  autoConfirmMaxTry?: number;
  onrampMode: "landing" | "direct";
  offrampMode: "landing" | "direct";
}

let cached: AnchorInfo | null = null;
let cachedAt = 0;
/** The presenter can switch anchors at the booth; a screen opened after that must see the new anchor's limits within a minute. */
const CACHE_MS = 60_000;

/**
 * Discovery data from /api/anchor/info (USDC issuer from the anchor's toml,
 * vault id). A failure is classified (anchor down, Vercel login page, offline)
 * so screens can show the matching state; `retry` fetches again.
 */
export function useAnchorInfo(): { info: AnchorInfo | null; error: string | null; failure: Failure | null; retry: () => void } {
  const [info, setInfo] = useState<AnchorInfo | null>(() => (Date.now() - cachedAt < CACHE_MS ? cached : null));
  const [failure, setFailure] = useState<Failure | null>(null);
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    if (cached && Date.now() - cachedAt < CACHE_MS) return;
    let alive = true;
    api<AnchorInfo>("/api/anchor/info")
      .then((body) => {
        cached = body;
        cachedAt = Date.now();
        if (alive) setInfo(body);
      })
      .catch((err: unknown) => {
        if (alive) setFailure(classifyError(err, "anchor"));
      });
    return () => {
      alive = false;
    };
  }, [epoch]);
  const retry = useCallback(() => {
    setFailure(null);
    setEpoch((e) => e + 1);
  }, []);
  return { info, error: failure?.detail ?? null, failure, retry };
}
