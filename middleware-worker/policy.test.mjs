import assert from "node:assert/strict";
import { test } from "node:test";
import { decidePolicy, summarizeTrend } from "./policy.js";

// Minimal analysis fixture builder. decidePolicy only reads `flags`,
// `sentiment_score`, and `intensity`, so we keep the rest out of the way.
function analysis({ flags = [], sentiment_score = 0, intensity = 0 } = {}) {
  return { flags, sentiment_score, intensity };
}

function session({ crisisTurnCount = 0 } = {}) {
  return { crisisTurnCount };
}

// --- Decision hierarchy -----------------------------------------------------

test("crisis takes precedence over abuse, negativity, and sentiment", () => {
  // A message that trips every lower signal at once must still escalate.
  const policy = decidePolicy(
    analysis({
      flags: ["crisis_language", "abusive_language"],
      sentiment_score: -1,
      intensity: 1,
    }),
    session()
  );
  assert.equal(policy.action, "escalate");
  assert.equal(policy.severity, "high");
  assert.match(policy.system_directive, /self-harm or suicidal ideation/);
  // The crisis directive wins; abuse/negative directives must not have been the driver.
  assert.doesNotMatch(policy.system_directive, /de-escalate/);
});

test("abuse takes precedence over ordinary negative-language handling", () => {
  const policy = decidePolicy(
    analysis({ flags: ["abusive_language"], sentiment_score: -0.9, intensity: 0.8 }),
    session()
  );
  assert.equal(policy.action, "soften");
  assert.equal(policy.severity, "medium");
  assert.match(policy.system_directive, /de-escalate/);
  // Not the plain negative directive.
  assert.doesNotMatch(policy.system_directive, /negative emotional state/);
});

test("strong negative sentiment softens with low severity", () => {
  const policy = decidePolicy(
    analysis({ sentiment_score: -0.6, intensity: 0.4 }),
    session()
  );
  assert.equal(policy.action, "soften");
  assert.equal(policy.severity, "low");
  assert.match(policy.system_directive, /negative emotional state/);
});

test("negative sentiment below the intensity threshold is allowed", () => {
  // sentiment <= -0.5 but intensity < 0.3 -> not enough to soften.
  const policy = decidePolicy(
    analysis({ sentiment_score: -0.8, intensity: 0.2 }),
    session()
  );
  assert.equal(policy.action, "allow");
  assert.equal(policy.severity, "none");
  assert.equal(policy.system_directive, null);
});

test("neutral message is allowed with no directive", () => {
  const policy = decidePolicy(analysis(), session());
  assert.equal(policy.action, "allow");
  assert.equal(policy.severity, "none");
  assert.equal(policy.system_directive, null);
});

// --- PII stacking -----------------------------------------------------------

test("PII on an otherwise-allow decision adds a directive and bumps severity to low", () => {
  const policy = decidePolicy(analysis({ flags: ["pii_detected"] }), session());
  assert.equal(policy.action, "allow");
  assert.equal(policy.severity, "low");
  assert.match(policy.system_directive, /personal identifying information/);
});

test("PII stacks onto crisis without weakening the high-severity escalation", () => {
  const policy = decidePolicy(
    analysis({ flags: ["crisis_language", "pii_detected"] }),
    session()
  );
  assert.equal(policy.action, "escalate");
  assert.equal(policy.severity, "high"); // NOT downgraded to low by the PII branch
  assert.match(policy.system_directive, /self-harm or suicidal ideation/);
  assert.match(policy.system_directive, /personal identifying information/);
});

test("PII stacks onto abuse without weakening the medium-severity soften", () => {
  const policy = decidePolicy(
    analysis({ flags: ["abusive_language", "pii_detected"] }),
    session()
  );
  assert.equal(policy.action, "soften");
  assert.equal(policy.severity, "medium"); // PII branch must not lower this
  assert.match(policy.system_directive, /de-escalate/);
  assert.match(policy.system_directive, /personal identifying information/);
});

// --- Repeated-crisis session escalation ------------------------------------

test("repeated crisis signals escalate a later non-crisis message (threshold met)", () => {
  // Prior turns already logged >= 2 crisis messages; the current message is benign.
  const policy = decidePolicy(analysis(), session({ crisisTurnCount: 2 }));
  assert.equal(policy.action, "escalate");
  assert.equal(policy.severity, "high");
  assert.match(policy.system_directive, /raised self-harm-adjacent language more than once/);
});

test("a single prior crisis signal does NOT escalate an ordinary message (boundary)", () => {
  const policy = decidePolicy(analysis(), session({ crisisTurnCount: 1 }));
  assert.equal(policy.action, "allow");
  assert.equal(policy.severity, "none");
  assert.equal(policy.system_directive, null);
});

