// Per-session state, factored out of the HTTP layer so a store can be created
// per worker instance. Tests get isolation structurally (a fresh store per
// worker) rather than by resetting shared module-level state between cases.

export const MAX_HISTORY = 20; // sentiment scores kept for trend analysis
export const MAX_MESSAGES = 20; // 10 user/assistant turns of LLM context

export function createSessionStore() {
  const sessions = new Map();
  return {
    getOrCreate(sessionId) {
      if (!sessions.has(sessionId)) {
        sessions.set(sessionId, {
          turnCount: 0,
          sentimentHistory: [],
          crisisTurnCount: 0,
          messages: [],
          createdAt: new Date().toISOString(),
          lastTurnAt: null,
        });
      }
      return sessions.get(sessionId);
    },
    get(sessionId) {
      return sessions.get(sessionId);
    },
  };
}

/**
 * Apply one completed turn to a session: bump counters, append bounded
 * sentiment and message history. Mutates and returns the session.
 */
export function recordTurn(session, { sentimentScore, isCrisis, userMessage, assistantReply }) {
  session.turnCount += 1;
  session.sentimentHistory.push(sentimentScore);
  if (session.sentimentHistory.length > MAX_HISTORY) session.sentimentHistory.shift();
  if (isCrisis) session.crisisTurnCount += 1;
  session.messages.push({ role: "user", content: userMessage });
  session.messages.push({ role: "assistant", content: assistantReply });
  if (session.messages.length > MAX_MESSAGES) session.messages = session.messages.slice(-MAX_MESSAGES);
  session.lastTurnAt = new Date().toISOString();
  return session;
}
