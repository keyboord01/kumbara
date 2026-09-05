"use client";

import { useSyncExternalStore } from "react";
import { useLocale } from "@/lib/i18n";

function subscribe(callback: () => void): () => void {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

/** Sticky notice while the browser reports no connection; polling resumes on its own. */
export function OfflineBanner() {
  const { t } = useLocale();
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
  if (online) return null;
  return (
    <div role="status" aria-live="polite" data-testid="offline-banner" className="border-b border-amber/40 bg-amber/10 px-4 py-2 text-center text-sm text-ink">
      <strong>{t.failures.kinds.offline.title}</strong> {t.failures.offlineBanner}
    </div>
  );
}
