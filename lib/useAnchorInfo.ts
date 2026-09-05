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
  onrampMode: "landing" | "direct";
  offrampMode: "landing" | "direct";
}

let cached: AnchorInfo | null = null;

/**
 * Discovery data from /api/anchor/info (USDC issuer from the anchor's toml,
 * vault id). A failure is classified (anchor down, Vercel login page, offline)
 * so screens can show the matching state; `retry` fetches again.
 */
export function useAnchorInfo(): { info: AnchorInfo | null; error: string | null; failure: Failure | null; retry: () => void } {
  const [info, setInfo] = useState<AnchorInfo | null>(cached);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    if (cached) return;
    let alive = true;
    api<AnchorInfo>("/api/anchor/info")
      .then((body) => {
        cached = body;
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
