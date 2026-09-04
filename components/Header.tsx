"use client";

import Link from "next/link";
import { usePasskeyWallet } from "@sembol/passkey-react";
import { useLocale } from "@/lib/i18n";
import { NetworkBadge } from "./NetworkBadge";

export function Header() {
  const { locale, setLocale, t } = useLocale();
  const { isConnected } = usePasskeyWallet();
  return (
    <header className="sticky top-0 z-10 border-b border-line bg-paper/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-xl items-center justify-between gap-3 px-4 py-3">
        <Link href={isConnected ? "/kumbara" : "/"} className="flex items-baseline gap-2">
          <span className="text-lg font-bold tracking-tight text-teal">{t.brand}</span>
          <span className="text-xs text-muted">{t.bySembol}</span>
        </Link>
        <div className="flex items-center gap-2">
          <NetworkBadge />
          <div className="flex overflow-hidden rounded-full border border-line text-xs font-semibold" role="group" aria-label="Language">
            {(["tr", "en"] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLocale(l)}
                aria-pressed={locale === l}
                className={`px-2.5 py-1 uppercase ${locale === l ? "bg-teal text-white" : "bg-white text-ink-2"}`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>
    </header>
  );
}
