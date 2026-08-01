import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorker } from "./index.js";
import { SessionObject } from "./session-object.js";
import { createDurableSessionStore, createSessionStore } from "./sessions.js";

// A stand-in for the Durable Object runtime: real SessionObject instances over
// an in-process storage map, addressed by name exactly as the platform does.
// This exercises the actual object and store adapter — only the transport and
// the persistence medium are faked.
function fakeNamespace() {
  const instances = new Map();
  const created = [];
  return {
    created,
    idFromName(name) {
      return { name, toString: () => name };
    },
    get(id) {
      if (!instances.has(id.name)) {
        created.push(id.name);
        const storage = new Map();
        // Serialise access per instance, as the platform does — this is what
        // makes blockConcurrencyWhile meaningful in the concurrency test.
        let queue = Promise.resolve();
        const object = new SessionObject({
          storage: {
            async get(k) {
              return storage.get(k);
            },
            async put(k, v) {
              // Round-trip through JSON so the fake cannot accidentally
              // share object references the real platform would not.
              storage.set(k, JSON.parse(JSON.stringify(v)));
            },
          },
          blockConcurrencyWhile: (fn) => {
            queue = queue.then(fn, fn);
            return queue;
          },
        });
        // The stub the platform hands back takes (url, init) and builds the
        // Request the object receives.
        instances.set(id.name, {
          fetch: (url, init) => object.fetch(new Request(url, init)),
        });
      }
      return instances.get(id.name);
    },
  };
}

const BASE = "http://localhost";

function turnRequest(session_id, user_message) {
  return new Request(`${BASE}/v1/turn`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session_id, user_message }),
  });
}

// --- the SessionObject itself ----------------------------------------------

test("a new session reads as null before any turn is recorded", async () => {
  const ns = fakeNamespace();
  const store = createDurableSessionStore(ns);
  assert.equal(await store.get("fresh"), undefined);
});

test("applyTurn persists state and returns the updated session", async () => {
  const ns = fakeNamespace();
  const store = createDurableSessionStore(ns);

  const first = await store.applyTurn("s", {
    sentimentScore: -1,
    isCrisis: true,
    userMessage: "I want to kill myself",
    assistantReply: "…",
  });
  assert.equal(first.turnCount, 1);
  assert.equal(first.crisisTurnCount, 1);

  // A separate read sees the persisted value, not a local copy.
  const reread = await store.get("s");
  assert.equal(reread.turnCount, 1);
  assert.equal(reread.crisisTurnCount, 1);
  assert.equal(reread.messages.length, 2);
});

test("state survives losing the store adapter, as it would an isolate recycle", async () => {
  const ns = fakeNamespace();

  const before = createDurableSessionStore(ns);
  await before.applyTurn("survivor", {
    sentimentScore: -1,
    isCrisis: true,
    userMessage: "I want to kill myself",
    assistantReply: "…",
  });

  // Brand new adapter over the same namespace: the in-memory Map that used to
  // hold this state is gone, and the session is still there.
  const after = createDurableSessionStore(ns);
  const session = await after.get("survivor");
  assert.equal(session.turnCount, 1);
  assert.equal(session.crisisTurnCount, 1);
});

test("history caps are enforced inside the object, not just in memory", async () => {
  const ns = fakeNamespace();
  const store = createDurableSessionStore(ns);
  for (let i = 0; i < 13; i++) {
    await store.applyTurn("capped", {
      sentimentScore: 0,
      isCrisis: false,
      userMessage: `m${i}`,
      assistantReply: `r${i}`,
    });
  }
  const session = await store.get("capped");
  assert.equal(session.turnCount, 13); // counter keeps counting
  assert.equal(session.messages.length, 20); // 26 messages, capped at 20
});

test("each session id gets its own object; state does not bleed across ids", async () => {
  const ns = fakeNamespace();
  const store = createDurableSessionStore(ns);
  await store.applyTurn("a", { sentimentScore: 0, isCrisis: true, userMessage: "x", assistantReply: "y" });

  assert.equal((await store.get("a")).crisisTurnCount, 1);
  assert.equal(await store.get("b"), undefined);
  assert.deepEqual(ns.created, ["a", "b"]);
});

test("concurrent turns on one session do not lose a crisis increment", async () => {
  // The read-modify-write lives inside the object, so five overlapping
  // applyTurn calls must produce five counted turns — not a lost update.
  const ns = fakeNamespace();
  const store = createDurableSessionStore(ns);
  await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      store.applyTurn("racy", {
        sentimentScore: -1,
        isCrisis: true,
        userMessage: `m${i}`,
        assistantReply: `r${i}`,
      })
    )
  );
  const session = await store.get("racy");
  assert.equal(session.turnCount, 5);
  assert.equal(session.crisisTurnCount, 5);
});

test("the object rejects unknown routes", async () => {
  const ns = fakeNamespace();
  const stub = ns.get(ns.idFromName("x"));
  const res = await stub.fetch("https://session/nope");
  assert.equal(res.status, 404);
});

// --- end-to-end through the worker ------------------------------------------

