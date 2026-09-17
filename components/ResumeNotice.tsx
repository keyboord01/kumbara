"use client";

import { RotateCwIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useLocale } from "@/lib/i18n";

/** Shown when a screen picked an in-flight deposit or withdrawal back up from stored state. */
export function ResumeNotice({ flow }: { flow: "deposit" | "withdraw" }) {
  const { t } = useLocale();
  return (
    <Alert role="status" data-testid="resume-notice" className="border-teal/30 bg-teal/5">
      <RotateCwIcon className="text-teal" />
      <AlertTitle className="text-teal">{flow === "deposit" ? t.deposit.resumeTitle : t.withdraw.resume}</AlertTitle>
      <AlertDescription className="text-ink-2">{t.failures.resumedBody}</AlertDescription>
    </Alert>
  );
}
