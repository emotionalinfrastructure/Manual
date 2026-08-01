// Per-session state, factored out of the HTTP layer so a store can be created
// per worker instance. Tests get isolation structurally (a fresh store per
// worker) rather than by resetting shared module-level state between cases.
//
// Two implementations share one interface:
//
//   getOrCreate(id) -> session      read, materialising an empty one if absent
//   get(id)         -> session|undefined
//   applyTurn(id, delta) -> session apply one completed turn, return the result
//
// Every method may return a promise; callers await unconditionally.
//
// applyTurn exists rather than "mutate the object you were handed" because a
// durable store has to write somewhere, and because the write must be
// atomic — see createDurableSessionStore.

export const MAX_HISTORY = 20; // sentiment scores kept for trend analysis
export const MAX_MESSAGES = 20; // 10 user/assistant turns of LLM context

export function newSession() {
  return {
    turnCount: 0,
    sentimentHistory: [],
    crisisTurnCount: 0,
    messages: [],
    createdAt: new Date().toISOString(),
    lastTurnAt: null,
  };
}

// Ceiling on distinct sessions held in memory. Session ids come from the
// caller, so an unbounded Map grows with the number of ids anyone cares to
// send. Eviction is least-recently-used: a Map iterates in insertion order,
// so re-inserting on every touch keeps the oldest entry first.
//
// This bound exists only on the in-memory fallback. The Durable Object path
// persists per session and is not subject to it — which is the reason to
// prefer a binding for anything real, since an evicted session silently
// restarts from turn zero, crisis count included.
export const MAX_SESSIONS = 10000;

export function createSessionStore({ maxSessions = MAX_SESSIONS } = {}) {
  const sessions = new Map();

  function touch(sessionId, session) {
    sessions.delete(sessionId);
    sessions.set(sessionId, session);
    if (sessions.size > maxSessions) {
      sessions.delete(sessions.keys().next().value);
    }
    return session;
  }

  return {
    getOrCreate(sessionId) {
      return touch(sessionId, sessions.get(sessionId) ?? newSession());
    },
    get(sessionId) {
      return sessions.get(sessionId);
    },
    applyTurn(sessionId, delta) {
      const session = touch(sessionId, sessions.get(sessionId) ?? newSession());
      return recordTurn(session, delta);
    },
  };
}

/**
 * Durable Object-backed store: session state survives isolate recycling, so a
 * conversation keeps its history and crisis count across the lifetime of the
 * conversation rather than the lifetime of a machine.
 *
 * Durable Objects rather than KV, deliberately. KV is eventually consistent,
 * and the value here includes crisisTurnCount — a counter that gates whether a
 * user gets treated as an ongoing concern. Two turns landing close together
 * against stale KV reads would silently drop an increment, which is a safety
 * regression that no test would catch. A Durable Object serialises all access
 * to a given session id, so increments cannot be lost.
 *
 * @param {DurableObjectNamespace} namespace
 */
export function createDurableSessionStore(namespace) {
  function stubFor(sessionId) {
    return namespace.get(namespace.idFromName(sessionId));
  }

  async function call(sessionId, path, body) {
    const stub = stubFor(sessionId);
    const res = await stub.fetch(`https://session${path}`, {
      method: body === undefined ? "GET" : "POST",
      ...(body === undefined
        ? {}
        : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    });
    return res.json();
  }

  return {
    async getOrCreate(sessionId) {
      return (await call(sessionId, "/")) ?? newSession();
    },
    async get(sessionId) {
      return (await call(sessionId, "/")) ?? undefined;
    },
    // The delta is applied inside the object, not read-modify-written from
    // here, so concurrent turns for one session cannot clobber each other.
    async applyTurn(sessionId, delta) {
      return call(sessionId, "/record", delta);
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
