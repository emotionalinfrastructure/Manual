import { analyzeMessage } from "./lexicon.js";
import { decidePolicy, summarizeTrend } from "./policy.js";
import { generateReply } from "./llm.js";
import { createSessionStore, recordTurn } from "./sessions.js";

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

function authorized(request, env) {
  if (!env.API_KEY) return true; // no key configured -> demo mode, allow all
  const auth = request.headers.get("authorization") || "";
  return auth === `Bearer ${env.API_KEY}`;
}

/**
 * Build a worker instance backed by its own session store. The default export
 * is one such instance — what Cloudflare deploys, with unchanged behaviour.
 * Tests construct their own instances, so session isolation is structural
 * rather than depending on shared state being reset between cases.
 *
 * Session state is in-memory per instance: it survives only for the life of a
 * Worker isolate. A production deployment would pass a store backed by a
 * Durable Object or KV (see README).
 */
export function createWorker({ sessions = createSessionStore() } = {}) {
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

    const analysis = analyzeMessage(user_message);
    const session = sessions.getOrCreate(session_id);

    const policy = decidePolicy(analysis, session);

    const reply = await generateReply({
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.ANTHROPIC_MODEL,
      systemDirective: policy.system_directive,
      action: policy.action,
      history: session.messages,
      userMessage: user_message,
    });

    recordTurn(session, {
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
      turn: session.turnCount,
      emotional_state: {
        sentiment_score: analysis.sentiment_score,
        primary_emotion: analysis.primary_emotion,
        intensity: analysis.intensity,
      },
      safety: {
        flags: analysis.flags,
        action: policy.action,
        severity: policy.severity,
      },
      suggested_system_directive: policy.system_directive,
      session_trend: summarizeTrend(session.sentimentHistory),
      crisis_turn_count: session.crisisTurnCount,
      assistant_reply: reply.text,
      llm_backend: reply.backend,
      ...(reply.note ? { llm_note: reply.note } : {}),
    });
  }

  function handleGetSession(sessionId) {
    const session = sessions.get(sessionId);
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
        return handleGetSession(decodeURIComponent(sessionMatch[1]));
      }

      return json({ error: "not_found" }, { status: 404 });
    },
  };
}

export default createWorker();
