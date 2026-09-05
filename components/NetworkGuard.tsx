"use client";

import { useSyncExternalStore } from "react";
import { FailureScreen } from "@/components/FailureScreen";
import { NETWORK, NETWORK_LABEL } from "@/lib/config";
import { useLocale } from "@/lib/i18n";
import { useAnchorInfo } from "@/lib/useAnchorInfo";

/** `?net=testnet|mainnet|public` on the link, when a QR or a share carried it. */
function readLinkNetwork(): "testnet" | "public" | null {
  const raw = new URLSearchParams(window.location.search).get("net")?.toLowerCase();
  if (raw === "testnet") return "testnet";
  if (raw === "mainnet" || raw === "public") return "public";
  return null;
}

/**
 * Blocks the app when the link, the browser build and the server disagree on
 * the network, or when the server answers with Vercel's login page. Renders
 * nothing otherwise.
 */
export function NetworkGuard({ children }: { children: React.ReactNode }) {
  const { t } = useLocale();
  const { info, failure } = useAnchorInfo();
  const linkNetwork = useSyncExternalStore(
    () => () => undefined,
    readLinkNetwork,
    () => null,
  );
  const label = (network: "testnet" | "public") => (network === "testnet" ? t.network.testnet : t.network.mainnet);

  if (failure && failure.kind === "deployment_protected") {
    return (
      <div className="py-6">
        <FailureScreen failure={failure} primary={null} />
      </div>
    );
  }
  const serverNetwork = info?.network ?? null;
  const mismatch = (linkNetwork && linkNetwork !== NETWORK ? linkNetwork : null) ?? (serverNetwork && serverNetwork !== NETWORK ? serverNetwork : null);
  if (mismatch) {
    return (
      <div className="py-6">
        <FailureScreen
          failure={{
            kind: "wrong_network",
            values: { linkNetwork: label(mismatch), appNetwork: NETWORK_LABEL },
            detail: `link/server network: ${mismatch}; browser build: ${NETWORK}; server: ${serverNetwork ?? "unknown"}`,
          }}
          primary={{ label: t.failures.kinds.wrong_network.action, href: "/" }}
        />
      </div>
    );
  }
  return <>{children}</>;
}
