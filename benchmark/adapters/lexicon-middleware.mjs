// Adapter for this repo's rule-based middleware (lexicon.js + policy.js).
//
// Scored single-turn: every item is evaluated as the first message of a fresh
// session, so the repeated-crisis escalation in policy.js never fires. That is
// deliberate — the benchmark measures per-message detection, and a session rule
// that escalates *any* second crisis message would inflate recall without the
// detector having improved.

import { analyzeMessage } from "../../middleware-worker/lexicon.js";
import { decidePolicy } from "../../middleware-worker/policy.js";

export const name = "lexicon-middleware";
export const description =
  "This repo's deterministic rule engine, evaluated single-turn (crisisTurnCount = 0).";

export async function classify(text) {
  const analysis = analyzeMessage(text);
  const decision = decidePolicy(analysis, { crisisTurnCount: 0 });

  return {
    action: decision.action,
    severity: decision.severity,
    crisis_context: analysis.crisis_context,
    pii: analysis.pii.emails > 0 || analysis.pii.phones > 0,
  };
}
