import assert from "node:assert/strict";
import { test } from "node:test";
import { generateReply, buildSystemPrompt } from "./llm.js";

// A fetch stub factory. Nothing here ever touches the real network — every
// test injects `fetchImpl` so the suite is fully offline and deterministic.
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const baseArgs = {
  apiKey: "test-key",
  model: "claude-test",
  systemDirective: null,
  action: "allow",
  history: [],
  userMessage: "hello",
};

// --- Real backend path ------------------------------------------------------

test("returns the model's reply on a successful response", async () => {
  const reply = await generateReply({
    ...baseArgs,
    fetchImpl: async () => jsonResponse({ content: [{ text: "Model says hi." }] }),
  });
  assert.equal(reply.backend, "anthropic");
  assert.equal(reply.text, "Model says hi.");
  assert.equal(reply.note, undefined);
});

test("sends history plus the current user message to the API", async () => {
  let captured;
  await generateReply({
    ...baseArgs,
    history: [{ role: "user", content: "earlier" }, { role: "assistant", content: "reply" }],
    userMessage: "now",
    fetchImpl: async (url, init) => {
      captured = { url, body: JSON.parse(init.body) };
      return jsonResponse({ content: [{ text: "ok" }] });
    },
  });
  assert.equal(captured.url, "https://api.anthropic.com/v1/messages");
  assert.equal(captured.body.model, "claude-test");
  assert.deepEqual(captured.body.messages, [
    { role: "user", content: "earlier" },
    { role: "assistant", content: "reply" },
    { role: "user", content: "now" },
  ]);
});

// --- Fallback paths (must degrade to a simulated reply) ---------------------

test("falls back to a simulated reply with a note on a non-2xx response", async () => {
  const reply = await generateReply({
    ...baseArgs,
    action: "escalate",
    fetchImpl: async () => new Response("upstream boom", { status: 500 }),
  });
  assert.equal(reply.backend, "simulated");
  assert.match(reply.note, /llm_call_failed \(500\)/);
  assert.match(reply.text, /988/); // action-aware escalate fallback
});

test("falls back to a simulated reply with a note when fetch throws", async () => {
  const reply = await generateReply({
    ...baseArgs,
    action: "soften",
    fetchImpl: async () => {
      throw new Error("network down");
    },
  });
  assert.equal(reply.backend, "simulated");
  assert.match(reply.note, /llm_call_errored: network down/);
  assert.match(reply.text, /here with you/);
});

// When the call succeeds but yields no usable text, the returned text is
// locally generated — so `backend` must report "simulated". Reporting
// "anthropic" here would attribute canned wording to the model.

test("empty content array falls back to a simulated reply reported as simulated", async () => {
  const reply = await generateReply({
    ...baseArgs,
    action: "escalate",
    fetchImpl: async () => jsonResponse({ content: [] }),
  });
  assert.equal(reply.backend, "simulated");
  assert.match(reply.note, /llm_empty_content/);
  assert.match(reply.text, /988/);
});

test("whitespace-only content falls back to a simulated reply reported as simulated", async () => {
  const reply = await generateReply({
    ...baseArgs,
    action: "soften",
    fetchImpl: async () => jsonResponse({ content: [{ text: "   \n  " }] }),
  });
  assert.equal(reply.backend, "simulated");
  assert.match(reply.note, /llm_empty_content/);
  assert.match(reply.text, /here with you/);
});

test("missing/malformed content field falls back without throwing", async () => {
  const reply = await generateReply({
    ...baseArgs,
    action: "allow",
    userMessage: "just a question",
    fetchImpl: async () => jsonResponse({ unexpected: true }),
  });
  assert.equal(reply.backend, "simulated");
  assert.match(reply.note, /llm_empty_content/);
  assert.match(reply.text, /Simulated reply/);
});

test("a successful reply with real text reports the anthropic backend and no note", async () => {
  const reply = await generateReply({
    ...baseArgs,
    fetchImpl: async () => jsonResponse({ content: [{ text: "genuine model output" }] }),
  });
  assert.equal(reply.backend, "anthropic");
  assert.equal(reply.text, "genuine model output");
  assert.equal(reply.note, undefined);
});

// --- Simulated backend (no API key) -----------------------------------------

test("no API key: escalate yields the crisis-resource reply", async () => {
  const reply = await generateReply({ ...baseArgs, apiKey: undefined, action: "escalate" });
  assert.equal(reply.backend, "simulated");
  assert.match(reply.text, /988 Suicide & Crisis Lifeline/);
});

test("no API key: soften yields the empathetic reply", async () => {
  const reply = await generateReply({ ...baseArgs, apiKey: undefined, action: "soften" });
  assert.equal(reply.backend, "simulated");
  assert.match(reply.text, /That sounds really hard/);
});

test("no API key: allow echoes the user message as a simulated reply", async () => {
  const reply = await generateReply({
    ...baseArgs,
    apiKey: undefined,
    action: "allow",
    userMessage: "what is the capital of France?",
  });
  assert.equal(reply.backend, "simulated");
  assert.match(reply.text, /what is the capital of France\?/);
  assert.match(reply.text, /Simulated reply/);
});

test("no API key: allow truncates a message longer than 140 characters", async () => {
  const long = "x".repeat(200);
  const reply = await generateReply({
    ...baseArgs,
    apiKey: undefined,
    action: "allow",
    userMessage: long,
  });
  assert.match(reply.text, /…/); // ellipsis indicates truncation
  assert.ok(reply.text.includes("x".repeat(140)));
  assert.ok(!reply.text.includes("x".repeat(141))); // never the full 200 chars
});

test("no API key: an allow message of exactly 140 chars is not truncated", async () => {
  const exact = "y".repeat(140);
  const reply = await generateReply({
    ...baseArgs,
    apiKey: undefined,
    action: "allow",
    userMessage: exact,
  });
  assert.ok(reply.text.includes(exact));
  assert.ok(!reply.text.includes("…"));
});

// --- buildSystemPrompt ------------------------------------------------------

test("buildSystemPrompt returns the base persona when there is no directive", () => {
  const prompt = buildSystemPrompt(null);
  assert.match(prompt, /helpful, concise AI assistant/);
  assert.doesNotMatch(prompt, /Compliance directive/);
});

test("buildSystemPrompt appends the compliance directive when one is supplied", () => {
  const prompt = buildSystemPrompt("Lead with empathy.");
  assert.match(prompt, /helpful, concise AI assistant/);
  assert.match(prompt, /Compliance directive from the emotional-infrastructure middleware/);
  assert.match(prompt, /Lead with empathy\./);
});
