import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorker } from "./index.js";
import { createKvSessionStore } from "./sessions.js";

// Stand-in for a KV namespace: string values, JSON reads, recorded puts. The
// store logic is real; only the storage medium is faked.
function fakeKv() {
  const data = new Map();
  const puts = [];
  return {
    data,
    puts,
    async get(key, type) {
      const raw = data.get(key);
      if (raw === undefined) return null;
      return type === "json" ? JSON.parse(raw) : raw;
    },
    async put(key, value, options) {
      puts.push({ key, options });
      data.set(key, value);
    },
  };
}

const BASE = "http://localhost";
const delta = (overrides = {}) => ({
  sentimentScore: -1,
  isCrisis: true,
  userMessage: "I want to kill myself",
  assistantReply: "…",
  ...overrides,
});

function turnRequest(session_id, user_message) {
  return new Request(`${BASE}/v1/turn`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session_id, user_message }),
  });
}

// --- the KV store ------------------------------------------------------------

test("an unseen session reads as undefined", async () => {
  const store = createKvSessionStore(fakeKv());
  assert.equal(await store.get("nope"), undefined);
  assert.equal((await store.getOrCreate("nope")).turnCount, 0);
});

test("applyTurn persists and returns the updated session", async () => {
  const kv = fakeKv();
  const store = createKvSessionStore(kv);

  const first = await store.applyTurn("s", delta());
  assert.equal(first.turnCount, 1);
  assert.equal(first.crisisTurnCount, 1);

  const reread = await store.get("s");
  assert.equal(reread.turnCount, 1);
  assert.equal(reread.crisisTurnCount, 1);
  assert.equal(reread.messages.length, 2);
});

test("keys are namespaced and writes carry a TTL", async () => {
  const kv = fakeKv();
  await createKvSessionStore(kv).applyTurn("abc", delta());

  assert.ok(kv.data.has("session:abc"), "expected the session: prefix");
  assert.equal(kv.puts.length, 1);
  assert.equal(kv.puts[0].options.expirationTtl, 60 * 60 * 24 * 30);
});

test("state survives a discarded store adapter, as it would an isolate recycle", async () => {
  const kv = fakeKv();
  await createKvSessionStore(kv).applyTurn("survivor", delta());

  // New adapter, same namespace: the session is still there.
  const session = await createKvSessionStore(kv).get("survivor");
  assert.equal(session.crisisTurnCount, 1);
});

test("sessions are isolated by id", async () => {
  const kv = fakeKv();
  const store = createKvSessionStore(kv);
  await store.applyTurn("a", delta());
  assert.equal((await store.get("a")).crisisTurnCount, 1);
  assert.equal(await store.get("b"), undefined);
});

test("history caps apply on the KV path too", async () => {
  const kv = fakeKv();
  const store = createKvSessionStore(kv);
  for (let i = 0; i < 13; i++) {
    await store.applyTurn("capped", delta({ isCrisis: false, userMessage: `m${i}` }));
  }
  const session = await store.get("capped");
  assert.equal(session.turnCount, 13);
  assert.equal(session.messages.length, 20);
});

test("characterization: the KV read-modify-write is NOT atomic", async () => {
  // Documents the known weakness that justifies preferring a Durable Object.
  // Five overlapping turns each read the same pre-state, so writes clobber and
  // the count lands far below five. Under the Durable Object this same shape
  // yields exactly five (see sessions.durable.test.mjs).
  const kv = fakeKv();
  const store = createKvSessionStore(kv);
  await Promise.all(Array.from({ length: 5 }, (_, i) => store.applyTurn("racy", delta({ userMessage: `m${i}` }))));

  const session = await store.get("racy");
  assert.ok(
    session.crisisTurnCount < 5,
    `expected a lost update on the KV path, got ${session.crisisTurnCount}`
  );
});

// --- tier selection ----------------------------------------------------------

test("the KV binding is used when no Durable Object binding is present", async () => {
  const kv = fakeKv();
  const worker = createWorker();
  const res = await worker.fetch(turnRequest("k", "I want to kill myself"), { SESSIONS_KV: kv });
  const body = await res.json();

  assert.equal(body.session_store, "kv");
  assert.equal(body.crisis_turn_count, 1);
  assert.ok(kv.data.has("session:k"));
});

test("a Durable Object binding takes precedence over KV", async () => {
  const kv = fakeKv();
  const doCalls = [];
  const fakeDoNamespace = {
    idFromName: (name) => ({ name }),
    get: () => ({
      fetch: async (url) => {
        doCalls.push(url);
        return url.endsWith("/record")
          ? Response.json({ turnCount: 1, crisisTurnCount: 1, sentimentHistory: [0], messages: [] })
          : Response.json(null);
      },
    }),
  };

  const worker = createWorker();
  const res = await worker.fetch(turnRequest("both", "hello"), {
    SESSIONS: fakeDoNamespace,
    SESSIONS_KV: kv,
  });

  assert.equal((await res.json()).session_store, "durable_object");
  assert.ok(doCalls.length > 0, "the Durable Object should have been used");
  assert.equal(kv.data.size, 0, "KV should not have been touched");
});

test("with no bindings the worker reports in-memory state", async () => {
  const worker = createWorker();
  const res = await worker.fetch(turnRequest("m", "hello"), {});
  assert.equal((await res.json()).session_store, "memory");
});

test("an injected store is reported as such and wins over every binding", async () => {
  const kv = fakeKv();
  const injected = {
    getOrCreate: () => ({ turnCount: 0, sentimentHistory: [], crisisTurnCount: 0, messages: [] }),
    get: () => undefined,
    applyTurn: () => ({ turnCount: 7, sentimentHistory: [], crisisTurnCount: 0, messages: [] }),
  };
  const worker = createWorker({ sessions: injected });
  const res = await worker.fetch(turnRequest("i", "hello"), { SESSIONS_KV: kv });
  const body = await res.json();

  assert.equal(body.session_store, "injected");
  assert.equal(body.turn, 7);
  assert.equal(kv.data.size, 0);
});

test("session lookup reads through the KV tier", async () => {
  const kv = fakeKv();
  const env = { SESSIONS_KV: kv };
  const worker = createWorker();

  await worker.fetch(turnRequest("look", "I want to kill myself"), env);
  const res = await worker.fetch(new Request(`${BASE}/v1/session/look`), env);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).crisis_turn_count, 1);

  const missing = await worker.fetch(new Request(`${BASE}/v1/session/absent`), env);
  assert.equal(missing.status, 404);
});

test("a fresh worker over the same KV namespace still sees prior crisis history", async () => {
  const kv = fakeKv();
  const env = { SESSIONS_KV: kv };

  const before = createWorker();
  await before.fetch(turnRequest("cont", "I want to kill myself"), env);
  await before.fetch(turnRequest("cont", "there is no reason to live"), env);

  const after = createWorker(); // new isolate, no shared memory
  const body = await (await after.fetch(turnRequest("cont", "anyway, nice weather"), env)).json();

  assert.equal(body.crisis_turn_count, 2);
  assert.equal(body.safety.action, "escalate"); // history was not lost
});
