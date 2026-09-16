"use client";

import Link from "next/link";
import { usePasskeyWallet } from "@sembol/passkey-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useLocale } from "@/lib/i18n";
import { ScreenSkeleton } from "./Skeleton";

/** Gate for kumbara-only screens. */
export function RequireWallet({ children }: { children: React.ReactNode }) {
  const { status, isConnected } = usePasskeyWallet();
  const { t } = useLocale();
  if (status === "initializing") return <ScreenSkeleton />;
  if (!isConnected) {
    return (
      <Card className="mx-auto max-w-md">
        <CardContent className="flex flex-col items-center gap-4 py-3 text-center">
          <p className="text-sm text-ink-2">{t.savings.notConnected}</p>
          <Button size="xl" render={<Link href="/" />}>
            {t.savings.open}
          </Button>
        </CardContent>
      </Card>
    );
  }
  return <>{children}</>;
}
