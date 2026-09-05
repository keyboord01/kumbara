/**
 * Server-side store for deposits, withdrawals and the contract → anchor
 * customer map. File-backed JSON under .data/kumbara for local runs; Gate 4
 * swaps the backend for a durable store behind the same functions.
 *
 * Every record passes `assertNoSecret` before it is written.
 */
import "server-only";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertNoSecret } from "./landing/secret-guard";

const ROOT = path.join(process.cwd(), ".data", "kumbara");
const DEPOSITS = path.join(ROOT, "deposits");
const WITHDRAWALS = path.join(ROOT, "withdrawals");
const CUSTOMERS = path.join(ROOT, "customers.json");

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  assertNoSecret(value, path.basename(file));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2));
}

export async function getCustomerId(contractId: string): Promise<string | null> {
  const map = (await readJson<Record<string, string>>(CUSTOMERS)) ?? {};
  return map[contractId] ?? null;
}

export async function setCustomerId(contractId: string, customerId: string): Promise<void> {
  const map = (await readJson<Record<string, string>>(CUSTOMERS)) ?? {};
  map[contractId] = customerId;
  await writeJson(CUSTOMERS, map);
}

export interface StoredRecord {
  id: string;
  contractId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

async function listDir<T extends StoredRecord>(dir: string): Promise<T[]> {
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }
  const raw: unknown[] = await Promise.all(files.filter((f) => f.endsWith(".json")).map((f) => readJson<unknown>(path.join(dir, f))));
  const records = raw.filter((r): r is T => typeof r === "object" && r !== null && "createdAt" in r);
  return records.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export const depositStore = {
  get: <T extends StoredRecord>(id: string) => readJson<T>(path.join(DEPOSITS, `${safeId(id)}.json`)),
  save: <T extends StoredRecord>(record: T) => writeJson(path.join(DEPOSITS, `${safeId(record.id)}.json`), { ...record, updatedAt: new Date().toISOString() }),
  list: <T extends StoredRecord>(contractId?: string) => listDir<T>(DEPOSITS).then((all) => (contractId ? all.filter((r) => r.contractId === contractId) : all)),
};

export const withdrawalStore = {
  get: <T extends StoredRecord>(id: string) => readJson<T>(path.join(WITHDRAWALS, `${safeId(id)}.json`)),
  save: <T extends StoredRecord>(record: T) => writeJson(path.join(WITHDRAWALS, `${safeId(record.id)}.json`), { ...record, updatedAt: new Date().toISOString() }),
  list: <T extends StoredRecord>(contractId?: string) => listDir<T>(WITHDRAWALS).then((all) => (contractId ? all.filter((r) => r.contractId === contractId) : all)),
};

function safeId(id: string): string {
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) throw new Error("invalid record id");
  return id;
}

/** Per-record mutex so concurrent polls do not double-advance a state machine. */
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
