"use client";

import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { NETWORK } from "@/lib/config";
import { useLocale } from "@/lib/i18n";

/** Every balance and explorer link carries this label. */
export function NetworkBadge({ className = "" }: { className?: string }) {
  const { t } = useLocale();
  const testnet = NETWORK === "testnet";
  const label = testnet ? t.network.testnet : t.network.mainnet;
  return (
    <Badge variant={testnet ? "warning" : "success"} className={cn("font-mono text-[11px] tracking-[0.12em] uppercase", className)} aria-label={label}>
      <span className={cn("size-1.5 rounded-full", testnet ? "bg-amber" : "bg-mint")} aria-hidden />
      {label}
    </Badge>
  );
}
