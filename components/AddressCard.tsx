"use client";

import { useWalletAddress } from "@sembol/passkey-react";
import { NETWORK_LABEL } from "@/lib/config";
import { useLocale } from "@/lib/i18n";
import { NetworkBadge } from "./NetworkBadge";

/** The kumbara's contract address with a network-labeled explorer link. */
export function AddressCard() {
  const { t } = useLocale();
  const { address, displayAddress, explorerUrl, copy, copied } = useWalletAddress();
  if (!address) return null;
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="microlabel">{t.savings.address}</p>
        <NetworkBadge />
      </div>
      <p className="mt-2 break-all font-mono text-sm text-ink" title={address}>
        {displayAddress}
      </p>
      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        <button type="button" onClick={copy} className="btn-secondary min-h-9 px-3 text-xs">
          {copied ? "✓" : "Copy"}
        </button>
        {explorerUrl && (
          <a href={explorerUrl} target="_blank" rel="noreferrer" className="btn-secondary min-h-9 px-3 text-xs">
            stellar.expert · {NETWORK_LABEL}
          </a>
        )}
      </div>
    </div>
  );
}
