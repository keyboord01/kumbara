"use client";

import Link from "next/link";
import { RequireWallet } from "@/components/RequireWallet";
import { useLocale } from "@/lib/i18n";

export default function SoonPage() {
  const { t } = useLocale();
  return (
    <RequireWallet>
      <div className="card mx-auto flex max-w-md flex-col gap-3 p-8 text-center">
        <p className="text-lg font-semibold">{t.soon.title}</p>
        <p className="text-sm text-ink-2">{t.soon.body}</p>
        <Link href="/kumbara" className="btn-secondary mx-auto">
          {t.soon.back}
        </Link>
      </div>
    </RequireWallet>
  );
}
