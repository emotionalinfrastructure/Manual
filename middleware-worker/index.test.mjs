import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import worker, { __resetState } from "./index.js";

const env = {};
const BASE = "http://localhost";

// Every test starts from a known-empty session store so test order can never
// determine whether the suite passes.
beforeEach(() => __resetState());

function turnRequest(session_id, user_message) {
  return new Request(`${BASE}/v1/turn`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session_id, user_message }),
  });
}

async function turn(session_id, user_message, reqEnv = env) {
  const res = await worker.fetch(turnRequest(session_id, user_message), reqEnv);
  return { res, body: await res.json() };
}

// Shared schema contract for a successful /v1/turn response.
function assertTurnSchema(body) {
  for (const key of [
    "session_id",
    "turn",
    "emotional_state",
    "safety",
    "suggested_system_directive",
    "session_trend",
    "assistant_reply",
    "llm_backend",
  ]) {
    assert.ok(key in body, `missing key: ${key}`);
  }
  assert.equal(typeof body.turn, "number");
  for (const key of ["sentiment_score", "primary_emotion", "intensity"]) {
    assert.ok(key in body.emotional_state, `missing emotional_state.${key}`);
  }
  for (const key of ["flags", "action", "severity"]) {
    assert.ok(key in body.safety, `missing safety.${key}`);
  }
  assert.ok(Array.isArray(body.safety.flags));
  assert.ok(["allow", "soften", "escalate"].includes(body.safety.action));
}

// --- Happy-path behaviours (retained from the original suite) ---------------

test("health check", async () => {
  const res = await worker.fetch(new Request(`${BASE}/`), env);
  const body = await res.json();
  assert.equal(body.status, "ok");
});

test("negative message triggers soften action", async () => {
  const { body } = await turn("t1", "I feel so sad and hopeless today");
  assert.equal(body.safety.action, "soften");
  assert.ok(body.emotional_state.sentiment_score < 0);
});

test("crisis language triggers escalate with a directive", async () => {
  const { body } = await turn("t2", "I want to kill myself");
  assert.equal(body.safety.action, "escalate");
  assert.equal(body.safety.severity, "high");
  assert.ok(body.suggested_system_directive.includes("crisis"));
  // Crisis phrases must register as negative affect even when no individual
  // token is in the emotion lexicon.
  assert.ok(body.emotional_state.sentiment_score < 0);
  assert.equal(body.emotional_state.primary_emotion, "distress");
  assert.ok(body.emotional_state.intensity > 0);
  assert.equal(body.crisis_turn_count, 1);
});

test("neutral positive message is allowed", async () => {
  const { body } = await turn("t3", "Thanks, that worked great!");
  assert.equal(body.safety.action, "allow");
  assert.ok(body.emotional_state.sentiment_score > 0);
});

test("session state persists and trend is tracked", async () => {
  await turn("t4", "I am furious and this is terrible");
  await turn("t4", "actually thanks, I feel great now");

  const res = await worker.fetch(new Request(`${BASE}/v1/session/t4`), env);
  const body = await res.json();
  assert.equal(body.turn_count, 2);
  assert.equal(body.sentiment_history.length, 2);
});

test("without ANTHROPIC_API_KEY, replies fall back to a simulated, action-aware response", async () => {
  const { body } = await turn("t7", "I want to kill myself");
  assert.equal(body.llm_backend, "simulated");
  assert.ok(body.assistant_reply.includes("988"));
});

