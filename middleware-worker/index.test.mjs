import assert from "node:assert/strict";
import { test } from "node:test";
import worker from "./index.js";

const env = {};
const BASE = "http://localhost";

function turnRequest(session_id, user_message) {
  return new Request(`${BASE}/v1/turn`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session_id, user_message }),
  });
}

test("health check", async () => {
  const res = await worker.fetch(new Request(`${BASE}/`), env);
  const body = await res.json();
  assert.equal(body.status, "ok");
});

test("negative message triggers soften action", async () => {
  const res = await worker.fetch(turnRequest("t1", "I feel so sad and hopeless today"), env);
  const body = await res.json();
  assert.equal(body.safety.action, "soften");
  assert.ok(body.emotional_state.sentiment_score < 0);
});

test("crisis language triggers escalate with a directive", async () => {
  const res = await worker.fetch(turnRequest("t2", "I want to kill myself"), env);
  const body = await res.json();
  assert.equal(body.safety.action, "escalate");
  assert.equal(body.safety.severity, "high");
  assert.ok(body.suggested_system_directive.includes("crisis"));
});

test("neutral positive message is allowed", async () => {
  const res = await worker.fetch(turnRequest("t3", "Thanks, that worked great!"), env);
  const body = await res.json();
  assert.equal(body.safety.action, "allow");
  assert.ok(body.emotional_state.sentiment_score > 0);
});

test("session state persists and trend is tracked", async () => {
  const sessionId = "t4";
  await worker.fetch(turnRequest(sessionId, "I am furious and this is terrible"), env);
  await worker.fetch(turnRequest(sessionId, "actually thanks, I feel great now"), env);

  const res = await worker.fetch(new Request(`${BASE}/v1/session/${sessionId}`), env);
  const body = await res.json();
  assert.equal(body.turn_count, 2);
  assert.equal(body.sentiment_history.length, 2);
});

test("missing user_message is rejected", async () => {
  const res = await worker.fetch(
    new Request(`${BASE}/v1/turn`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session_id: "t5" }),
    }),
    env
  );
  assert.equal(res.status, 400);
});

test("API_KEY enforcement rejects missing/incorrect bearer token", async () => {
  const securedEnv = { API_KEY: "secret" };
  const res = await worker.fetch(turnRequest("t6", "hello"), securedEnv);
  assert.equal(res.status, 401);

  const authedReq = turnRequest("t6", "hello");
  authedReq.headers.set("authorization", "Bearer secret");
  const res2 = await worker.fetch(authedReq, securedEnv);
  assert.equal(res2.status, 200);
});
