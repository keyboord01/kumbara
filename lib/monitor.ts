/**
 * Browser side of the pilot instrumentation (server: lib/monitor.server.ts).
 * Reports are fire-and-forget, deduplicated per tab, and carry only coarse
 * context: the page path, the browser family, the OS, phone or not, and the
 * language. Never an address, a key or the user agent string itself.
 */
import type { Failure } from "./failures";

export interface ClientContext {
  path: string;
  browser: string;
  os: string;
  mobile: boolean;
  locale: string;
}

function browserFamily(ua: string): string {
  if (/Edg\//.test(ua)) return "Edge";
  if (/SamsungBrowser\//.test(ua)) return "Samsung Internet";
  if (/OPR\/|Opera/.test(ua)) return "Opera";
  if (/Firefox\/|FxiOS\//.test(ua)) return "Firefox";
  if (/CriOS\/|Chrome\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua)) return "Safari";
  return "other";
}

function osFamily(ua: string): string {
  if (/iPhone|iPad|iPod/.test(ua)) return "iOS";
  if (/Android/.test(ua)) return "Android";
  if (/Mac OS X/.test(ua)) return "macOS";
  if (/Windows/.test(ua)) return "Windows";
  if (/Linux/.test(ua)) return "Linux";
  return "other";
}

export function clientContext(): ClientContext {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  return {
    path: typeof location === "undefined" ? "/" : location.pathname,
    browser: browserFamily(ua),
    os: osFamily(ua),
    mobile: /Mobi|Android|iPhone|iPad/.test(ua),
    locale: typeof document === "undefined" ? "en" : document.documentElement.lang || "en",
  };
}

const SENT_KEY = "kumbara.reported";

function alreadySent(key: string): boolean {
  try {
    const sent = new Set<string>(JSON.parse(sessionStorage.getItem(SENT_KEY) ?? "[]") as string[]);
    if (sent.has(key)) return true;
    sent.add(key);
    sessionStorage.setItem(SENT_KEY, JSON.stringify([...sent].slice(-50)));
    return false;
  } catch {
    return false;
  }
}

/** Once per tab for each kind of failure on each page. */
export function reportError(kind: string, detail: string | undefined, source: "failure_screen" | "window"): void {
  const context = clientContext();
  if (alreadySent(`${source}:${kind}:${context.path}`)) return;
  // No `keepalive`: the page is alive when it reports, and Chrome never marks a keepalive request finished for
  // DevTools, so every page with a failure screen looked busy forever to tools that wait for the network to settle.
  void fetch("/api/errors", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, detail: detail?.slice(0, 240), source, context }) }).catch(() => undefined);
}

export function reportFailure(failure: Failure): void {
  reportError(failure.kind, failure.code ? `${failure.code}: ${failure.detail ?? ""}` : failure.detail, "failure_screen");
}

export async function sendFeedback(input: { message?: string; failure?: Failure | null }): Promise<boolean> {
  const res = await fetch("/api/feedback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: input.message ?? "", kind: input.failure?.kind ?? null, detail: input.failure?.detail ?? "", context: clientContext() }),
  }).catch(() => null);
  return Boolean(res?.ok);
}
