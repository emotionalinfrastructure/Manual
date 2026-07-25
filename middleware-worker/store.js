// Session persistence. Two interchangeable backends behind one small async
// interface so the request handler never cares which is in use:
//
//   - "kv":     Cloudflare Workers KV (env.SESSIONS). State survives across
//               isolates, requests, and deploys — this is the production path.
//   - "memory": a process-lifetime Map, used when no KV binding is present.
//               Keeps the Node dev-server, the test suite, and the zero-config
//               demo running with no external dependency (same philosophy as
//               the simulated-LLM fallback in llm.js).
//
// Both backends expose load(id) / save(id, session). Callers always load, then
// mutate, then save — memory could get away with reference mutation, but KV
// cannot, so the explicit save keeps the two paths identical.

const MEMORY = new Map();

// Namespacing the key leaves room for other record types in the same KV
// namespace later without collisions.
const KEY_PREFIX = "session:";

// Expire idle sessions so a shared KV namespace doesn't grow without bound.
// 30 days; KV enforces a 60s minimum. Every save refreshes the window.
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

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

export function createSessionStore(env) {
  const kv = env && env.SESSIONS;

  if (kv) {
    return {
      backend: "kv",
      async load(id) {
        return (await kv.get(KEY_PREFIX + id, "json")) || null;
      },
      async save(id, session) {
        await kv.put(KEY_PREFIX + id, JSON.stringify(session), {
          expirationTtl: SESSION_TTL_SECONDS,
        });
      },
    };
  }

  return {
    backend: "memory",
    async load(id) {
      return MEMORY.get(id) || null;
    },
    async save(id, session) {
      MEMORY.set(id, session);
    },
  };
}

// Test-only hook: clears the in-memory backend so each test starts clean.
export function __resetMemory() {
  MEMORY.clear();
}
