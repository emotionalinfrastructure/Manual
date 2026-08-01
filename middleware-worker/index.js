import { analyzeMessage } from "./lexicon.js";
import { decidePolicy, summarizeTrend } from "./policy.js";
import { generateReply } from "./llm.js";
import { createSessionStore, createDurableSessionStore } from "./sessions.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(body, init = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    ...init,
    headers: { "content-type": "application/json", ...CORS_HEADERS, ...(init.headers || {}) },
  });
}

// Upper bounds on caller-controlled input. Without them a single request can
// hand the analyzer an arbitrarily large string, and every pass over that
// string is work the isolate cannot interrupt. 8 KB is far above any real
// conversational turn while keeping the worst-case analysis cost negligible.
export const MAX_USER_MESSAGE_CHARS = 8192;
export const MAX_SESSION_ID_CHARS = 200;

/**
 * Compare two strings without leaking, through timing, how far they matched.
 *
 * `===` on strings short-circuits at the first differing byte, which turns a
 * secret comparison into a per-character oracle. Workers have no
 * timingSafeEqual, so this walks the full length of both strings and folds
 * every difference into one accumulator.
 */
function timingSafeEqual(a, b) {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function authorized(request, env) {
  if (!env.API_KEY) return true; // no key configured -> demo mode, allow all
  const auth = request.headers.get("authorization") || "";
  return timingSafeEqual(auth, `Bearer ${env.API_KEY}`);
}

/**
 * Build a worker instance backed by a session store. The default export is one
 * such instance — what Cloudflare deploys.
 *
 * Store selection, in order:
 *   1. an explicitly injected store (tests, and any caller wiring its own);
 *   2. the SESSIONS Durable Object binding, when the deployment has one —
 *      state then survives isolate recycling;
 *   3. an in-memory store, so the demo runs with no bindings configured at
 *      all. That state lives only as long as the isolate.
 *
 * The binding is resolved per request because `env` does not exist at module
 * construction time.
 */
export function createWorker({ sessions: injectedSessions } = {}) {
  const fallbackStore = injectedSessions ?? createSessionStore();
  let durableStore;

  function storeFor(env) {
    if (injectedSessions) return injectedSessions;
    if (env && env.SESSIONS) {
      durableStore ??= createDurableSessionStore(env.SESSIONS);
      return durableStore;
    }
    return fallbackStore;
  }

  // Which store actually served this request. Reported so an operator can tell
  // durable state from state that silently disappears when an isolate is
  // recycled — "sessions look fine locally" is exactly how that goes unnoticed,
  // because locally it always works.
  function backendFor(env) {
    if (injectedSessions) return "injected";
    if (env && env.SESSIONS) return "durable_object";
    return "memory";
  }

  async function handleTurn(request, env) {
    if (!authorized(request, env)) {
      return json({ error: "unauthorized" }, { status: 401 });
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: "invalid_json" }, { status: 400 });
    }

    const { session_id, user_message } = payload || {};
    if (!session_id || typeof session_id !== "string") {
      return json({ error: "session_id is required" }, { status: 400 });
    }
    if (!user_message || typeof user_message !== "string") {
      return json({ error: "user_message is required" }, { status: 400 });
    }
    if (session_id.length > MAX_SESSION_ID_CHARS) {
      return json(
        { error: "session_id too long", max_chars: MAX_SESSION_ID_CHARS },
        { status: 400 }
      );
    }
    if (user_message.length > MAX_USER_MESSAGE_CHARS) {
      return json(
        { error: "user_message too long", max_chars: MAX_USER_MESSAGE_CHARS },
        { status: 413 }
      );
    }

    const analysis = analyzeMessage(user_message);
    const sessions = storeFor(env);
    const session = await sessions.getOrCreate(session_id);

    const policy = decidePolicy(analysis, session);

    const reply = await generateReply({
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.ANTHROPIC_MODEL,
      systemDirective: policy.system_directive,
      action: policy.action,
      history: session.messages,
      userMessage: user_message,
    });

    // The store applies the delta and returns the result, rather than the
    // handler mutating an object it happens to hold. On the durable path the
    // apply happens inside the Durable Object, so two turns racing on one
    // session cannot lose an increment.
    const updated = await sessions.applyTurn(session_id, {
      sentimentScore: analysis.sentiment_score,
      // Only first-person disclosures count toward the repeated-crisis
      // boundary: that rule exists to catch a user's own escalating risk, and
      // asking about a friend twice, or discussing the topic twice, is not
      // that. Must stay narrower than the crisis_language flag.
      isCrisis: analysis.crisis_context === "first_person",
      userMessage: user_message,
      assistantReply: reply.text,
    });

    return json({
      session_id,
      turn: updated.turnCount,
      emotional_state: {
        sentiment_score: analysis.sentiment_score,
        primary_emotion: analysis.primary_emotion,
        intensity: analysis.intensity,
      },
      safety: {
        flags: analysis.flags,
        action: policy.action,
        severity: policy.severity,
        // Why this action was chosen, not just what it was. Without it a
        // caller sees "escalate" for both a disclosure and a question about
        // a friend, with no way to tell the two apart. null when no crisis
        // vocabulary was present.
        crisis_context: analysis.crisis_context ?? null,
      },
      suggested_system_directive: policy.system_directive,
      session_trend: summarizeTrend(updated.sentimentHistory),
      crisis_turn_count: updated.crisisTurnCount,
      session_store: backendFor(env),
      assistant_reply: reply.text,
      llm_backend: reply.backend,
      ...(reply.note ? { llm_note: reply.note } : {}),
    });
  }

  async function handleGetSession(request, sessionId, env) {
    // Same gate as handleTurn. This endpoint returns the full transcript —
    // disclosures and any PII in them — so leaving it open while the write
    // path was authenticated meant a configured API_KEY protected nothing:
    // session ids are caller-chosen and therefore guessable.
    if (!authorized(request, env)) {
      return json({ error: "unauthorized" }, { status: 401 });
    }

    const session = await storeFor(env).get(sessionId);
    if (!session) {
      return json({ error: "session_not_found" }, { status: 404 });
    }
    return json({
      session_id: sessionId,
      turn_count: session.turnCount,
      crisis_turn_count: session.crisisTurnCount,
      sentiment_history: session.sentimentHistory,
      trend: summarizeTrend(session.sentimentHistory),
      messages: session.messages,
      created_at: session.createdAt,
      last_turn_at: session.lastTurnAt,
    });
  }

  return {
    async fetch(request, env) {
      const url = new URL(request.url);

      if (request.method === "OPTIONS") {
        return new Response(null, { headers: CORS_HEADERS });
      }

      if (url.pathname === "/" || url.pathname === "/health") {
        return json({
          status: "ok",
          message: "Emotional Infrastructure Middleware running",
          endpoints: ["POST /v1/turn", "GET /v1/session/:id"],
        });
      }

      if (url.pathname === "/v1/turn" && request.method === "POST") {
        return handleTurn(request, env);
      }

      const sessionMatch = url.pathname.match(/^\/v1\/session\/([^/]+)$/);
      if (sessionMatch && request.method === "GET") {
        return handleGetSession(request, decodeURIComponent(sessionMatch[1]), env);
      }

      return json({ error: "not_found" }, { status: 404 });
    },
  };
}

export default createWorker();

// Re-exported so wrangler can find the Durable Object class on the entrypoint
// module, which is where it looks for `durable_objects.bindings[].class_name`.
export { SessionObject } from "./session-object.js";
