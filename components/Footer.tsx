"use client";

import { NETWORK } from "@/lib/config";
import { useLocale } from "@/lib/i18n";

export function Footer() {
  const { t } = useLocale();
  return (
    <footer className="mt-auto border-t border-border">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-2 px-4 py-4 lg:max-w-5xl lg:px-8 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p className="font-medium text-ink-2">{NETWORK === "testnet" ? t.footer : t.footerMainnet}</p>
        <nav className="flex gap-4" aria-label="Links">
          <a href="https://github.com/keyboord01/kumbara" target="_blank" rel="noreferrer" className="rounded-sm hover:text-teal">
            GitHub
          </a>
          <a href="https://www.npmjs.com/package/@sembol/passkey-react" target="_blank" rel="noreferrer" className="rounded-sm hover:text-teal">
            @sembol/passkey-react
          </a>
        </nav>
      </div>
    </footer>
  );
}
