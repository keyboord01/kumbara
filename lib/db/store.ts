/**
 * SQLite store for deposits, withdrawals, the contract → anchor customer map
 * and the counter events. One file under DATA_DIR (default ./.data; /data on
 * the Fly machine's volume), WAL mode, single writer. Env-free apart from
 * DATA_DIR so scripts can use it too; `lib/store.server.ts` re-exports it
 * with the server-only marker for route handlers.
 *
 * Every record and event passes `assertNoSecret` before it is written.
 */
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { assertNoSecret } from "../landing/secret-guard";

export function dataDir(): string {
  return path.resolve(process.env.DATA_DIR?.trim() || ".data");
}

export function databasePath(): string {
  return path.join(dataDir(), "kumbara.sqlite");
}

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  mkdirSync(dataDir(), { recursive: true });
  db = new Database(databasePath());
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      contract_id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS records (
      kind TEXT NOT NULL,
      id TEXT PRIMARY KEY,
      contract_id TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS records_kind_contract ON records(kind, contract_id, created_at);
    CREATE INDEX IF NOT EXISTS records_kind_status ON records(kind, status, created_at);
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      ts INTEGER NOT NULL,
      network TEXT NOT NULL,
      project_id TEXT NOT NULL,
      ref TEXT,
      json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS events_type_ts ON events(type, ts);
  `);
  return db;
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
      const row = getDb().prepare("SELECT json FROM records WHERE kind = ? AND id = ?").get(kind, id) as { json: string } | undefined;
      return row ? (JSON.parse(row.json) as T) : null;
    },
    async save<T extends StoredRecord>(record: T): Promise<void> {
      const next = { ...record, updatedAt: new Date().toISOString() };
      assertNoSecret(next, `${kind} ${record.id}`);
      getDb()
        .prepare(
          `INSERT INTO records (kind, id, contract_id, status, created_at, updated_at, json) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at, json = excluded.json`,
        )
        .run(kind, next.id, next.contractId, next.status, next.createdAt, next.updatedAt, JSON.stringify(next));
    },
    async list<T extends StoredRecord>(contractId?: string, limit = 200): Promise<T[]> {
      const rows = (
        contractId
          ? getDb().prepare("SELECT json FROM records WHERE kind = ? AND contract_id = ? ORDER BY created_at DESC LIMIT ?").all(kind, contractId, limit)
          : getDb().prepare("SELECT json FROM records WHERE kind = ? ORDER BY created_at DESC LIMIT ?").all(kind, limit)
      ) as Array<{ json: string }>;
      return rows.map((r) => JSON.parse(r.json) as T);
    },
    async listByStatus<T extends StoredRecord>(status: string, limit = 50): Promise<T[]> {
      const rows = getDb().prepare("SELECT json FROM records WHERE kind = ? AND status = ? ORDER BY created_at DESC LIMIT ?").all(kind, status, limit) as Array<{ json: string }>;
      return rows.map((r) => JSON.parse(r.json) as T);
    },
    async count(status?: string): Promise<number> {
      const row = (
        status
          ? getDb().prepare("SELECT COUNT(*) AS n FROM records WHERE kind = ? AND status = ?").get(kind, status)
          : getDb().prepare("SELECT COUNT(*) AS n FROM records WHERE kind = ?").get(kind)
      ) as { n: number };
      return row.n;
    },
  };
}

export const depositStore = makeStore("deposit");
export const withdrawalStore = makeStore("withdrawal");

export async function getCustomerId(contractId: string): Promise<string | null> {
  const row = getDb().prepare("SELECT customer_id FROM customers WHERE contract_id = ?").get(contractId) as { customer_id: string } | undefined;
  return row?.customer_id ?? null;
}

export async function setCustomerId(contractId: string, customerId: string): Promise<void> {
  getDb()
    .prepare("INSERT INTO customers (contract_id, customer_id, created_at) VALUES (?, ?, ?) ON CONFLICT(contract_id) DO UPDATE SET customer_id = excluded.customer_id")
    .run(contractId, customerId, new Date().toISOString());
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
  getDb()
    .prepare("INSERT INTO events (type, ts, network, project_id, ref, json) VALUES (?, ?, ?, ?, ?, ?)")
    .run(event.type, event.ts, event.network, event.projectId, event.ref, JSON.stringify(event));
}

export async function listEvents(filter: { type?: string; since?: number } = {}, limit = 1000): Promise<EventRow[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.type) {
    clauses.push("type = ?");
    params.push(filter.type);
  }
  if (filter.since) {
    clauses.push("ts >= ?");
    params.push(filter.since);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = getDb().prepare(`SELECT json FROM events ${where} ORDER BY ts DESC LIMIT ?`).all(...params, limit) as Array<{ json: string }>;
  return rows.map((r) => JSON.parse(r.json) as EventRow);
}

export async function countEvents(filter: { type?: string; since?: number; ref?: string } = {}): Promise<number> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.type) {
    clauses.push("type = ?");
    params.push(filter.type);
  }
  if (filter.since) {
    clauses.push("ts >= ?");
    params.push(filter.since);
  }
  if (filter.ref) {
    clauses.push("ref = ?");
    params.push(filter.ref);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const row = getDb().prepare(`SELECT COUNT(*) AS n FROM events ${where}`).get(...params) as { n: number };
  return row.n;
}

/** Per-record mutex so concurrent polls do not double-advance a state machine (single machine). */
const locks = new Map<string, Promise<unknown>>();

export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  locks.set(key, run.catch(() => undefined));
  try {
    return await run;
  } finally {
    if (locks.get(key) === run) locks.delete(key);
  }
}

export function newId(prefix: string): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 16; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `${prefix}_${out}`;
}
