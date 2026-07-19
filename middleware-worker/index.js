import { analyzeMessage } from "./lexicon.js";
import { decidePolicy, summarizeTrend } from "./policy.js";
import { generateReply } from "./llm.js";

// In-memory session store. Good enough for a single-isolate demo; a real
// deployment would back this with a Durable Object or KV so state survives
// across isolates/requests. See README for the upgrade path.
const sessions = new Map();
const MAX_HISTORY = 20;
const MAX_MESSAGES = 20; // 10 user/assistant turns of LLM context

function getSession(sessionId) {
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
}

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
  const session = getSession(session_id);

  const policy = decidePolicy(analysis, session);

  const reply = await generateReply({
    apiKey: env.ANTHROPIC_API_KEY,
    model: env.ANTHROPIC_MODEL,
    systemDirective: policy.system_directive,
    action: policy.action,
    history: session.messages,
    userMessage: user_message,
  });

  session.turnCount += 1;
  session.sentimentHistory.push(analysis.sentiment_score);
  if (session.sentimentHistory.length > MAX_HISTORY) session.sentimentHistory.shift();
  if (analysis.flags.includes("crisis_language")) session.crisisTurnCount += 1;
  session.messages.push({ role: "user", content: user_message });
  session.messages.push({ role: "assistant", content: reply.text });
  if (session.messages.length > MAX_MESSAGES) session.messages = session.messages.slice(-MAX_MESSAGES);
  session.lastTurnAt = new Date().toISOString();

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

export default {
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
