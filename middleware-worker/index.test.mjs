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

  const authedReq = turnRequest("s", "hello");
  authedReq.headers.set("authorization", "Bearer secret");
  const res2 = await worker.fetch(authedReq, securedEnv);
  assert.equal(res2.status, 200);
});
