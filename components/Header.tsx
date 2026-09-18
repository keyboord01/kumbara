"use client";

import Link from "next/link";
import { usePasskeyWallet } from "@sembol/passkey-react";
import { PiggyBankIcon } from "lucide-react";
import { SignOut } from "./SignOut";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useLocale } from "@/lib/i18n";
import { HeaderNav } from "./Nav";
import { NetworkBadge } from "./NetworkBadge";

export function Header() {
  const { locale, setLocale, t } = useLocale();
  const { isConnected } = usePasskeyWallet();
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-xl items-center justify-between gap-3 px-4 py-3.5 lg:max-w-5xl">
        <Link href={isConnected ? "/kumbara" : "/"} className="flex min-w-0 items-baseline gap-2 rounded-md">
          <PiggyBankIcon className="size-5 self-center text-rose" aria-hidden />
          <span className="text-lg font-bold tracking-tight text-plum">{t.brand}</span>
          <span className="hidden whitespace-nowrap text-xs text-muted-foreground min-[400px]:inline">{t.bySembol}</span>
        </Link>
        <HeaderNav />
        <div className="flex items-center gap-2">
          {/* Every balance and explorer link carries its own TESTNET label, so the header keeps one
              only where there is room for it; on a phone it crowded the wordmark off its own row. */}
          <span className="hidden sm:inline-flex">
            <NetworkBadge />
          </span>
          <SignOut variant="icon" />
          <ToggleGroup
            variant="segment"
            size="xs"
            spacing={0.5}
            value={[locale]}
            onValueChange={(value) => {
              const next = value[0];
              if (next === "tr" || next === "en") setLocale(next);
            }}
            aria-label="Language"
          >
            {(["tr", "en"] as const).map((l) => (
              <ToggleGroupItem key={l} value={l} aria-label={l}>
                {l}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </div>
    </header>
  );
}
