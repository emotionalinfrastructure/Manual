import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorker } from "./index.js";

const env = {};
const BASE = "http://localhost";

function turnRequest(session_id, user_message) {
  return new Request(`${BASE}/v1/turn`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session_id, user_message }),
  });
}

// Each test builds its own worker, so session state is isolated by
// construction — no shared store, no session-id naming conventions.
test("health check", async () => {
  const worker = createWorker();
  const res = await worker.fetch(new Request(`${BASE}/`), env);
  const body = await res.json();
  assert.equal(body.status, "ok");
});

test("negative message triggers soften action", async () => {
  const worker = createWorker();
  const res = await worker.fetch(turnRequest("s", "I feel so sad and hopeless today"), env);
  const body = await res.json();
  assert.equal(body.safety.action, "soften");
  assert.ok(body.emotional_state.sentiment_score < 0);
});

test("crisis language triggers escalate with a directive", async () => {
  const worker = createWorker();
  const res = await worker.fetch(turnRequest("s", "I want to kill myself"), env);
  const body = await res.json();
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
  const worker = createWorker();
  const res = await worker.fetch(turnRequest("s", "Thanks, that worked great!"), env);
  const body = await res.json();
  assert.equal(body.safety.action, "allow");
  assert.ok(body.emotional_state.sentiment_score > 0);
});

test("session state persists and trend is tracked", async () => {
  const worker = createWorker();
  await worker.fetch(turnRequest("s", "I am furious and this is terrible"), env);
  await worker.fetch(turnRequest("s", "actually thanks, I feel great now"), env);

  const res = await worker.fetch(new Request(`${BASE}/v1/session/s`), env);
  const body = await res.json();
  assert.equal(body.turn_count, 2);
  assert.equal(body.sentiment_history.length, 2);
});

test("missing user_message is rejected", async () => {
  const worker = createWorker();
  const res = await worker.fetch(
    new Request(`${BASE}/v1/turn`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session_id: "s" }),
    }),
    env
  );
  assert.equal(res.status, 400);
});

test("without ANTHROPIC_API_KEY, replies fall back to a simulated, action-aware response", async () => {
  const worker = createWorker();
  const res = await worker.fetch(turnRequest("s", "I want to kill myself"), env);
  const body = await res.json();
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

  const worker = createWorker();
  const res = await worker.fetch(turnRequest("s", "I feel so sad and hopeless today"), {
    ANTHROPIC_API_KEY: "test-key",
  });
  const body = await res.json();
  assert.equal(body.llm_backend, "anthropic");
  assert.equal(body.assistant_reply, "Mocked model reply.");
});

test("conversation history accumulates across turns for LLM context", async () => {
  const worker = createWorker();
  await worker.fetch(turnRequest("s", "hello there"), env);
  await worker.fetch(turnRequest("s", "how are you"), env);

  const res = await worker.fetch(new Request(`${BASE}/v1/session/s`), env);
  const body = await res.json();
  assert.equal(body.messages.length, 4); // 2 user + 2 assistant
  assert.equal(body.messages[0].role, "user");
  assert.equal(body.messages[1].role, "assistant");
});

test("API_KEY enforcement rejects missing/incorrect bearer token", async () => {
  const securedEnv = { API_KEY: "secret" };
  const worker = createWorker();
  const res = await worker.fetch(turnRequest("s", "hello"), securedEnv);
  assert.equal(res.status, 401);

  const wrongReq = turnRequest("s", "hello");
  wrongReq.headers.set("authorization", "Bearer wrong");
  const resWrong = await worker.fetch(wrongReq, securedEnv);
  assert.equal(resWrong.status, 401);

  const authedReq = turnRequest("s", "hello");
  authedReq.headers.set("authorization", "Bearer secret");
  const res2 = await worker.fetch(authedReq, securedEnv);
  assert.equal(res2.status, 200);
});

// --- HTTP error contracts ---

test("malformed JSON body returns 400 invalid_json", async () => {
  const worker = createWorker();
  const res = await worker.fetch(
    new Request(`${BASE}/v1/turn`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    }),
    env
  );
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, "invalid_json");
});

test("missing or non-string session_id returns 400", async () => {
  const worker = createWorker();
  for (const payload of [{ user_message: "hi" }, { session_id: 7, user_message: "hi" }]) {
    const res = await worker.fetch(
      new Request(`${BASE}/v1/turn`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
      env
    );
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "session_id is required");
  }
});

