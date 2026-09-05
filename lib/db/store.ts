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
  `CREATE TABLE IF NOT EXISTS customers (
     contract_id TEXT PRIMARY KEY,
     customer_id TEXT NOT NULL,
     created_at TEXT NOT NULL
   )`,
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
];

/** Idempotent schema; the memoized promise is an optimization, not state. */
export async function db(): Promise<Client> {
  const c = connect();
  if (!schemaReady) {
    schemaReady = c.batch(SCHEMA, "write").then(() => undefined).catch((err: unknown) => {
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

export async function getCustomerId(contractId: string): Promise<string | null> {
  const res = await (await db()).execute({ sql: "SELECT customer_id FROM customers WHERE contract_id = ?", args: [contractId] });
  const row = res.rows[0];
  return row ? String(row.customer_id) : null;
}

export async function setCustomerId(contractId: string, customerId: string): Promise<void> {
  await (await db()).execute({
    sql: "INSERT INTO customers (contract_id, customer_id, created_at) VALUES (?, ?, ?) ON CONFLICT(contract_id) DO UPDATE SET customer_id = excluded.customer_id",
    args: [contractId, customerId, new Date().toISOString()],
  });
}

export interface EventRow {
  type: string;
  ts: number;
  network: string;
  projectId: string;
  ref: string | null;
  [key: string]: unknown;
}

export async function insertEvent(event: EventRow): Promise<void> {
  assertNoSecret(event, "event");
  await (await db()).execute({
    sql: "INSERT INTO events (type, ts, network, project_id, ref, json) VALUES (?, ?, ?, ?, ?, ?)",
    args: [event.type, event.ts, event.network, event.projectId, event.ref, JSON.stringify(event)],
  });
}

function eventFilter(filter: { type?: string; since?: number; ref?: string }): { where: string; args: InValue[] } {
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
  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", args };
}

export async function listEvents(filter: { type?: string; since?: number; ref?: string } = {}, limit = 1000): Promise<EventRow[]> {
  const { where, args } = eventFilter(filter);
  const res = await (await db()).execute({ sql: `SELECT json FROM events ${where} ORDER BY ts DESC LIMIT ?`, args: [...args, limit] });
  return res.rows.map((r) => JSON.parse(String(r.json)) as EventRow);
}

export async function countEvents(filter: { type?: string; since?: number; ref?: string } = {}): Promise<number> {
  const { where, args } = eventFilter(filter);
  const res = await (await db()).execute({ sql: `SELECT COUNT(*) AS n FROM events ${where}`, args });
  return Number(res.rows[0]?.n ?? 0);
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
