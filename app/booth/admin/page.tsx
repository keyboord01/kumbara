"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n";

interface Pending {
  id: string;
  contractId: string;
  amountTry: string;
  createdAt: string;
  reference: string;
}

interface PlayResult {
  depositId: string;
  reference: string;
  amountTry: string;
  transferId: string;
  transferStatus: string;
}

/**
 * Presenter-only. One button that plays the bank for the newest pending
 * deposit (the same code path as `pnpm demo:deposit`). The admin token is
 * taken from ?token= (removed from the URL immediately) or typed in, kept in
 * component state only, and sent as a bearer header. Not linked anywhere.
 */
export default function BoothAdminPage() {
  const { t } = useLocale();
  const [token, setToken] = useState("");
  const [pending, setPending] = useState<Pending[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PlayResult | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get("token");
    if (fromUrl) {
      setToken(fromUrl);
      url.searchParams.delete("token");
      window.history.replaceState({}, "", url.pathname + (url.search ? url.search : ""));
    }
  }, []);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch("/api/booth/admin/pending", { headers: { authorization: `Bearer ${token}` } });
      const body = (await res.json()) as { pending?: Pending[]; error?: { message: string } };
      if (!res.ok) throw new Error(body.error?.message ?? `HTTP ${res.status}`);
      setPending(body.pending ?? []);
      setError(null);
    } catch (err) {
      setPending(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    void load();
    const id = setInterval(() => void load(), 5000);
    return () => clearInterval(id);
  }, [token, load]);

  const play = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/booth/admin/play-bank", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: "{}" });
      const body = (await res.json()) as PlayResult & { error?: { message: string } };
      if (!res.ok) throw new Error(body.error?.message ?? `HTTP ${res.status}`);
      setResult(body);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const newest = pending?.[0] ?? null;

  return (
    <div className="flex flex-col gap-5 py-2">
      <h1 className="text-2xl font-bold tracking-tight">{t.admin.title}</h1>
      <p className="text-sm text-ink-2">{t.admin.lead}</p>

      {!token && (
        <form
          className="card flex flex-col gap-3 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            const value = (new FormData(e.currentTarget).get("token") as string | null)?.trim() ?? "";
            if (value) setToken(value);
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            <span className="microlabel">{t.admin.tokenLabel}</span>
            <input name="token" type="password" autoComplete="off" className="rounded-xl border border-line bg-paper px-3 py-2 font-mono" />
          </label>
          <button type="submit" className="btn-secondary">
            {t.admin.tokenSubmit}
          </button>
        </form>
      )}

      {token && (
        <section className="card flex flex-col gap-4 p-5" aria-live="polite">
          <div>
            <p className="microlabel">{t.admin.newest}</p>
            {pending === null ? (
              <p className="mt-1 text-sm text-muted">{t.savings.loading}</p>
            ) : newest ? (
              <div className="mt-1 text-sm">
                <p className="font-mono font-semibold">{newest.reference}</p>
                <p className="tnum text-ink-2">
                  ₺{newest.amountTry} · {newest.contractId.slice(0, 6)}…{newest.contractId.slice(-4)} · {new Date(newest.createdAt).toLocaleTimeString()}
                </p>
                {pending.length > 1 && <p className="text-xs text-muted">+{pending.length - 1} {t.admin.more}</p>}
              </div>
            ) : (
              <p className="mt-1 text-sm text-muted">{t.admin.none}</p>
            )}
          </div>
          <button type="button" onClick={() => void play()} disabled={busy || !newest} className="btn-primary w-full text-lg">
            {busy ? t.savings.loading : t.admin.play}
          </button>
          {result && (
            <p className="rounded-xl bg-mint/10 p-3 text-sm text-mint" role="status">
              {t.admin.played} ₺{result.amountTry} · {result.reference} · {result.transferStatus}
            </p>
          )}
          {error && (
            <p className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger" role="alert">
              {error}
            </p>
          )}
          <button type="button" onClick={() => setToken("")} className="text-xs text-muted hover:underline">
            {t.admin.forget}
          </button>
        </section>
      )}
    </div>
  );
}
