/**
 * Data layer on libsql: Turso in production (TURSO_DATABASE_URL +
 * TURSO_AUTH_TOKEN), a local file otherwise (default file:.data/kumbara.db),
 * one code path. Fully async. Nothing that matters lives in process memory:
 * per-record mutual exclusion is a database lease, rate-limit windows are
 * rows, and every invocation resumes from what is stored.
 *
 * Every record, event and counter row passes `assertNoSecret` before it is
 * written.
 */
import { createClient, type Client, type InValue } from "@libsql/client";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { assertNoSecret } from "../landing/secret-guard";

export function databaseUrl(): string {
  return process.env.TURSO_DATABASE_URL?.trim() || "file:.data/kumbara.db";
}

let client: Client | null = null;
let schemaReady: Promise<void> | null = null;

function connect(): Client {
  if (client) return client;
  const url = databaseUrl();
  if (url.startsWith("file:")) {
    mkdirSync(path.dirname(path.resolve(url.slice("file:".length))), { recursive: true });
  }
  const authToken = process.env.TURSO_AUTH_TOKEN?.trim();
  client = createClient(authToken ? { url, authToken } : { url });
  return client;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS records (
     kind TEXT NOT NULL,
     id TEXT PRIMARY KEY,
     contract_id TEXT NOT NULL,
     status TEXT NOT NULL,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     json TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS records_kind_contract ON records(kind, contract_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS records_kind_status ON records(kind, status, created_at)`,
  `CREATE TABLE IF NOT EXISTS events (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     type TEXT NOT NULL,
     ts INTEGER NOT NULL,
     network TEXT NOT NULL,
     project_id TEXT NOT NULL,
     ref TEXT,
     json TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS events_type_ts ON events(type, ts)`,
  `CREATE INDEX IF NOT EXISTS events_type_ref ON events(type, ref)`,
  `CREATE TABLE IF NOT EXISTS leases (
     key TEXT PRIMARY KEY,
     token TEXT NOT NULL,
     expires_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS ratelimit_hits (
     bucket TEXT NOT NULL,
     ts INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS ratelimit_bucket_ts ON ratelimit_hits(bucket, ts)`,
  `CREATE TABLE IF NOT EXISTS kv (
     key TEXT PRIMARY KEY,
     json TEXT NOT NULL,
     updated_at TEXT NOT NULL
   )`,
];

/**
 * Who produced a record or event, derived from its booth ref: the seeded demo
 * account, the automated E2E runs, or a real visitor. /api/metrics and /stats
 * exclude `seed` and `e2e` unless asked to include them.
 */
export type EventSource = "user" | "seed" | "e2e";

export function sourceOfRef(ref: string | null | undefined): EventSource {
  if (!ref) return "user";
  if (ref === "seed") return "seed";
  if (/^e2e(-|$)/i.test(ref)) return "e2e";
  return "user";
}

/** Additive migrations for databases created before a column existed. */
async function migrate(c: Client): Promise<void> {
  const info = await c.execute("PRAGMA table_info(events)");
  const hasSource = info.rows.some((r) => String(r.name) === "source");
  if (!hasSource) {
    await c.execute("ALTER TABLE events ADD COLUMN source TEXT");
  }
  await c.execute("UPDATE events SET source = CASE WHEN ref = 'seed' THEN 'seed' WHEN ref LIKE 'e2e%' THEN 'e2e' ELSE 'user' END WHERE source IS NULL");
  await c.execute("CREATE INDEX IF NOT EXISTS events_source_ts ON events(source, ts)");
}

/** Idempotent schema; the memoized promise is an optimization, not state. */
export async function db(): Promise<Client> {
  const c = connect();
  if (!schemaReady) {
    schemaReady = c
      .batch(SCHEMA, "write")
      .then(() => migrate(c))
      .catch((err: unknown) => {
        schemaReady = null;
        throw err;
      });
  }
  await schemaReady;
  return c;
}

/** Test hook: point the layer at another database (closes the current client). */
export function resetDbForTests(): void {
  client?.close();
  client = null;
  schemaReady = null;
}

export interface StoredRecord {
  id: string;
  contractId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export type RecordKind = "deposit" | "withdrawal";

function makeStore(kind: RecordKind) {
  return {
    async get<T extends StoredRecord>(id: string): Promise<T | null> {
      const res = await (await db()).execute({ sql: "SELECT json FROM records WHERE kind = ? AND id = ?", args: [kind, id] });
      const row = res.rows[0];
      return row ? (JSON.parse(String(row.json)) as T) : null;
    },
    async save<T extends StoredRecord>(record: T): Promise<T> {
      const next = { ...record, updatedAt: new Date().toISOString() };
      assertNoSecret(next, `${kind} ${record.id}`);
      await (await db()).execute({
        sql: `INSERT INTO records (kind, id, contract_id, status, created_at, updated_at, json) VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at, json = excluded.json`,
        args: [kind, next.id, next.contractId, next.status, next.createdAt, next.updatedAt, JSON.stringify(next)],
      });
      return next;
    },
    async list<T extends StoredRecord>(contractId?: string, limit = 200): Promise<T[]> {
      const res = contractId
        ? await (await db()).execute({ sql: "SELECT json FROM records WHERE kind = ? AND contract_id = ? ORDER BY created_at DESC LIMIT ?", args: [kind, contractId, limit] })
        : await (await db()).execute({ sql: "SELECT json FROM records WHERE kind = ? ORDER BY created_at DESC LIMIT ?", args: [kind, limit] });
      return res.rows.map((r) => JSON.parse(String(r.json)) as T);
    },
    async listByStatus<T extends StoredRecord>(status: string, limit = 50): Promise<T[]> {
      const res = await (await db()).execute({ sql: "SELECT json FROM records WHERE kind = ? AND status = ? ORDER BY created_at DESC LIMIT ?", args: [kind, status, limit] });
      return res.rows.map((r) => JSON.parse(String(r.json)) as T);
    },
    async count(status?: string): Promise<number> {
      const res = status
        ? await (await db()).execute({ sql: "SELECT COUNT(*) AS n FROM records WHERE kind = ? AND status = ?", args: [kind, status] })
        : await (await db()).execute({ sql: "SELECT COUNT(*) AS n FROM records WHERE kind = ?", args: [kind] });
      return Number(res.rows[0]?.n ?? 0);
    },
  };
}

export const depositStore = makeStore("deposit");
export const withdrawalStore = makeStore("withdrawal");

export interface EventRow {
  type: string;
  ts: number;
  network: string;
  projectId: string;
  ref: string | null;
  /** seed | e2e | user; derived from the ref when not given. */
  source?: EventSource;
  [key: string]: unknown;
}

export interface EventFilter {
  type?: string;
  since?: number;
  ref?: string;
  /** Only these sources; omit for every source. */
  sources?: EventSource[];
}

export async function insertEvent(event: EventRow): Promise<void> {
  const source: EventSource = event.source ?? sourceOfRef(event.ref);
  const row = { ...event, source };
  assertNoSecret(row, "event");
  await (await db()).execute({
    sql: "INSERT INTO events (type, ts, network, project_id, ref, source, json) VALUES (?, ?, ?, ?, ?, ?, ?)",
    args: [row.type, row.ts, row.network, row.projectId, row.ref, source, JSON.stringify(row)],
  });
}

function eventFilter(filter: EventFilter): { where: string; args: InValue[] } {
  const clauses: string[] = [];
  const args: InValue[] = [];
  if (filter.type) {
    clauses.push("type = ?");
    args.push(filter.type);
  }
  if (filter.since) {
    clauses.push("ts >= ?");
    args.push(filter.since);
  }
  if (filter.ref) {
    clauses.push("ref = ?");
    args.push(filter.ref);
  }
  if (filter.sources && filter.sources.length > 0) {
    clauses.push(`source IN (${filter.sources.map(() => "?").join(", ")})`);
    args.push(...filter.sources);
  }
  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", args };
}

export async function listEvents(filter: EventFilter = {}, limit = 1000): Promise<EventRow[]> {
  const { where, args } = eventFilter(filter);
  const res = await (await db()).execute({ sql: `SELECT json FROM events ${where} ORDER BY ts DESC LIMIT ?`, args: [...args, limit] });
  return res.rows.map((r) => JSON.parse(String(r.json)) as EventRow);
}

export async function countEvents(filter: EventFilter = {}): Promise<number> {
  const { where, args } = eventFilter(filter);
  const res = await (await db()).execute({ sql: `SELECT COUNT(*) AS n FROM events ${where}`, args });
  return Number(res.rows[0]?.n ?? 0);
}

// ---------------------------------------------------------------------------
// Small key/value documents (the last CI status, …). Secret-checked like
// everything else.
// ---------------------------------------------------------------------------

export async function kvGet<T>(key: string): Promise<T | null> {
  const res = await (await db()).execute({ sql: "SELECT json FROM kv WHERE key = ?", args: [key] });
  const row = res.rows[0];
  return row ? (JSON.parse(String(row.json)) as T) : null;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  assertNoSecret(value, `kv ${key}`);
  await (await db()).execute({
    sql: "INSERT INTO kv (key, json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at",
    args: [key, JSON.stringify(value), new Date().toISOString()],
  });
}

// ---------------------------------------------------------------------------
// Leases: mutual exclusion across invocations without shared memory. A lease
// that is not released (crashed invocation) expires on its own.
// ---------------------------------------------------------------------------

export async function acquireLease(key: string, ttlMs: number): Promise<string | null> {
  const token = randomUUID();
  const now = Date.now();
  const res = await (await db()).execute({
    sql: `INSERT INTO leases (key, token, expires_at) VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET token = excluded.token, expires_at = excluded.expires_at
          WHERE leases.expires_at < ?`,
    args: [key, token, now + ttlMs, now],
  });
  return res.rowsAffected > 0 ? token : null;
}

export async function releaseLease(key: string, token: string): Promise<void> {
  await (await db()).execute({ sql: "DELETE FROM leases WHERE key = ? AND token = ?", args: [key, token] });
}

/** Run `fn` under the lease, or `busy()` when another invocation holds it. */
export async function withLease<T>(key: string, ttlMs: number, fn: () => Promise<T>, busy: () => Promise<T>): Promise<T> {
  const token = await acquireLease(key, ttlMs);
  if (!token) return busy();
  try {
    return await fn();
  } finally {
    await releaseLease(key, token).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Rate-limit windows (rows of salted bucket hashes and timestamps).
// ---------------------------------------------------------------------------

export async function rateLimitHit(bucket: string, limit: number, windowMs: number): Promise<{ allowed: boolean; count: number }> {
  const conn = await db();
  const now = Date.now();
  await conn.execute({ sql: "DELETE FROM ratelimit_hits WHERE bucket = ? AND ts < ?", args: [bucket, now - windowMs] });
  const res = await conn.execute({ sql: "SELECT COUNT(*) AS n FROM ratelimit_hits WHERE bucket = ?", args: [bucket] });
  const count = Number(res.rows[0]?.n ?? 0);
  if (limit > 0 && count >= limit) return { allowed: false, count };
  await conn.execute({ sql: "INSERT INTO ratelimit_hits (bucket, ts) VALUES (?, ?)", args: [bucket, now] });
  return { allowed: true, count: count + 1 };
}

export function newId(prefix: string): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 16; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `${prefix}_${out}`;
}
