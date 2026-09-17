"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocale } from "@/lib/i18n";

export { Skeleton };

/** The shape of a flow screen while its record loads: title, amount card, status card. Announced once. */
export function ScreenSkeleton({ label }: { label?: string }) {
  const { t } = useLocale();
  return (
    <div className="flex flex-col gap-5 py-2" role="status" aria-live="polite" aria-label={label ?? t.savings.loading}>
      <div className="flex items-baseline justify-between">
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-4 w-24" />
      </div>
      <Card>
        <CardHeader>
          <Skeleton className="h-3 w-24" />
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-4 w-56" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <Skeleton className="h-3 w-16" />
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {/* The shape of the status column: a route strip, then the steps, so nothing jumps when it arrives. */}
          <Skeleton className="h-8 w-full rounded-full" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-52" />
        </CardContent>
      </Card>
      <span className="sr-only">{label ?? t.savings.loading}</span>
    </div>
  );
}
