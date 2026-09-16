"use client";

import { useEffect, useState } from "react";
import { usePasskeyWallet } from "@sembol/passkey-react";
import { CheckIcon, CopyIcon, Share2Icon } from "lucide-react";
import { Skeleton } from "@/components/Skeleton";
import { useToast } from "@/components/Toaster";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";

interface Invite {
  code: string;
  link: string;
  count: number;
}

/** "Invite a friend": this kumbara's link and how many kumbaras were opened through it. Nothing personal in the link. */
export function InviteCard() {
  const { t } = useLocale();
  const { address } = usePasskeyWallet();
  const { toast } = useToast();
  const [invite, setInvite] = useState<Invite | null>(null);
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  useEffect(() => {
    if (!address) return;
    let alive = true;
    api<Invite>(`/api/referral?contractId=${address}`)
      .then((res) => {
        if (alive) setInvite(res);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [address]);

  const copy = () => {
    if (!invite) return;
    void navigator.clipboard?.writeText(invite.link).then(() => {
      setCopied(true);
      toast({ title: t.toast.copied, body: invite.link, variant: "success", key: "copy" });
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const share = async () => {
    if (!invite) return;
    try {
      await navigator.share({ title: "Kumbara", text: t.invite.shareText, url: invite.link });
    } catch {
      /* dismissed */
    }
  };

  return (
    <Card render={<section aria-label={t.invite.title} />} data-testid="invite-card">
      <CardHeader>
        <CardTitle className="microlabel">{t.invite.title}</CardTitle>
        <CardDescription className="text-ink-2">{t.invite.lead}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {invite ? (
          <>
            <p className="break-all rounded-lg bg-muted p-3 font-mono text-xs text-foreground" data-testid="invite-link">
              {invite.link}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={copy} data-testid="invite-copy">
                {copied ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}
                {t.deposit.copy}
              </Button>
              {canShare ? (
                <Button variant="outline" size="sm" onClick={() => void share()}>
                  <Share2Icon data-icon="inline-start" />
                  {t.invite.share}
                </Button>
              ) : null}
            </div>
            <p className="tnum text-sm font-semibold text-foreground" data-testid="invite-count">
              {t.invite.count.replace("{n}", String(invite.count))}
            </p>
          </>
        ) : (
          <>
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-4 w-40" />
          </>
        )}
      </CardContent>
    </Card>
  );
}
