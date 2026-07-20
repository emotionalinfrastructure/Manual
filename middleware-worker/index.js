import { analyzeMessage } from "./lexicon.js";
import { decidePolicy, summarizeTrend } from "./policy.js";
import { generateReply } from "./llm.js";
import { aiUseInventory, disclosureReview, qaFindings, releaseChecklist } from "./governance.js";
import { evaluateConformance, REQUIREMENTS, HARD_GATES_C2_C3 } from "./trustReceipt.js";

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
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
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

// Ops/monitoring console: summary of every session this isolate has seen,
// for a live view of trend and escalation state without pulling full history.
function handleListSessions() {
  const list = [...sessions.entries()].map(([sessionId, session]) => ({
    session_id: sessionId,
    turn_count: session.turnCount,
    crisis_turn_count: session.crisisTurnCount,
    trend: summarizeTrend(session.sentimentHistory),
    created_at: session.createdAt,
    last_turn_at: session.lastTurnAt,
  }));
  list.sort((a, b) => (b.last_turn_at || "").localeCompare(a.last_turn_at || ""));
  return json({ sessions: list });
}

// Generic REST handlers shared by the governance record-keeping instruments
// (AI Use Inventory, Disclosure Review Record, QA Findings Tracker). Each
// store exposes list/create/update/remove; the checklist store (fixed items,
// only `complete` is togglable) is routed separately below.
async function handleGovernanceCollection(request, store) {
  if (request.method === "GET") {
    return json({ items: store.list() });
  }
  if (request.method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "invalid_json" }, { status: 400 });
    }
    return json(store.create(body), { status: 201 });
  }
  return json({ error: "method_not_allowed" }, { status: 405 });
}

async function handleGovernanceItem(request, store, id) {
  if (request.method === "PATCH") {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "invalid_json" }, { status: 400 });
    }
    const updated = store.update(id, body);
    if (!updated) return json({ error: "not_found" }, { status: 404 });
    return json(updated);
  }
  if (request.method === "DELETE") {
    const removed = store.remove(id);
    if (!removed) return json({ error: "not_found" }, { status: 404 });
    return json({ deleted: true });
  }
  return json({ error: "method_not_allowed" }, { status: 405 });
}

const GOVERNANCE_STORES = {
  "ai-use": aiUseInventory,
  "disclosure-review": disclosureReview,
  "qa-findings": qaFindings,
};

// AI Trust Receipt: Conformance Decision Protocol (R1-R12). Stateless --
// evaluateConformance() is a pure function, so there's nothing to store here.
function handleTrustReceiptRequirements() {
  return json({ requirements: REQUIREMENTS, hard_gates_c2_c3: HARD_GATES_C2_C3 });
}

async function handleTrustReceiptEvaluate(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, { status: 400 });
  }
  try {
    const result = evaluateConformance({
      consequenceClass: body?.consequence_class,
      requirements: body?.requirements,
      evidenceUnavailable: body?.evidence_unavailable,
      receiptRequired: body?.receipt_required,
      rationaleApproved: body?.rationale_approved,
    });
    return json(result);
  } catch (err) {
    return json({ error: err.message }, { status: 400 });
  }
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
        endpoints: [
          "POST /v1/turn",
          "GET /v1/session/:id",
          "GET /v1/sessions",
          "GET|POST /v1/governance/ai-use",
          "PATCH|DELETE /v1/governance/ai-use/:id",
          "GET|POST /v1/governance/disclosure-review",
          "PATCH|DELETE /v1/governance/disclosure-review/:id",
          "GET|POST /v1/governance/qa-findings",
          "PATCH|DELETE /v1/governance/qa-findings/:id",
          "GET /v1/governance/release-checklist",
          "PATCH /v1/governance/release-checklist/:id",
          "GET /v1/trust-receipt/requirements",
          "POST /v1/trust-receipt/evaluate",
        ],
      });
    }

    if (url.pathname === "/v1/turn" && request.method === "POST") {
      return handleTurn(request, env);
    }

    const sessionMatch = url.pathname.match(/^\/v1\/session\/([^/]+)$/);
    if (sessionMatch && request.method === "GET") {
      return handleGetSession(decodeURIComponent(sessionMatch[1]));
    }

    // Everything below is console/admin surface: live session list, the
    // governance record-keeping instruments, and the Trust Receipt conformance
    // evaluator. Gated the same way as /v1/turn.
    if (
      url.pathname.startsWith("/v1/sessions") ||
      url.pathname.startsWith("/v1/governance/") ||
      url.pathname.startsWith("/v1/trust-receipt/")
    ) {
      if (!authorized(request, env)) {
        return json({ error: "unauthorized" }, { status: 401 });
      }
    }

    if (url.pathname === "/v1/sessions" && request.method === "GET") {
      return handleListSessions();
    }

    if (url.pathname === "/v1/governance/release-checklist" && request.method === "GET") {
      return json({ items: releaseChecklist.list() });
    }
    const checklistItemMatch = url.pathname.match(/^\/v1\/governance\/release-checklist\/([^/]+)$/);
    if (checklistItemMatch && request.method === "PATCH") {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "invalid_json" }, { status: 400 });
      }
      const updated = releaseChecklist.update(decodeURIComponent(checklistItemMatch[1]), body);
      if (!updated) return json({ error: "not_found" }, { status: 404 });
      return json(updated);
    }

    const collectionMatch = url.pathname.match(/^\/v1\/governance\/([^/]+)$/);
    if (collectionMatch && GOVERNANCE_STORES[collectionMatch[1]]) {
      return handleGovernanceCollection(request, GOVERNANCE_STORES[collectionMatch[1]]);
    }

    const itemMatch = url.pathname.match(/^\/v1\/governance\/([^/]+)\/([^/]+)$/);
    if (itemMatch && GOVERNANCE_STORES[itemMatch[1]]) {
      return handleGovernanceItem(request, GOVERNANCE_STORES[itemMatch[1]], decodeURIComponent(itemMatch[2]));
    }

    if (url.pathname === "/v1/trust-receipt/requirements" && request.method === "GET") {
      return handleTrustReceiptRequirements();
    }

    if (url.pathname === "/v1/trust-receipt/evaluate" && request.method === "POST") {
      return handleTrustReceiptEvaluate(request);
    }

    return json({ error: "not_found" }, { status: 404 });
  },
};
