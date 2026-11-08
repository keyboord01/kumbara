"use client";

import { useEffect, useState } from "react";
import { usePasskeyWallet } from "@sembol/passkey-react";
import { ExternalLinkIcon } from "lucide-react";
import { Spinner } from "@/components/Spinner";
import { useToast } from "@/components/Toaster";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError, api } from "@/lib/api";
import { EXPLORER_BASE, NETWORK } from "@/lib/config";
import { useLocale } from "@/lib/i18n";

interface Allowance {
  enabled: boolean;
  grantUsdc: number;
  used: number;
  remaining: number;
  nextAt: string | null;
}

type RefusalKey = "account_limit" | "cooldown" | "daily_limit" | "ip_limit" | "pool_empty" | "not_a_kumbara" | "not_configured" | "generic";

/**
 * Self-serve test money on testnet: one tap sends a capped amount of test USDC
 * from the pool to this kumbara (POST /api/testfunds), so nobody has to fund a
 * new user by hand. It lands in the account, where the Savings screen's
 * "put it in the vault" takes over. Labelled as test money everywhere it shows.
 */
export function TestFundsCard({ onGranted }: { onGranted: () => void }) {
  const { t, locale } = useLocale();
  const { address } = usePasskeyWallet();
  const { toast } = useToast();
  const [allowance, setAllowance] = useState<Allowance | null>(null);
  const [sending, setSending] = useState(false);
  const [refusal, setRefusal] = useState<RefusalKey | null>(null);
  const [lastHash, setLastHash] = useState<string | null>(null);

  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    if (!address) return;
    let alive = true;
    api<Allowance>(`/api/testfunds?contractId=${address}`)
      .then((next) => {
        if (alive) setAllowance(next);
      })
      .catch(() => {
        if (alive) setAllowance(null);
      });
    return () => {
      alive = false;
    };
  }, [address, epoch]);

  if (NETWORK !== "testnet" || !allowance?.enabled) return null;

  const amount = String(allowance.grantUsdc);
  const time = allowance.nextAt ? new Date(allowance.nextAt).toLocaleString(locale === "tr" ? "tr-TR" : "en-GB", { dateStyle: "medium", timeStyle: "short" }) : "";
  const canAsk = allowance.remaining > 0 && !allowance.nextAt;

  const ask = async () => {
    if (!address) return;
    setSending(true);
    setRefusal(null);
    try {
      const grant = await api<{ hash: string; amountUsdc: string; allowance: Allowance }>("/api/testfunds", { method: "POST", body: JSON.stringify({ contractId: address }) });
      setLastHash(grant.hash);
      setAllowance(grant.allowance);
      toast({ title: t.testFunds.done, body: t.testFunds.doneHint, variant: "success", key: "testfunds" });
      onGranted();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "generic";
      setRefusal((code in t.testFunds.refused ? code : "generic") as RefusalKey);
      setEpoch((e) => e + 1);
    } finally {
      setSending(false);
    }
  };

  return (
    <Card size="sm" data-testid="testfunds-card" render={<section aria-label={t.testFunds.title} />}>
      <CardHeader>
        <CardTitle className="microlabel">{t.testFunds.title}</CardTitle>
        <CardAction>
          <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-300">
            {t.testFunds.badge}
          </Badge>
        </CardAction>
        <CardDescription className="text-ink-2">{t.testFunds.lead.replace("{amount}", amount)}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {refusal ? (
          <Alert variant="destructive" data-testid="testfunds-refused" data-code={refusal}>
            <AlertDescription>{t.testFunds.refused[refusal].replace("{time}", time)}</AlertDescription>
          </Alert>
        ) : null}
        {lastHash ? (
          <a href={`${EXPLORER_BASE}/tx/${lastHash}`} target="_blank" rel="noreferrer" data-testid="testfunds-tx" className="inline-flex items-center gap-1 text-plum underline-offset-2 hover:underline">
            {t.testFunds.tx} <ExternalLinkIcon className="size-3.5" aria-hidden />
          </a>
        ) : null}
        <p className="text-muted-foreground" data-testid="testfunds-allowance">
          {allowance.remaining <= 0 ? t.testFunds.used : allowance.nextAt ? t.testFunds.nextAt.replace("{time}", time) : allowance.remaining === 1 ? t.testFunds.remainingOnce : t.testFunds.remaining.replace("{n}", String(allowance.remaining))}
        </p>
      </CardContent>
      {canAsk ? (
        <CardFooter>
          <Button className="w-full" onClick={() => void ask()} disabled={sending} data-testid="testfunds-button">
            {sending ? <Spinner data-icon="inline-start" /> : null}
            {sending ? t.testFunds.sending : t.testFunds.button.replace("{amount}", amount)}
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  );
}