test("ambiguous negative message under repeated-crisis threshold is not over-escalated", () => {
  // Mildly negative but not crisis, only one prior crisis turn -> soften at most, never escalate.
  const policy = decidePolicy(
    analysis({ sentiment_score: -0.6, intensity: 0.4 }),
    session({ crisisTurnCount: 1 })
  );
  assert.notEqual(policy.action, "escalate");
  assert.equal(policy.action, "soften");
});

test("repeated-crisis directive is not double-added when the current message is itself crisis", () => {
  const policy = decidePolicy(
    analysis({ flags: ["crisis_language"] }),
    session({ crisisTurnCount: 5 })
  );
  assert.equal(policy.action, "escalate");
  assert.equal(policy.severity, "high");
  // The primary crisis directive is present; the repeated-session addendum is
  // guarded by `action !== "escalate"` so it should not appear a second time.
  assert.match(policy.system_directive, /self-harm or suicidal ideation/);
  assert.doesNotMatch(policy.system_directive, /raised self-harm-adjacent language more than once/);
});

// --- summarizeTrend ---------------------------------------------------------

test("summarizeTrend: empty history is neutral", () => {
  assert.equal(summarizeTrend([]), "neutral");
});

test("summarizeTrend: single element classifies by sign", () => {
  assert.equal(summarizeTrend([0.5]), "positive");
  assert.equal(summarizeTrend([-0.5]), "negative");
  assert.equal(summarizeTrend([0.1]), "neutral"); // within the +/-0.15 dead band
});

test("summarizeTrend: rising history is improving", () => {
  assert.equal(summarizeTrend([-0.8, -0.5, 0.5, 0.8]), "improving");
});

test("summarizeTrend: falling history is declining", () => {
  assert.equal(summarizeTrend([0.8, 0.5, -0.5, -0.8]), "declining");
});

test("summarizeTrend: flat history is stable", () => {
  assert.equal(summarizeTrend([0.1, 0.1, 0.1, 0.1]), "stable");
});

// --- Crisis context drives a proportionate response --------------------------

function crisisAnalysis(context, extra = {}) {
  return {
    flags: ["crisis_language"],
    crisis_context: context,
    sentiment_score: 0,
    intensity: 0,
    ...extra,
  };
}

test("first-person disclosure escalates at high severity", () => {
  const p = decidePolicy(crisisAnalysis("first_person"), { crisisTurnCount: 0 });
  assert.equal(p.action, "escalate");
  assert.equal(p.severity, "high");
  assert.match(p.system_directive, /surface crisis resources/);
});

test("third-party concern escalates at medium severity with its own directive", () => {
  const p = decidePolicy(crisisAnalysis("third_party"), { crisisTurnCount: 0 });
  assert.equal(p.action, "escalate");
  assert.equal(p.severity, "medium");
  // Still surfaces resources, but addresses the user as a helper.
  assert.match(p.system_directive, /describing someone else/);
  assert.match(p.system_directive, /988/);
  assert.doesNotMatch(p.system_directive, /do not minimize their feelings/);
});

test("topic mention is allowed and explicitly does not open with crisis resources", () => {
  const p = decidePolicy(crisisAnalysis("topic_mention"), { crisisTurnCount: 0 });
  assert.equal(p.action, "allow");
  assert.equal(p.severity, "low");
  assert.match(p.system_directive, /do not open with crisis resources/);
  assert.match(p.system_directive, /if the conversation turns personal/);
});

test("missing crisis_context falls back to the riskier first-person reading", () => {
  // Defensive: an analysis from an older/partial producer must not silently
  // downgrade a crisis flag to a topic mention.
  const p = decidePolicy({ flags: ["crisis_language"], sentiment_score: 0, intensity: 0 }, {
    crisisTurnCount: 0,
  });
  assert.equal(p.action, "escalate");
  assert.equal(p.severity, "high");
});

test("PII still stacks onto each crisis context", () => {
  for (const [context, action] of [
    ["first_person", "escalate"],
    ["third_party", "escalate"],
    ["topic_mention", "allow"],
  ]) {
    const p = decidePolicy(
      crisisAnalysis(context, { flags: ["crisis_language", "pii_detected"] }),
      { crisisTurnCount: 0 }
    );
    assert.equal(p.action, action, context);
    assert.match(p.system_directive, /personal identifying information/, context);
  }
});

test("session-level repeated-crisis escalation still overrides a topic mention", () => {
  // A user with two prior first-person crisis turns is treated as an ongoing
  // concern even if the current message is only subject matter.
  const p = decidePolicy(crisisAnalysis("topic_mention"), { crisisTurnCount: 2 });
  assert.equal(p.action, "escalate");
  assert.equal(p.severity, "high");
  assert.match(p.system_directive, /ongoing/);
});
