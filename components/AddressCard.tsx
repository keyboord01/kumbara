"use client";

import { useWalletAddress } from "@sembol/passkey-react";
import { CheckIcon, CopyIcon, ExternalLinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader } from "@/components/ui/card";
import { NETWORK_LABEL } from "@/lib/config";
import { useLocale } from "@/lib/i18n";
import { NetworkBadge } from "./NetworkBadge";
import { useToast } from "./Toaster";

/** The kumbara's contract address with a network-labeled explorer link. */
export function AddressCard() {
  const { t } = useLocale();
  const { address, displayAddress, explorerUrl, copy, copied } = useWalletAddress();
  const { toast } = useToast();
  if (!address) return null;
  return (
    <Card size="sm">
      <CardHeader>
        <p className="microlabel">{t.savings.address}</p>
        <CardAction>
          <NetworkBadge />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="break-all font-mono text-sm text-foreground" title={address} data-testid="kumbara-address">
          {displayAddress}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              copy();
              toast({ title: t.toast.copied, body: address, variant: "success", key: "copy" });
            }}
          >
            {copied ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}
            {t.deposit.copy}
          </Button>
          {explorerUrl && (
            <Button variant="outline" size="sm" render={<a href={explorerUrl} target="_blank" rel="noreferrer" />}>
              stellar.expert · {NETWORK_LABEL}
              <ExternalLinkIcon data-icon="inline-end" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