test("non-string user_message returns 400", async () => {
  const worker = createWorker();
  const res = await worker.fetch(
    new Request(`${BASE}/v1/turn`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session_id: "s", user_message: 42 }),
    }),
    env
  );
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, "user_message is required");
});

test("unknown routes and wrong methods return 404 not_found", async () => {
  const worker = createWorker();

  const unknown = await worker.fetch(new Request(`${BASE}/v2/nope`), env);
  assert.equal(unknown.status, 404);
  assert.equal((await unknown.json()).error, "not_found");

  const wrongMethod = await worker.fetch(new Request(`${BASE}/v1/turn`, { method: "GET" }), env);
  assert.equal(wrongMethod.status, 404);

  const postToSession = await worker.fetch(
    new Request(`${BASE}/v1/session/s`, { method: "POST", body: "{}" }),
    env
  );
  assert.equal(postToSession.status, 404);
});

test("unknown session returns 404 session_not_found", async () => {
  const worker = createWorker();
  const res = await worker.fetch(new Request(`${BASE}/v1/session/never-seen`), env);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, "session_not_found");
});

// --- CORS ---

test("OPTIONS preflight returns CORS headers", async () => {
  const worker = createWorker();
  const res = await worker.fetch(new Request(`${BASE}/v1/turn`, { method: "OPTIONS" }), env);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
  assert.ok(res.headers.get("Access-Control-Allow-Methods").includes("POST"));
  assert.ok(res.headers.get("Access-Control-Allow-Headers").includes("Authorization"));
});

test("CORS headers are present on API responses, including errors", async () => {
  const worker = createWorker();
  const ok = await worker.fetch(turnRequest("s", "hi"), env);
  assert.equal(ok.headers.get("Access-Control-Allow-Origin"), "*");

  const err = await worker.fetch(new Request(`${BASE}/v2/nope`), env);
  assert.equal(err.headers.get("Access-Control-Allow-Origin"), "*");
});

// --- history limits ---

test("message history is trimmed to the configured cap while counters keep counting", async () => {
  const worker = createWorker();
  for (let i = 0; i < 13; i++) {
    await worker.fetch(turnRequest("s", `message number ${i}`), env);
  }
  const res = await worker.fetch(new Request(`${BASE}/v1/session/s`), env);
  const body = await res.json();
  assert.equal(body.turn_count, 13); // counter is not trimmed
  assert.equal(body.messages.length, 20); // 13 turns = 26 messages, capped at 20
  // Oldest messages fell off; the most recent turn is last.
  assert.equal(body.messages[body.messages.length - 2].content, "message number 12");
});

// --- state isolation ---

test("separate worker instances do not share session state", async () => {
  const workerA = createWorker();
  const workerB = createWorker();
  await workerA.fetch(turnRequest("shared-id", "hello from A"), env);

  const inA = await workerA.fetch(new Request(`${BASE}/v1/session/shared-id`), env);
  assert.equal(inA.status, 200);

  const inB = await workerB.fetch(new Request(`${BASE}/v1/session/shared-id`), env);
  assert.equal(inB.status, 404); // same id, different instance, no state
});

test("sessions with different ids are independent within one instance", async () => {
  const worker = createWorker();
  await worker.fetch(turnRequest("one", "I want to kill myself"), env);
  await worker.fetch(turnRequest("two", "lovely weather"), env);

  const one = await (await worker.fetch(new Request(`${BASE}/v1/session/one`), env)).json();
  const two = await (await worker.fetch(new Request(`${BASE}/v1/session/two`), env)).json();
  assert.equal(one.crisis_turn_count, 1);
  assert.equal(two.crisis_turn_count, 0);
});

// --- repeated-crisis boundary through the HTTP surface ---

test("third turn after two crisis turns escalates even a benign message", async () => {
  const worker = createWorker();
  await worker.fetch(turnRequest("s", "I want to kill myself"), env);
  await worker.fetch(turnRequest("s", "there is no reason to live"), env);

  const res = await worker.fetch(turnRequest("s", "anyway, nice weather today"), env);
  const body = await res.json();
  assert.deepEqual(body.safety.flags, []); // message itself is benign
  assert.equal(body.safety.action, "escalate"); // session history escalates it
  assert.equal(body.safety.severity, "high");
  assert.ok(body.suggested_system_directive.includes("ongoing"));
  assert.equal(body.crisis_turn_count, 2); // benign turn did not increment
});