test("the worker uses the SESSIONS binding when present", async () => {
  const ns = fakeNamespace();
  const worker = createWorker();
  const env = { SESSIONS: ns };

  const res = await worker.fetch(turnRequest("bound", "I want to kill myself"), env);
  const body = await res.json();
  assert.equal(body.crisis_turn_count, 1);
  assert.deepEqual(ns.created, ["bound"]); // it really went through the object

  const lookup = await worker.fetch(new Request(`${BASE}/v1/session/bound`), env);
  assert.equal((await lookup.json()).turn_count, 1);
});

test("repeated-crisis escalation works across turns on the durable path", async () => {
  const ns = fakeNamespace();
  const worker = createWorker();
  const env = { SESSIONS: ns };

  await worker.fetch(turnRequest("esc", "I want to kill myself"), env);
  await worker.fetch(turnRequest("esc", "there is no reason to live"), env);
  const res = await worker.fetch(turnRequest("esc", "anyway, nice weather"), env);
  const body = await res.json();

  assert.equal(body.crisis_turn_count, 2);
  assert.equal(body.safety.action, "escalate");
  assert.match(body.suggested_system_directive, /ongoing/);
});

test("a fresh worker over the same binding still sees prior session state", async () => {
  // The scenario the in-memory store cannot survive: the isolate is replaced
  // mid-conversation and the crisis history has to still be there.
  const ns = fakeNamespace();
  const env = { SESSIONS: ns };

  const before = createWorker();
  await before.fetch(turnRequest("cont", "I want to kill myself"), env);
  await before.fetch(turnRequest("cont", "there is no reason to live"), env);

  const after = createWorker(); // new isolate, no shared memory
  const res = await after.fetch(turnRequest("cont", "anyway, nice weather"), env);
  const body = await res.json();

  assert.equal(body.crisis_turn_count, 2);
  assert.equal(body.safety.action, "escalate"); // history was not lost
});

test("without the binding the worker still runs on in-memory state", async () => {
  const worker = createWorker();
  const res = await worker.fetch(turnRequest("nobinding", "I want to kill myself"), {});
  assert.equal((await res.json()).crisis_turn_count, 1);
});

test("an injected store takes precedence over the binding", async () => {
  const ns = fakeNamespace();
  const calls = [];
  const injected = {
    getOrCreate: () => ({ turnCount: 0, sentimentHistory: [], crisisTurnCount: 0, messages: [] }),
    get: () => undefined,
    applyTurn: (id) => {
      calls.push(id);
      return { turnCount: 99, sentimentHistory: [], crisisTurnCount: 0, messages: [] };
    },
  };
  const worker = createWorker({ sessions: injected });
  const res = await worker.fetch(turnRequest("inj", "hello"), { SESSIONS: ns });

  assert.equal((await res.json()).turn, 99);
  assert.deepEqual(calls, ["inj"]);
  assert.deepEqual(ns.created, []); // the binding was never touched
});

// --- which store served the request -----------------------------------------

test("session_store reports the durable tier when the binding is present", async () => {
  const ns = fakeNamespace();
  const worker = createWorker();
  const res = await worker.fetch(turnRequest("rep1", "hello"), { SESSIONS: ns });
  assert.equal((await res.json()).session_store, "durable_object");
});

test("session_store reports in-memory when no binding is present", async () => {
  const worker = createWorker();
  const res = await worker.fetch(turnRequest("rep2", "hello"), {});
  assert.equal((await res.json()).session_store, "memory");
});

test("session_store reports an injected store, which wins over the binding", async () => {
  const ns = fakeNamespace();
  const injected = {
    getOrCreate: () => ({ turnCount: 0, sentimentHistory: [], crisisTurnCount: 0, messages: [] }),
    get: () => undefined,
    applyTurn: () => ({ turnCount: 4, sentimentHistory: [], crisisTurnCount: 0, messages: [] }),
  };
  const worker = createWorker({ sessions: injected });
  const body = await (await worker.fetch(turnRequest("rep3", "hello"), { SESSIONS: ns })).json();

  assert.equal(body.session_store, "injected");
  assert.equal(body.turn, 4);
  assert.deepEqual(ns.created, []); // the binding was never touched
});

// --- In-memory store bounds --------------------------------------------------

test("the in-memory store evicts least-recently-used sessions past its cap", async () => {
  const store = createSessionStore({ maxSessions: 3 });
  for (const id of ["a", "b", "c"]) {
    store.applyTurn(id, { sentimentScore: 0, isCrisis: false, userMessage: "u", assistantReply: "a" });
  }
  // Touching "a" makes "b" the oldest, so "b" is what a fourth session evicts.
  store.getOrCreate("a");
  store.applyTurn("d", { sentimentScore: 0, isCrisis: false, userMessage: "u", assistantReply: "a" });

  assert.equal(store.get("b"), undefined, "expected the least-recently-used session to be evicted");
  for (const id of ["a", "c", "d"]) assert.ok(store.get(id), `expected ${id} to be retained`);
});

test("an existing session is not reset by being touched", async () => {
  const store = createSessionStore({ maxSessions: 2 });
  store.applyTurn("keep", { sentimentScore: -1, isCrisis: true, userMessage: "u", assistantReply: "a" });
  store.getOrCreate("keep");
  assert.equal(store.get("keep").turnCount, 1);
  assert.equal(store.get("keep").crisisTurnCount, 1);
});
