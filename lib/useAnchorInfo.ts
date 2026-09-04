"use client";

import { useEffect, useState } from "react";

export interface AnchorInfo {
  network: "testnet" | "public";
  networkPassphrase: string;
  explorerBase: string;
  usdc: { code: string; issuer: string; contractId: string };
  vault: { id: string };
  treasury: string | null;
  onrampMode: "landing" | "direct";
  offrampMode: "landing" | "direct";
}

let cached: AnchorInfo | null = null;

/** Discovery data from /api/anchor/info (USDC issuer from the anchor's toml, vault id). */
export function useAnchorInfo(): { info: AnchorInfo | null; error: string | null } {
  const [info, setInfo] = useState<AnchorInfo | null>(cached);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (cached) return;
    let alive = true;
    fetch("/api/anchor/info")
      .then(async (res) => {
        const body = (await res.json()) as AnchorInfo & { error?: string };
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        cached = body;
        if (alive) setInfo(body);
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, []);
  return { info, error };
}
