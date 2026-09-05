/**
 * Data layer on a temporary local libsql file: records, events, leases,
 * rate-limit windows and the secret guard on writes.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Keypair } from "@stellar/stellar-sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.TURSO_DATABASE_URL = `file:${path.join(mkdtempSync(path.join(tmpdir(), "kumbara-store-")), "test.db")}`;
delete process.env.TURSO_AUTH_TOKEN;

const store = await import("./store");

describe("libsql store", () => {
  beforeAll(async () => {
    await store.db();
  });
  afterAll(() => {
    store.resetDbForTests();
  });

  it("saves, reads and lists records per kind and contract", async () => {
    const now = new Date().toISOString();
    const a = { id: store.newId("dep"), contractId: "CAAA", status: "awaiting_transfer", createdAt: now, updatedAt: now, amountTry: "100.00" };
    const b = { id: store.newId("dep"), contractId: "CBBB", status: "in_vault", createdAt: now, updatedAt: now, amountTry: "50.00" };
    await store.depositStore.save(a);
    await store.depositStore.save(b);
    expect((await store.depositStore.get<typeof a>(a.id))?.amountTry).toBe("100.00");
    expect((await store.depositStore.list("CAAA")).map((r) => r.id)).toEqual([a.id]);
    expect(await store.depositStore.count("in_vault")).toBe(1);
    expect((await store.depositStore.listByStatus("awaiting_transfer")).map((r) => r.id)).toEqual([a.id]);
    expect(await store.withdrawalStore.list()).toEqual([]);
    await store.depositStore.save({ ...a, status: "in_vault" });
    expect(await store.depositStore.count("in_vault")).toBe(2);
  });

  it("refuses to persist anything carrying a secret seed", async () => {
    const now = new Date().toISOString();
    const leaky = { id: store.newId("dep"), contractId: "CCCC", status: "x", createdAt: now, updatedAt: now, note: Keypair.random().secret() };
    await expect(store.depositStore.save(leaky)).rejects.toThrow(/secret seed/);
    await expect(store.insertEvent({ type: "account_created", ts: Date.now(), network: "testnet", projectId: "kumbara", ref: null, hash: Keypair.random().secret() })).rejects.toThrow(/secret seed/);
  });

  it("stores and counts events with filters", async () => {
    const base = Date.now();
    await store.insertEvent({ type: "account_created", ts: base - 10, network: "testnet", projectId: "kumbara", ref: "booth-1", contractId: "C1", hash: "h1" });
    await store.insertEvent({ type: "account_created", ts: base, network: "testnet", projectId: "kumbara", ref: "booth-2", contractId: "C2", hash: "h2" });
    await store.insertEvent({ type: "relayed_tx", ts: base, network: "testnet", projectId: "kumbara", ref: "booth-2", hash: "h3", contract: null });
    expect(await store.countEvents({ type: "account_created" })).toBe(2);
    expect(await store.countEvents({ type: "account_created", ref: "booth-2" })).toBe(1);
    expect(await store.countEvents({ type: "account_created", since: base - 5 })).toBe(1);
    expect((await store.listEvents({ type: "account_created" })).map((e) => e.hash)).toEqual(["h2", "h1"]);
  });

  it("leases exclude concurrent holders and expire on their own", async () => {
    const first = await store.acquireLease("deposit:x", 500);
    expect(first).toBeTruthy();
    expect(await store.acquireLease("deposit:x", 500)).toBeNull();
    await store.releaseLease("deposit:x", first!);
    const second = await store.acquireLease("deposit:x", 50);
    expect(second).toBeTruthy();
    await new Promise((r) => setTimeout(r, 80));
    expect(await store.acquireLease("deposit:x", 500)).toBeTruthy(); // expired lease is taken over
    let ran = 0;
    const result = await store.withLease("deposit:y", 1000, async () => {
      ran += 1;
      const inner = await store.withLease("deposit:y", 1000, async () => "inner-ran", async () => "busy");
      return inner;
    }, async () => "outer-busy");
    expect(ran).toBe(1);
    expect(result).toBe("busy");
  });

  it("rate-limit windows count per bucket and forget old hits", async () => {
    const bucket = "abc123";
    expect((await store.rateLimitHit(bucket, 2, 200)).allowed).toBe(true);
    expect((await store.rateLimitHit(bucket, 2, 200)).allowed).toBe(true);
    expect((await store.rateLimitHit(bucket, 2, 200))).toEqual({ allowed: false, count: 2 });
    await new Promise((r) => setTimeout(r, 250));
    expect((await store.rateLimitHit(bucket, 2, 200)).allowed).toBe(true);
    expect((await store.rateLimitHit("other", 0, 200)).allowed).toBe(true); // 0 = unlimited
  });

  it("maps contracts to anchor customers", async () => {
    expect(await store.getCustomerId("CDDD")).toBeNull();
    await store.setCustomerId("CDDD", "cus_1");
    await store.setCustomerId("CDDD", "cus_2");
    expect(await store.getCustomerId("CDDD")).toBe("cus_2");
  });
});
