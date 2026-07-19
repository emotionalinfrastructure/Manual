// Turns a raw emotion/safety analysis into a moderation decision + a system
// directive the caller can inject ahead of the underlying LLM's own prompt.
// This is the actual "middleware" behavior: it doesn't generate the AI's
// reply, it decides how the AI should be steered before it does.

const CRISIS_DIRECTIVE =
  "The user's message contains language associated with self-harm or suicidal ideation. " +
  "Respond with care, do not minimize their feelings, avoid clinical or dismissive tone, " +
  "and surface crisis resources (e.g. 988 Suicide & Crisis Lifeline in the US) before continuing the conversation.";

const ABUSE_DIRECTIVE =
  "The user's message contains hostile or abusive language directed at the assistant or a third party. " +
  "Stay calm and de-escalate. Do not mirror the hostility. Set a boundary if needed without being punitive.";

const NEGATIVE_DIRECTIVE =
  "The user appears to be in a negative emotional state. Lead with empathy, validate their feelings " +
  "before offering solutions, and keep the response warm rather than purely transactional.";

const PII_DIRECTIVE =
  "The user's message appears to contain personal identifying information (email/phone). " +
  "Avoid repeating it back verbatim in the response.";

export function decidePolicy(analysis, session) {
  const directives = [];
  let action = "allow";
  let severity = "none";

  if (analysis.flags.includes("crisis_language")) {
    action = "escalate";
    severity = "high";
    directives.push(CRISIS_DIRECTIVE);
  } else if (analysis.flags.includes("abusive_language")) {
    action = "soften";
    severity = "medium";
    directives.push(ABUSE_DIRECTIVE);
  } else if (analysis.sentiment_score <= -0.5 && analysis.intensity >= 0.3) {
    action = "soften";
    severity = "low";
    directives.push(NEGATIVE_DIRECTIVE);
  }

  if (analysis.flags.includes("pii_detected")) {
    directives.push(PII_DIRECTIVE);
    if (action === "allow") severity = "low";
  }

  // Escalate if a session has repeated crisis signals across turns, even if
  // any single message alone wouldn't have tripped it.
  if (action !== "escalate" && session.crisisTurnCount >= 2) {
    action = "escalate";
    severity = "high";
    directives.push(
      "This session has raised self-harm-adjacent language more than once. Treat this as an ongoing " +
        "concern, not an isolated remark, and continue to surface crisis resources."
    );
  }

  return {
    action,
    severity,
    system_directive: directives.length ? directives.join(" ") : null,
  };
}

export function summarizeTrend(scores) {
  if (scores.length === 0) return "neutral";
  if (scores.length === 1) return scores[0] > 0.15 ? "positive" : scores[0] < -0.15 ? "negative" : "neutral";

  const mid = Math.floor(scores.length / 2);
  const firstHalf = scores.slice(0, mid || 1);
  const secondHalf = scores.slice(mid || 1);
  const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const delta = avg(secondHalf) - avg(firstHalf);

  if (delta > 0.15) return "improving";
  if (delta < -0.15) return "declining";
  return "stable";
}
