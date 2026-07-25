import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import { createSessionStore, newSession, __resetMemory } from "./store.js";

beforeEach(() => __resetMemory());

// Minimal stand-in for a Workers KV namespace: enough of the get/put contract
// for the store to exercise the real KV code path under Node, with no network.
function fakeKV() {
  const m = new Map();
  return {
    _map: m,
    lastPutOptions: null,
    async get(key, type) {
      const v = m.get(key);
      if (v === undefined) return null;
      return type === "json" ? JSON.parse(v) : v;
    },
    async put(key, value, options) {
      this.lastPutOptions = options;
      m.set(key, value);
    },
  };
}

// --- newSession -------------------------------------------------------------

test("newSession returns a zeroed session record", () => {
  const s = newSession();
  assert.equal(s.turnCount, 0);
  assert.equal(s.crisisTurnCount, 0);
  assert.deepEqual(s.sentimentHistory, []);
  assert.deepEqual(s.messages, []);
  assert.equal(typeof s.createdAt, "string");
  assert.equal(s.lastTurnAt, null);
});

// --- Backend selection ------------------------------------------------------

test("no SESSIONS binding selects the in-memory backend", () => {
  assert.equal(createSessionStore({}).backend, "memory");
  assert.equal(createSessionStore(undefined).backend, "memory");
});

test("a SESSIONS binding selects the KV backend", () => {
  assert.equal(createSessionStore({ SESSIONS: fakeKV() }).backend, "kv");
});

// --- Memory backend ---------------------------------------------------------

test("memory backend round-trips a session and returns null for unknown ids", async () => {
  const store = createSessionStore({});
  assert.equal(await store.load("missing"), null);

  const s = newSession();
  s.turnCount = 3;
  await store.save("m1", s);
  assert.equal((await store.load("m1")).turnCount, 3);
});

test("__resetMemory clears the in-memory backend", async () => {
  const store = createSessionStore({});
  await store.save("m2", newSession());
  __resetMemory();
  assert.equal(await store.load("m2"), null);
});

// --- KV backend -------------------------------------------------------------

test("KV backend round-trips a session and returns null for unknown ids", async () => {
  const kv = fakeKV();
  const store = createSessionStore({ SESSIONS: kv });
  assert.equal(await store.load("missing"), null);

  const s = newSession();
  s.turnCount = 5;
  await store.save("k1", s);
  assert.equal((await store.load("k1")).turnCount, 5);
});

test("KV backend namespaces the key and sets an expiration TTL", async () => {
  const kv = fakeKV();
  const store = createSessionStore({ SESSIONS: kv });
  await store.save("k2", newSession());

  assert.ok(kv._map.has("session:k2"), "expected the namespaced session:<id> key");
  assert.ok(kv.lastPutOptions && kv.lastPutOptions.expirationTtl > 0, "expected a positive TTL");
});

test("KV backend stores JSON that survives a brand-new store over the same namespace", async () => {
  // Simulates a second Worker isolate: fresh store instance, same KV data.
  const kv = fakeKV();
  const s = newSession();
  s.turnCount = 9;
  await createSessionStore({ SESSIONS: kv }).save("k3", s);

  const secondIsolate = createSessionStore({ SESSIONS: kv });
  assert.equal((await secondIsolate.load("k3")).turnCount, 9);
});

test("KV and memory backends do not share state", async () => {
  const kv = fakeKV();
  await createSessionStore({ SESSIONS: kv }).save("shared-id", newSession());
  // The memory backend must not see a record written only to KV.
  assert.equal(await createSessionStore({}).load("shared-id"), null);
});
