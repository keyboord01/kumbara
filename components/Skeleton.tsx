"use client";

import { useLocale } from "@/lib/i18n";

/** A block that has the shape of what is loading. Width and height come from the caller's classes. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <span className={`skeleton inline-block align-middle ${className}`} aria-hidden>&nbsp;</span>;
}

/** The shape of a flow screen while its record loads: title, amount card, status card. Announced once. */
export function ScreenSkeleton({ label }: { label?: string }) {
  const { t } = useLocale();
  return (
    <div className="flex flex-col gap-5 py-2" role="status" aria-live="polite" aria-label={label ?? t.savings.loading}>
      <div className="flex items-baseline justify-between">
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-4 w-24" />
      </div>
      <div className="card p-5">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-3 h-9 w-40" />
        <Skeleton className="mt-2 h-4 w-56" />
      </div>
      <div className="card p-5">
        <Skeleton className="h-3 w-16" />
        <div className="mt-4 flex flex-col gap-3">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-52" />
        </div>
      </div>
      <span className="sr-only">{label ?? t.savings.loading}</span>
    </div>
  );
}
