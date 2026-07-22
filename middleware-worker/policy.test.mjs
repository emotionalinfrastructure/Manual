import assert from "node:assert/strict";
import { test } from "node:test";
import { decidePolicy, summarizeTrend } from "./policy.js";

function makeAnalysis({ flags = [], sentiment = 0, intensity = 0 } = {}) {
  return { flags, sentiment_score: sentiment, intensity };
}

function makeSession({ crisisTurnCount = 0 } = {}) {
  return { crisisTurnCount };
}

// --- action selection ---

test("neutral analysis is allowed with no directive", () => {
  const policy = decidePolicy(makeAnalysis(), makeSession());
  assert.equal(policy.action, "allow");
  assert.equal(policy.severity, "none");
  assert.equal(policy.system_directive, null);
});

test("crisis flag escalates at high severity with the crisis directive", () => {
  const policy = decidePolicy(makeAnalysis({ flags: ["crisis_language"] }), makeSession());
  assert.equal(policy.action, "escalate");
  assert.equal(policy.severity, "high");
  assert.ok(policy.system_directive.includes("self-harm"));
  assert.ok(policy.system_directive.includes("988"));
});

test("abuse flag softens at medium severity with the de-escalation directive", () => {
  const policy = decidePolicy(makeAnalysis({ flags: ["abusive_language"] }), makeSession());
  assert.equal(policy.action, "soften");
  assert.equal(policy.severity, "medium");
  assert.ok(policy.system_directive.includes("de-escalate"));
});

test("negative sentiment at sufficient intensity softens at low severity", () => {
  const policy = decidePolicy(makeAnalysis({ sentiment: -0.8, intensity: 0.5 }), makeSession());
  assert.equal(policy.action, "soften");
  assert.equal(policy.severity, "low");
  assert.ok(policy.system_directive.includes("empathy"));
});

// --- decision precedence ---

test("crisis takes precedence over abuse", () => {
  const policy = decidePolicy(
    makeAnalysis({ flags: ["crisis_language", "abusive_language"], sentiment: -1, intensity: 1 }),
    makeSession()
  );
  assert.equal(policy.action, "escalate");
  assert.equal(policy.severity, "high");
  assert.ok(policy.system_directive.includes("self-harm"));
  assert.ok(!policy.system_directive.includes("de-escalate"));
});

test("abuse takes precedence over negative sentiment", () => {
  const policy = decidePolicy(
    makeAnalysis({ flags: ["abusive_language"], sentiment: -1, intensity: 1 }),
    makeSession()
  );
  assert.equal(policy.action, "soften");
  assert.equal(policy.severity, "medium");
  assert.ok(policy.system_directive.includes("de-escalate"));
  assert.ok(!policy.system_directive.includes("empathy"));
});

// --- negative-sentiment thresholds (boundary values) ---

test("sentiment/intensity threshold boundaries are inclusive", () => {
  const at = decidePolicy(makeAnalysis({ sentiment: -0.5, intensity: 0.3 }), makeSession());
  assert.equal(at.action, "soften");

  const sentimentJustAbove = decidePolicy(makeAnalysis({ sentiment: -0.49, intensity: 0.3 }), makeSession());
  assert.equal(sentimentJustAbove.action, "allow");

  const intensityJustBelow = decidePolicy(makeAnalysis({ sentiment: -0.5, intensity: 0.29 }), makeSession());
  assert.equal(intensityJustBelow.action, "allow");
});

// --- PII stacking ---

test("PII on an otherwise-allowed message stays allowed at low severity with the PII directive", () => {
  const policy = decidePolicy(makeAnalysis({ flags: ["pii_detected"] }), makeSession());
  assert.equal(policy.action, "allow");
  assert.equal(policy.severity, "low");
  assert.ok(policy.system_directive.includes("personal identifying information"));
});

test("PII stacks onto a crisis escalation: both directives, severity stays high", () => {
  const policy = decidePolicy(
    makeAnalysis({ flags: ["crisis_language", "pii_detected"] }),
    makeSession()
  );
  assert.equal(policy.action, "escalate");
  assert.equal(policy.severity, "high");
  assert.ok(policy.system_directive.includes("self-harm"));
  assert.ok(policy.system_directive.includes("personal identifying information"));
});

test("PII stacks onto a sentiment soften without downgrading severity", () => {
  const policy = decidePolicy(
    makeAnalysis({ flags: ["pii_detected"], sentiment: -1, intensity: 0.5 }),
    makeSession()
  );
  assert.equal(policy.action, "soften");
  assert.equal(policy.severity, "low");
  assert.ok(policy.system_directive.includes("empathy"));
  assert.ok(policy.system_directive.includes("personal identifying information"));
});

// --- repeated-crisis session boundary ---

test("session with one prior crisis turn does not escalate a benign message", () => {
  const policy = decidePolicy(makeAnalysis(), makeSession({ crisisTurnCount: 1 }));
  assert.equal(policy.action, "allow");
});

test("session with two prior crisis turns escalates even a benign message", () => {
  const policy = decidePolicy(makeAnalysis(), makeSession({ crisisTurnCount: 2 }));
  assert.equal(policy.action, "escalate");
  assert.equal(policy.severity, "high");
  assert.ok(policy.system_directive.includes("ongoing"));
});

test("session-crisis escalation upgrades an abuse soften", () => {
  const policy = decidePolicy(
    makeAnalysis({ flags: ["abusive_language"] }),
    makeSession({ crisisTurnCount: 2 })
  );
  assert.equal(policy.action, "escalate");
  assert.equal(policy.severity, "high");
  // Both concerns are represented in the combined directive.
  assert.ok(policy.system_directive.includes("de-escalate"));
  assert.ok(policy.system_directive.includes("ongoing"));
});

test("message-level crisis escalation does not duplicate the session-crisis directive", () => {
  const policy = decidePolicy(
    makeAnalysis({ flags: ["crisis_language"] }),
    makeSession({ crisisTurnCount: 5 })
  );
  assert.equal(policy.action, "escalate");
  assert.ok(!policy.system_directive.includes("ongoing"));
});

// --- trend summarization ---

test("summarizeTrend on no history is neutral", () => {
  assert.equal(summarizeTrend([]), "neutral");
});

test("summarizeTrend on a single score classifies by sign with a neutral band", () => {
  assert.equal(summarizeTrend([0.2]), "positive");
  assert.equal(summarizeTrend([-0.2]), "negative");
  assert.equal(summarizeTrend([0.1]), "neutral");
  assert.equal(summarizeTrend([-0.1]), "neutral");
});

test("summarizeTrend detects improvement, decline, and stability across halves", () => {
  assert.equal(summarizeTrend([-1, -1, 1, 1]), "improving");
  assert.equal(summarizeTrend([1, 1, -1, -1]), "declining");
  assert.equal(summarizeTrend([0.5, 0.5, 0.5, 0.5]), "stable");
  assert.equal(summarizeTrend([-1, 1]), "improving");
  assert.equal(summarizeTrend([1, -1]), "declining");
});
