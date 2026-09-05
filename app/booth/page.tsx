"use client";

import { Suspense, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import QRCode from "qrcode";
import { NETWORK, SITE_URL } from "@/lib/config";
import { useLocale } from "@/lib/i18n";

interface Metrics {
  accounts: { sinceStart: number; total: number };
  since: number;
}

/** Full-screen QR to the onboarding URL with ?ref=booth-<n>, plus the live account counter. */
function Booth() {
  const { t } = useLocale();
  const n = useSearchParams().get("n") ?? "1";
  const ref = `booth-${n.replace(/[^a-z0-9-]/gi, "").slice(0, 16) || "1"}`;
  const origin = useSyncExternalStore(
    () => () => undefined,
    () => window.location.origin,
    () => "",
  );
  const [svg, setSvg] = useState("");
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  // The QR points at the canonical site (NEXT_PUBLIC_SITE_URL) when configured, else at this origin. The
  // link carries the network so a build for the other network refuses it (components/NetworkGuard.tsx).
  const base = SITE_URL || origin;
  const url = useMemo(() => (base ? `${base}/?ref=${ref}&net=testnet` : ""), [base, ref]);

  useEffect(() => {
    if (!url) return;
    QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 1, color: { dark: "#12313a", light: "#fbf7f0" } })
      .then(setSvg)
      .catch(() => setSvg(""));
  }, [url]);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/metrics")
        .then((r) => (r.ok ? (r.json() as Promise<Metrics>) : null))
        .then((m) => alive && m && setMetrics(m))
        .catch(() => undefined);
    void load();
    const id = setInterval(load, 10_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (NETWORK !== "testnet") {
    return (
      <div className="m-auto max-w-md p-8 text-center">
        <p className="text-lg font-semibold">{t.booth.mainnetRefused}</p>
      </div>
    );
  }

  return (
    <div className="m-auto flex w-full max-w-lg flex-col items-center gap-6 px-6 py-10 text-center">
      <p className="text-3xl font-bold tracking-tight text-teal">{t.booth.title}</p>
      <div className="w-full max-w-sm rounded-3xl bg-white p-4 shadow-sm" aria-label={url} dangerouslySetInnerHTML={{ __html: svg }} />
      <p className="microlabel">
        {t.network.testnet} · {ref}
      </p>
      <p className="break-all font-mono text-xs text-muted">{url}</p>
      <div className="mt-2">
        <p className="tnum text-7xl font-bold leading-none text-ink" data-testid="booth-counter">
          {metrics ? metrics.accounts.sinceStart : "–"}
        </p>
        <p className="mt-2 text-sm text-ink-2">{t.booth.counter}</p>
      </div>
      <p className="mt-auto text-xs text-muted">{t.footer}</p>
    </div>
  );
}

export default function BoothPage() {
  return (
    <Suspense fallback={null}>
      <Booth />
    </Suspense>
  );
}
