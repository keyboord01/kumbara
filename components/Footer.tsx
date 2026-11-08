"use client";

import { FeedbackButton } from "@/components/FeedbackButton";
import { StatusLine } from "@/components/StatusLine";
import { NETWORK } from "@/lib/config";
import { useLocale } from "@/lib/i18n";

export function Footer() {
  const { t } = useLocale();
  return (
    <footer className="mt-auto border-t border-border">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-2 px-4 py-4 lg:max-w-5xl lg:px-8 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <p className="font-medium text-ink-2">{NETWORK === "testnet" ? t.footer : t.footerMainnet}</p>
          <StatusLine />
        </div>
        <nav className="flex items-center gap-4" aria-label="Links">
          <FeedbackButton className="h-auto px-0 text-xs" />
          <a href="https://github.com/keyboord01/kumbara" target="_blank" rel="noreferrer" className="rounded-sm hover:text-plum">
            GitHub
          </a>
          <a href="https://www.npmjs.com/package/@sembol/passkey-react" target="_blank" rel="noreferrer" className="rounded-sm hover:text-plum">
            @sembol/passkey-react
          </a>
        </nav>
      </div>
    </footer>
  );
}
