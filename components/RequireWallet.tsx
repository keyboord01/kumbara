"use client";

import Link from "next/link";
import { usePasskeyWallet } from "@sembol/passkey-react";
import { useLocale } from "@/lib/i18n";

/** Gate for kumbara-only screens. */
export function RequireWallet({ children }: { children: React.ReactNode }) {
  const { status, isConnected } = usePasskeyWallet();
  const { t } = useLocale();
  if (status === "initializing") {
    return (
      <p className="py-16 text-center text-sm text-muted" role="status">
        {t.savings.loading}
      </p>
    );
  }
  if (!isConnected) {
    return (
      <div className="card mx-auto flex max-w-md flex-col items-center gap-4 p-8 text-center">
        <p className="text-sm text-ink-2">{t.savings.notConnected}</p>
        <Link href="/" className="btn-primary">
          {t.savings.open}
        </Link>
      </div>
    );
  }
  return <>{children}</>;
}