test("with ANTHROPIC_API_KEY, the worker calls the LLM and returns its reply", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://api.anthropic.com/v1/messages");
    const payload = JSON.parse(init.body);
    assert.ok(payload.system.includes("empathy")); // negative-sentiment directive got injected
    return new Response(JSON.stringify({ content: [{ text: "Mocked model reply." }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const res = await worker.fetch(turnRequest("t8", "I feel so sad and hopeless today"), {
    ANTHROPIC_API_KEY: "test-key",
  });
  const body = await res.json();
  assert.equal(body.llm_backend, "anthropic");
  assert.equal(body.assistant_reply, "Mocked model reply.");
});

test("conversation history accumulates across turns for LLM context", async () => {
  await turn("t9", "hello there");
  await turn("t9", "how are you");

  const res = await worker.fetch(new Request(`${BASE}/v1/session/t9`), env);
  const body = await res.json();
  assert.equal(body.messages.length, 4); // 2 user + 2 assistant
  assert.equal(body.messages[0].role, "user");
  assert.equal(body.messages[1].role, "assistant");
});

// --- Auth -------------------------------------------------------------------

test("API_KEY enforcement rejects missing/incorrect bearer token", async () => {
  const securedEnv = { API_KEY: "secret" };
  const res = await worker.fetch(turnRequest("t6", "hello"), securedEnv);
  assert.equal(res.status, 401);

  const authedReq = turnRequest("t6", "hello");
  authedReq.headers.set("authorization", "Bearer secret");
  const res2 = await worker.fetch(authedReq, securedEnv);
  assert.equal(res2.status, 200);
});

// --- Request validation / error boundaries ----------------------------------

test("malformed JSON body is rejected with 400 invalid_json", async () => {
  const res = await worker.fetch(
    new Request(`${BASE}/v1/turn`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ not valid json",
    }),
    env
  );
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, "invalid_json");
});

test("missing session_id is rejected with 400", async () => {
  const res = await worker.fetch(
    new Request(`${BASE}/v1/turn`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user_message: "hi" }),
    }),
    env
  );
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /session_id/);
});

test("non-string session_id is rejected with 400", async () => {
  const res = await worker.fetch(
    new Request(`${BASE}/v1/turn`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session_id: 123, user_message: "hi" }),
    }),
    env
  );
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /session_id/);
});

test("missing user_message is rejected with 400", async () => {
  const res = await worker.fetch(
    new Request(`${BASE}/v1/turn`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session_id: "x" }),
    }),
    env
  );
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /user_message/);
});

test("non-string user_message is rejected with 400", async () => {
  const res = await worker.fetch(
    new Request(`${BASE}/v1/turn`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session_id: "x", user_message: 42 }),
    }),
    env
  );
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /user_message/);
});

// --- Routing / methods ------------------------------------------------------

test("unknown session retrieval returns 404 session_not_found", async () => {
  const res = await worker.fetch(new Request(`${BASE}/v1/session/never-seen`), env);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, "session_not_found");
});

test("CORS preflight (OPTIONS) returns the CORS headers", async () => {
  const res = await worker.fetch(
    new Request(`${BASE}/v1/turn`, { method: "OPTIONS" }),
    env
  );
  assert.ok(res.status === 200 || res.status === 204);
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
  assert.match(res.headers.get("access-control-allow-methods"), /POST/);
});

test("unknown route returns 404 not_found", async () => {
  const res = await worker.fetch(new Request(`${BASE}/nope`), env);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, "not_found");
});

test("GET on the POST-only /v1/turn route falls through to 404", async () => {
  const res = await worker.fetch(new Request(`${BASE}/v1/turn`, { method: "GET" }), env);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, "not_found");
});

test("POST on the GET-only session route falls through to 404", async () => {
  const res = await worker.fetch(
    new Request(`${BASE}/v1/session/abc`, { method: "POST" }),
    env
  );
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, "not_found");
});

// --- History trimming -------------------------------------------------------

test("per-session message history is trimmed to MAX_MESSAGES (20)", async () => {
  for (let i = 0; i < 25; i++) {
    await turn("trim-msgs", `message number ${i}`);
  }
  const res = await worker.fetch(new Request(`${BASE}/v1/session/trim-msgs`), env);
  const body = await res.json();
  // 25 turns produce 50 messages; the store must cap at the most recent 20.
  assert.equal(body.messages.length, 20);
  assert.equal(body.turn_count, 25);
});

test("sentiment history is trimmed to MAX_HISTORY (20)", async () => {
  for (let i = 0; i < 25; i++) {
    await turn("trim-sent", `message number ${i}`);
  }
  const res = await worker.fetch(new Request(`${BASE}/v1/session/trim-sent`), env);
  const body = await res.json();
  assert.equal(body.sentiment_history.length, 20);
});

// --- Repeated-crisis escalation through the HTTP surface --------------------

test("two crisis turns escalate a later benign message (repeated-crisis rule)", async () => {
  await turn("rc", "I want to kill myself");
  await turn("rc", "seriously, I want to die");
  const { body } = await turn("rc", "anyway, what's the weather like");
  assert.equal(body.safety.action, "escalate");
  assert.equal(body.safety.severity, "high");
});

