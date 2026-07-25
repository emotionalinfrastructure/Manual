// Turns a raw emotion/safety analysis into a moderation decision + a system
// directive the caller can inject ahead of the underlying LLM's own prompt.
// This is the actual "middleware" behavior: it doesn't generate the AI's
// reply, it decides how the AI should be steered before it does.

const CRISIS_DIRECTIVE =
  "The user's message contains language associated with self-harm or suicidal ideation. " +
  "Respond with care, do not minimize their feelings, avoid clinical or dismissive tone, " +
  "and surface crisis resources (e.g. 988 Suicide & Crisis Lifeline in the US) before continuing the conversation.";

const THIRD_PARTY_CRISIS_DIRECTIVE =
  "The user appears to be describing someone else who may be at risk of self-harm, not disclosing about " +
  "themselves. Take the concern seriously and surface crisis resources (e.g. 988 Suicide & Crisis Lifeline " +
  "in the US, which also supports people helping someone else), but address the user as someone seeking help " +
  "for another person — do not imply you believe the user is personally in danger. Acknowledge that " +
  "supporting someone in crisis is hard on the supporter too.";

const CRISIS_TOPIC_DIRECTIVE =
  "The user's message mentions suicide or self-harm as a subject — for example in news, statistics, research, " +
  "history, or fiction — with no indication that anyone in the conversation is at risk. Do not treat the user " +
  "as though they are in crisis and do not open with crisis resources, which would be jarring and inaccurate. " +
  "Engage with the topic factually and with appropriate gravity, and if the conversation turns personal at any " +
  "point, respond to that instead.";

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

  // Crisis vocabulary is answered proportionately to who it refers to. All
  // three paths still surface support where a person may be at risk; only a
  // pure topic mention declines to treat the user as in crisis.
  const crisisContext = analysis.flags.includes("crisis_language")
    ? analysis.crisis_context || "first_person" // absent context: assume the riskier reading
    : null;

  if (crisisContext === "first_person") {
    action = "escalate";
    severity = "high";
    directives.push(CRISIS_DIRECTIVE);
  } else if (crisisContext === "third_party") {
    action = "escalate";
    severity = "medium";
    directives.push(THIRD_PARTY_CRISIS_DIRECTIVE);
  } else if (crisisContext === "topic_mention") {
    action = "allow";
    severity = "low";
    directives.push(CRISIS_TOPIC_DIRECTIVE);
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
