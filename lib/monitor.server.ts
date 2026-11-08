/**
 * Pilot instrumentation: what users hit and what they tell us. Two event types
 * in the same events table as everything else (secret-checked on write):
 *
 *   client_error  a failure screen was shown, or the page threw; kind, a short
 *                 detail, the page and the browser family
 *   feedback      a one-tap report from the footer or a failure screen, with
 *                 an optional note and the same anonymised context
 *
 * Nothing identifies the person: no address, no kumbara, no IP (only a salted
 * hash for rate limiting), the browser reduced to family, OS and phone or not.
 * The presenter's monitor page groups them; the public status line reads only
 * /api/health.
 */
import "server-only";
import { createHash } from "node:crypto";
import { clientIp } from "./ratelimit.server";
import { insertEvent, listEvents, rateLimitHit, type EventRow } from "./db/store";
import { serverEnv } from "./env.server";

const HOUR_MS = 3_600_000;

export interface ClientContext {
  path: string;
  browser: string;
  os: string;
  mobile: boolean;
  locale: string;
}

const clip = (value: unknown, max: number): string => String(value ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);

/** Whatever the browser sends, keep only the coarse fields and drop anything that looks like an address or a key. */
export function sanitizeContext(raw: Partial<ClientContext> | undefined): ClientContext {
  const path = clip(raw?.path, 80).split("?")[0]!.replace(/[CG][A-Z2-7]{55}/g, "…");
  return { path: path || "/", browser: clip(raw?.browser, 24), os: clip(raw?.os, 24), mobile: raw?.mobile === true, locale: raw?.locale === "tr" ? "tr" : "en" };
}

/** Stellar addresses, secret seeds and long hex/base64 runs are cut out of free text before it is stored. */
export function scrubText(text: unknown, max: number): string {
  return clip(text, max)
    .replace(/S[A-Z2-7]{55}/g, "[secret removed]")
    .replace(/[CG][A-Z2-7]{55}/g, "[address]")
    .replace(/\b[0-9a-f]{40,}\b/gi, "[hash]")
    .replace(/\bTR\d{2}[\d ]{20,30}\b/g, "[iban]");
}

async function allow(request: Request, kind: string, perHour: number): Promise<boolean> {
  const bucket = createHash("sha256").update(`${serverEnv.sembolProjectKey()}:${kind}:${clientIp(request)}`).digest("hex");
  return (await rateLimitHit(bucket, perHour, HOUR_MS)).allowed;
}

function base(type: string, ctx: ClientContext): EventRow {
  return { type, ts: Date.now(), network: serverEnv.stellarNetwork(), projectId: serverEnv.sembolProjectId(), ref: null, ...ctx };
}

export async function recordClientError(request: Request, input: { kind?: unknown; detail?: unknown; source?: unknown; context?: Partial<ClientContext> }): Promise<boolean> {
  if (!(await allow(request, "client-error", 60))) return false;
  // `origin`, not `source`: the events table's own source column says user / seed / e2e.
  const origin = input.source === "window" ? "window" : "failure_screen";
  await insertEvent({ ...base("client_error", sanitizeContext(input.context)), kind: clip(input.kind, 40) || "unknown", detail: scrubText(input.detail, 240), origin });
  return true;
}

export async function recordFeedback(request: Request, input: { message?: unknown; kind?: unknown; detail?: unknown; context?: Partial<ClientContext> }): Promise<boolean> {
  if (!(await allow(request, "feedback", 10))) return false;
  await insertEvent({ ...base("feedback", sanitizeContext(input.context)), message: scrubText(input.message, 500), kind: clip(input.kind, 40) || null, detail: scrubText(input.detail, 240) });
  return true;
}

export interface MonitorSnapshot {
  since: number;
  errors: { kind: string; count: number; last: number; paths: string[]; browsers: string[]; sample: string }[];
  errorsPerDay: { day: string; count: number }[];
  feedback: { ts: number; message: string; kind: string | null; path: string; browser: string; os: string; mobile: boolean }[];
}

export async function monitorSnapshot(days = 7): Promise<MonitorSnapshot> {
  const now = Date.now();
  const since = now - (now % 86_400_000) - (days - 1) * 86_400_000;
  const [errors, feedback] = await Promise.all([listEvents({ type: "client_error", since }, 5_000), listEvents({ type: "feedback", since }, 500)]);
  const groups = new Map<string, MonitorSnapshot["errors"][number]>();
  for (const e of errors) {
    const kind = String(e.kind);
    const g = groups.get(kind) ?? { kind, count: 0, last: 0, paths: [], browsers: [], sample: String(e.detail ?? "") };
    g.count += 1;
    g.last = Math.max(g.last, e.ts);
    if (!g.paths.includes(String(e.path))) g.paths.push(String(e.path));
    const browser = `${e.browser} / ${e.os}${e.mobile ? " (phone)" : ""}`;
    if (!g.browsers.includes(browser)) g.browsers.push(browser);
    groups.set(kind, g);
  }
  return {
    since,
    errors: [...groups.values()].sort((a, b) => b.count - a.count),
    errorsPerDay: Array.from({ length: days }, (_, i) => {
      const start = since + i * 86_400_000;
      return { day: new Date(start).toISOString().slice(0, 10), count: errors.filter((e) => e.ts >= start && e.ts < start + 86_400_000).length };
    }),
    feedback: feedback.map((f) => ({ ts: f.ts, message: String(f.message ?? ""), kind: (f.kind as string | null) ?? null, path: String(f.path), browser: String(f.browser), os: String(f.os), mobile: f.mobile === true })),
  };
}
