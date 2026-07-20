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

test("without ANTHROPIC_API_KEY, replies fall back to a simulated, action-aware response", async () => {
  const res = await worker.fetch(turnRequest("t7", "I want to kill myself"), env);
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

  const res = await worker.fetch(turnRequest("t8", "I feel so sad and hopeless today"), {
    ANTHROPIC_API_KEY: "test-key",
  });
  const body = await res.json();
  assert.equal(body.llm_backend, "anthropic");
  assert.equal(body.assistant_reply, "Mocked model reply.");
});

test("conversation history accumulates across turns for LLM context", async () => {
  const sessionId = "t9";
  await worker.fetch(turnRequest(sessionId, "hello there"), env);
  await worker.fetch(turnRequest(sessionId, "how are you"), env);

  const res = await worker.fetch(new Request(`${BASE}/v1/session/${sessionId}`), env);
  const body = await res.json();
  assert.equal(body.messages.length, 4); // 2 user + 2 assistant
  assert.equal(body.messages[0].role, "user");
  assert.equal(body.messages[1].role, "assistant");
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

test("console: GET /v1/sessions lists sessions seen by this isolate", async () => {
  await worker.fetch(turnRequest("console-1", "hello there"), env);
  const res = await worker.fetch(new Request(`${BASE}/v1/sessions`), env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.sessions.some((s) => s.session_id === "console-1"));
});

test("console: /v1/sessions and /v1/governance/* require the API key when one is set", async () => {
  const securedEnv = { API_KEY: "secret" };
  const res = await worker.fetch(new Request(`${BASE}/v1/sessions`), securedEnv);
  assert.equal(res.status, 401);

  const res2 = await worker.fetch(new Request(`${BASE}/v1/governance/qa-findings`), securedEnv);
  assert.equal(res2.status, 401);
});

test("governance: QA Findings Tracker supports create, list, and patch", async () => {
  const createRes = await worker.fetch(
    new Request(`${BASE}/v1/governance/qa-findings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        area: "Standards Index",
        finding: "Confirm no new EI-STD identifiers were introduced.",
        priority: "High",
        status: "Open",
        owner: "Editorial",
        due: "2026-08-01",
      }),
    }),
    env
  );
  assert.equal(createRes.status, 201);
  const created = await createRes.json();
  assert.equal(created.status, "Open");

  const listRes = await worker.fetch(new Request(`${BASE}/v1/governance/qa-findings`), env);
  const listBody = await listRes.json();
  assert.ok(listBody.items.some((item) => item.id === created.id));

  const patchRes = await worker.fetch(
    new Request(`${BASE}/v1/governance/qa-findings/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "Closed", closure_note: "Verified against Appendix B." }),
    }),
    env
  );
  assert.equal(patchRes.status, 200);
  const patched = await patchRes.json();
  assert.equal(patched.status, "Closed");
  assert.equal(patched.closure_note, "Verified against Appendix B.");
});

test("governance: unknown governance collection returns 404", async () => {
  const res = await worker.fetch(new Request(`${BASE}/v1/governance/not-a-real-instrument`), env);
  assert.equal(res.status, 404);
});

test("trust receipt: GET /v1/trust-receipt/requirements returns the R1-R12 catalog", async () => {
  const res = await worker.fetch(new Request(`${BASE}/v1/trust-receipt/requirements`), env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(Object.keys(body.requirements).length, 12);
  assert.deepEqual(body.hard_gates_c2_c3, ["R1", "R2", "R4", "R8", "R10", "R11", "R12"]);
});

test("trust receipt: POST /v1/trust-receipt/evaluate runs the conformance decision protocol", async () => {
  const res = await worker.fetch(
    new Request(`${BASE}/v1/trust-receipt/evaluate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ consequence_class: "C2", requirements: { R4: "partial" } }),
    }),
    env
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.overall, "conditional");
  assert.equal(body.mode, "manual_control");
});

test("trust receipt: an invalid consequence class is rejected with 400", async () => {
  const res = await worker.fetch(
    new Request(`${BASE}/v1/trust-receipt/evaluate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ consequence_class: "C9", requirements: {} }),
    }),
    env
  );
  assert.equal(res.status, 400);
});

test("trust receipt: requires the API key when one is set", async () => {
  const securedEnv = { API_KEY: "secret" };
  const res = await worker.fetch(new Request(`${BASE}/v1/trust-receipt/requirements`), securedEnv);
  assert.equal(res.status, 401);
});

test("governance: Release Readiness Checklist is seeded and items can be toggled", async () => {
  const listRes = await worker.fetch(new Request(`${BASE}/v1/governance/release-checklist`), env);
  const listBody = await listRes.json();
  assert.equal(listBody.items.length, 10);
  assert.ok(listBody.items.every((item) => item.complete === false));

  const target = listBody.items[0];
  const patchRes = await worker.fetch(
    new Request(`${BASE}/v1/governance/release-checklist/${target.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ complete: true }),
    }),
    env
  );
  assert.equal(patchRes.status, 200);
  const patched = await patchRes.json();
  assert.equal(patched.complete, true);
});
