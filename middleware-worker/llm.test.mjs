import assert from "node:assert/strict";
import { test } from "node:test";
import { generateReply } from "./llm.js";

const baseArgs = {
  systemDirective: null,
  action: "allow",
  history: [],
  userMessage: "hello there",
};

function okResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

// --- simulated fallback (no API key) ---

test("no apiKey falls back to simulated replies, distinct per action", async () => {
  const escalate = await generateReply({ ...baseArgs, action: "escalate" });
  assert.equal(escalate.backend, "simulated");
  assert.ok(escalate.text.includes("988"));

  const soften = await generateReply({ ...baseArgs, action: "soften" });
  assert.equal(soften.backend, "simulated");
  assert.ok(soften.text.includes("hard"));

  const allow = await generateReply({ ...baseArgs, action: "allow" });
  assert.equal(allow.backend, "simulated");
  assert.ok(allow.text.includes("hello there"));

  assert.notEqual(escalate.text, soften.text);
  assert.notEqual(soften.text, allow.text);
});

test("simulated allow reply truncates long messages", async () => {
  const long = "a".repeat(200);
  const reply = await generateReply({ ...baseArgs, userMessage: long });
  assert.ok(reply.text.includes("…"));
  assert.ok(!reply.text.includes(long));
});

// --- request contract with a real key ---

test("sends the documented Anthropic request shape", async () => {
  let captured;
  const reply = await generateReply({
    ...baseArgs,
    apiKey: "k",
    history: [
      { role: "user", content: "earlier question" },
      { role: "assistant", content: "earlier answer" },
    ],
    userMessage: "current question",
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return okResponse({ content: [{ text: "model says hi" }] });
    },
  });

  assert.equal(captured.url, "https://api.anthropic.com/v1/messages");
  assert.equal(captured.init.method, "POST");
  assert.equal(captured.init.headers["x-api-key"], "k");
  assert.equal(captured.init.headers["anthropic-version"], "2023-06-01");

  const payload = JSON.parse(captured.init.body);
  assert.equal(payload.model, "claude-sonnet-5"); // default model
  assert.equal(payload.max_tokens, 300);
  assert.equal(payload.messages.length, 3); // history + current turn
  assert.deepEqual(payload.messages[2], { role: "user", content: "current question" });

  assert.equal(reply.backend, "anthropic");
  assert.equal(reply.text, "model says hi");
});

test("model override is passed through", async () => {
  let payload;
  await generateReply({
    ...baseArgs,
    apiKey: "k",
    model: "claude-opus-4-8",
    fetchImpl: async (url, init) => {
      payload = JSON.parse(init.body);
      return okResponse({ content: [{ text: "x" }] });
    },
  });
  assert.equal(payload.model, "claude-opus-4-8");
});

test("directive is injected into the system prompt; without one, only the persona is sent", async () => {
  let withDirective;
  await generateReply({
    ...baseArgs,
    apiKey: "k",
    systemDirective: "Treat this as an ongoing concern.",
    fetchImpl: async (url, init) => {
      withDirective = JSON.parse(init.body).system;
      return okResponse({ content: [{ text: "x" }] });
    },
  });
  assert.ok(withDirective.includes("Compliance directive"));
  assert.ok(withDirective.includes("Treat this as an ongoing concern."));

  let withoutDirective;
  await generateReply({
    ...baseArgs,
    apiKey: "k",
    fetchImpl: async (url, init) => {
      withoutDirective = JSON.parse(init.body).system;
      return okResponse({ content: [{ text: "x" }] });
    },
  });
  assert.ok(!withoutDirective.includes("Compliance directive"));
  assert.ok(withoutDirective.includes("helpful"));
});

test("multiple content blocks are joined into one reply", async () => {
  const reply = await generateReply({
    ...baseArgs,
    apiKey: "k",
    fetchImpl: async () => okResponse({ content: [{ text: "part one, " }, { text: "part two" }] }),
  });
  assert.equal(reply.text, "part one, part two");
});

// --- fallback behavior on failure ---

test("non-OK API response falls back to simulated with a diagnostic note", async () => {
  const reply = await generateReply({
    ...baseArgs,
    action: "escalate",
    apiKey: "k",
    fetchImpl: async () => new Response("rate limited", { status: 429 }),
  });
  assert.equal(reply.backend, "simulated");
  assert.ok(reply.text.includes("988")); // still action-aware
  assert.ok(reply.note.includes("llm_call_failed"));
  assert.ok(reply.note.includes("429"));
});

test("thrown fetch error falls back to simulated with a diagnostic note", async () => {
  const reply = await generateReply({
    ...baseArgs,
    apiKey: "k",
    fetchImpl: async () => {
      throw new Error("socket hang up");
    },
  });
  assert.equal(reply.backend, "simulated");
  assert.ok(reply.note.includes("llm_call_errored"));
  assert.ok(reply.note.includes("socket hang up"));
});

test("empty content from the API falls back to simulated text but reports the anthropic backend", async () => {
  const reply = await generateReply({
    ...baseArgs,
    apiKey: "k",
    fetchImpl: async () => okResponse({ content: [] }),
  });
  assert.equal(reply.backend, "anthropic");
  assert.ok(reply.text.length > 0);
});