test("a single prior crisis turn does not over-escalate a later benign message", async () => {
  await turn("rc2", "I want to kill myself");
  const { body } = await turn("rc2", "anyway, what's the weather like");
  assert.notEqual(body.safety.action, "escalate");
});

test("crisis turn count is tracked on the session record", async () => {
  await turn("rc3", "I want to kill myself");
  await turn("rc3", "I want to die");
  const res = await worker.fetch(new Request(`${BASE}/v1/session/rc3`), env);
  const body = await res.json();
  assert.equal(body.crisis_turn_count, 2);
});

// --- Response schema consistency --------------------------------------------

test("response schema is consistent across allow / soften / escalate", async () => {
  const allow = await turn("sc1", "thanks, that worked great");
  const soften = await turn("sc2", "I feel so sad and hopeless");
  const escalate = await turn("sc3", "I want to kill myself");

  assertTurnSchema(allow.body);
  assertTurnSchema(soften.body);
  assertTurnSchema(escalate.body);

  assert.equal(allow.body.safety.action, "allow");
  assert.equal(soften.body.safety.action, "soften");
  assert.equal(escalate.body.safety.action, "escalate");
});

test("error responses use a consistent { error } schema", async () => {
  const res = await worker.fetch(new Request(`${BASE}/nope`), env);
  const body = await res.json();
  assert.equal(Object.keys(body).length, 1);
  assert.equal(typeof body.error, "string");
});

// --- Session store backend (KV vs in-memory) --------------------------------

// Minimal stand-in for a Workers KV namespace, injected as env.SESSIONS so the
// worker exercises its real KV code path under Node with no network.
function fakeKV() {
  const m = new Map();
  return {
    _map: m,
    async get(key, type) {
      const v = m.get(key);
      if (v === undefined) return null;
      return type === "json" ? JSON.parse(v) : v;
    },
    async put(key, value) {
      m.set(key, value);
    },
  };
}

test("the in-memory backend is reported when no KV binding is present", async () => {
  const { body } = await turn("mem1", "hello there");
  assert.equal(body.session_store, "memory");
});

test("a KV binding routes session state through KV and reports it", async () => {
  const kvEnv = { SESSIONS: fakeKV() };
  const { body } = await turn("kv1", "hello there", kvEnv);
  assert.equal(body.session_store, "kv");
  // The session was actually written to the KV namespace.
  assert.ok(kvEnv.SESSIONS._map.has("session:kv1"));
});

test("KV-backed session state persists across separate worker invocations", async () => {
  const kvEnv = { SESSIONS: fakeKV() };
  await turn("kv2", "I am furious and this is terrible", kvEnv);
  await turn("kv2", "actually thanks, I feel great now", kvEnv);

  const res = await worker.fetch(new Request(`${BASE}/v1/session/kv2`), kvEnv);
  const body = await res.json();
  assert.equal(body.turn_count, 2);
  assert.equal(body.sentiment_history.length, 2);
  assert.equal(body.messages.length, 4);
  assert.equal(body.session_store, "kv");
});

test("crisis counting works the same through the KV backend", async () => {
  const kvEnv = { SESSIONS: fakeKV() };
  await turn("kv3", "I want to kill myself", kvEnv);
  await turn("kv3", "I want to die", kvEnv);
  const { body } = await turn("kv3", "anyway, what's the weather like", kvEnv);
  assert.equal(body.safety.action, "escalate"); // repeated-crisis rule over KV
  assert.equal(body.crisis_turn_count, 2);
});

test("unknown session over the KV backend still returns 404", async () => {
  const kvEnv = { SESSIONS: fakeKV() };
  const res = await worker.fetch(new Request(`${BASE}/v1/session/never`), kvEnv);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, "session_not_found");
});

test("memory and KV backends keep separate state for the same session id", async () => {
  const kvEnv = { SESSIONS: fakeKV() };
  await turn("dup", "hello there", env); // in-memory
  await turn("dup", "hello there", kvEnv); // KV
  await turn("dup", "hello there", kvEnv); // KV again

  const memRes = await worker.fetch(new Request(`${BASE}/v1/session/dup`), env);
  const kvRes = await worker.fetch(new Request(`${BASE}/v1/session/dup`), kvEnv);
  assert.equal((await memRes.json()).turn_count, 1);
  assert.equal((await kvRes.json()).turn_count, 2);
});
