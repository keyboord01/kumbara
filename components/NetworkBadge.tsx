"use client";

import { NETWORK } from "@/lib/config";
import { useLocale } from "@/lib/i18n";

/** Every balance and explorer link carries this label. */
export function NetworkBadge({ className = "" }: { className?: string }) {
  const { t } = useLocale();
  const testnet = NETWORK === "testnet";
  return (
    <span
      className={`microlabel inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${testnet ? "border-amber/40 bg-amber/10 text-amber" : "border-mint/40 bg-mint/10 text-mint"} ${className}`}
      aria-label={testnet ? t.network.testnet : t.network.mainnet}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${testnet ? "bg-amber" : "bg-mint"}`} aria-hidden />
      {testnet ? t.network.testnet : t.network.mainnet}
    </span>
  );
}
