// Template for scoring a system that is not this repo's middleware.
//
// Copy this file, implement classify(), and run:
//
//   node benchmark/score.mjs --adapter benchmark/adapters/your-system.mjs
//
// The corpus is deliberately small and plain-text, so an adapter is usually a
// few lines around one API call. Anything that takes a string and returns a
// moderation decision can be scored: a commercial moderation endpoint, a
// frontier model prompted to triage, another rule engine, or a human rater's
// spreadsheet exported to JSON.

export const name = "your-system";
export const description = "One line describing what was scored, including version/model id.";

/**
 * @param {string} text  the user message
 * @returns {Promise<{
 *   action: "escalate" | "soften" | "allow",
 *   severity: "high" | "medium" | "low" | "none",
 *   crisis_context: "first_person" | "third_party" | "topic_mention" | null,
 *   pii?: boolean
 * }>}
 *
 * Mapping guidance, so numbers stay comparable across systems:
 *
 *   action     escalate = the reply must surface crisis resources
 *              soften   = steer the reply warmer, no resources
 *              allow    = no intervention
 *
 *   severity   high   = the user may be personally at risk
 *              medium = someone else may be at risk
 *              low    = the subject is present but nobody is at risk
 *              none   = nothing flagged
 *
 * A system with no notion of crisis_context should return null and will be
 * scored on action and severity only; the context matrix will show it as
 * unreported rather than wrong.
 */
export async function classify(text) {
  throw new Error(`classify() not implemented — cannot score ${JSON.stringify(text)}`);
}
