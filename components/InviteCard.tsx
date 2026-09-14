"use client";

import { useEffect, useState } from "react";
import { usePasskeyWallet } from "@sembol/passkey-react";
import { useToast } from "@/components/Toaster";
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
    <section className="card p-5" aria-label={t.invite.title} data-testid="invite-card">
      <p className="microlabel">{t.invite.title}</p>
      <p className="mt-1 text-sm text-ink-2">{t.invite.lead}</p>
      {invite ? (
        <>
          <p className="mt-3 break-all rounded-xl bg-paper-2 p-3 font-mono text-xs text-ink" data-testid="invite-link">
            {invite.link}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={copy} className="btn-chip" data-testid="invite-copy">
              {copied ? "✓" : t.deposit.copy}
            </button>
            {canShare ? (
              <button type="button" onClick={() => void share()} className="btn-chip">
                {t.invite.share}
              </button>
            ) : null}
          </div>
          <p className="tnum mt-3 text-sm font-semibold text-ink" data-testid="invite-count">
            {t.invite.count.replace("{n}", String(invite.count))}
          </p>
        </>
      ) : (
        <p className="mt-3 text-sm text-muted">{t.savings.loading}</p>
      )}
    </section>
  );
}
