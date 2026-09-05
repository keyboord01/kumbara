"use client";

import { useLocale } from "@/lib/i18n";

/** Shown when a screen picked an in-flight deposit or withdrawal back up from stored state. */
export function ResumeNotice({ flow }: { flow: "deposit" | "withdraw" }) {
  const { t } = useLocale();
  return (
    <div role="status" data-testid="resume-notice" className="rounded-xl border border-teal/30 bg-teal/5 px-4 py-3 text-sm">
      <p className="font-semibold text-teal">{flow === "deposit" ? t.deposit.resumeTitle : t.withdraw.resume}</p>
      <p className="mt-0.5 text-ink-2">{t.failures.resumedBody}</p>
    </div>
  );
}
