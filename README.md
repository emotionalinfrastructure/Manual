# Emotional Infrastructure Middleware

A compliance & safety layer that sits between a chat UI and an LLM. On every
turn it scores the user's message for emotional tone and safety risk, decides
whether the conversation needs to be softened or escalated, builds a system
directive from that decision, and uses it to steer the actual model call that
generates the reply.

```
frontend/            Static demo chat UI + admin console (vanilla HTML/CSS/JS)
middleware-worker/    Cloudflare Worker implementing POST /v1/turn
sdk/                  @emotional-infrastructure/sdk -- standalone TypeScript governance library
eios-review/          Spec review + implementation plan for an unrelated product (EIOS v1.0.1)
```

## SDK

`sdk/` is `@emotional-infrastructure/sdk` (v0.2.0, release candidate): a
standalone TypeScript library for consent lifecycle management (Consent Token
IDs, state machine, tolerance windows), audit traceability (append-only
event ledger, trace validation), and trust repair workflows. It's an
independent package from the middleware below -- see `sdk/README.md` for
its own install/quick-start/architecture docs, and
`sdk/docs/release-package/npm/RELEASE_CHECKLIST.md` for what's left before
publishing to npm. Verify it locally with:

```bash
cd sdk
npm ci
npm run typecheck && npm run lint && npm test && npm run build && npm pack --dry-run
```

CI for this package runs from `.github/workflows/sdk-ci.yml`, scoped to
changes under `sdk/`.

## How it works

`POST /v1/turn` takes `{ session_id, user_message }` and returns:

```json
{
  "session_id": "demo-123",
  "turn": 1,
  "emotional_state": { "sentiment_score": -0.8, "primary_emotion": "sadness", "intensity": 0.6 },
  "safety": { "flags": ["crisis_language"], "action": "escalate", "severity": "high" },
  "suggested_system_directive": "The user's message contains language associated with self-harm...",
  "session_trend": "declining",
  "assistant_reply": "I want to make sure you're safe first...",
  "llm_backend": "anthropic"
}
```

- **`middleware-worker/lexicon.js`** — rule-based emotion/sentiment scoring and
  crisis/abuse/PII detection. Deterministic, no external ML dependency.
- **`middleware-worker/policy.js`** — turns an analysis into an `allow` /
  `soften` / `escalate` decision and the directive text to inject ahead of the
  LLM's system prompt. Also escalates a session that has raised crisis
  language more than once, even if a single message wouldn't trip it alone.
- **`middleware-worker/llm.js`** — actually generates the reply: builds the
  system prompt (base persona + injected directive) and calls the Anthropic
  Messages API with the session's conversation history. If no
  `ANTHROPIC_API_KEY` is configured, it falls back to a deterministic,
  action-aware simulated reply (still distinct per `allow`/`soften`/`escalate`)
  so the full pipeline runs with zero external dependencies.
- **`middleware-worker/index.js`** — the Worker's HTTP surface (`/v1/turn`,
  `/v1/session/:id`, `/v1/sessions`, `/v1/governance/*`,
  `/v1/trust-receipt/*`, CORS, optional `API_KEY` bearer auth) plus in-memory
  per-session state (turn count, sentiment trend, crisis count, and the
  message history used as LLM context).
- **`middleware-worker/governance.js`** — in-memory CRUD stores for the
  governance record-keeping instruments defined in the Emotional
  Infrastructure Professional Governance Manual: the AI Use Inventory and
  Disclosure Review Record (Product Front Matter), the QA Findings Tracker
  (Appendix F), and the Release Readiness Checklist (Appendix I).
- **`middleware-worker/trustReceipt.js`** — a deterministic, noncompensatory
  decision engine implementing the AI Trust Receipt Workbook's Conformance
  Decision Protocol (Worksheet 5.4A–D / Technical Profile 5.4C): evaluates
  requirements R1–R12 and produces an overall conformance decision
  (`conforms` / `conditional` / `does_not_conform` / `not_triggered`) plus a
  deployment mode. `trustReceipt.test.mjs` reproduces the workbook's own
  normative test vectors T01–T09 exactly.

## Admin console

`frontend/console.html` is a live monitoring + governance record-keeping
console for the middleware, separate from the demo chat UI:

- **Live Sessions** — every session this Worker isolate has seen, with turn
  count, sentiment trend, and crisis-escalation count (`GET /v1/sessions`).
- **AI Use Inventory**, **Disclosure Review**, **QA Findings Tracker** — add,
  edit, and delete records via `GET/POST /v1/governance/:kind` and
  `PATCH/DELETE /v1/governance/:kind/:id` (`kind` is `ai-use`,
  `disclosure-review`, or `qa-findings`).
- **Release Readiness Checklist** — the fixed Appendix I.1 gate list; toggle
  items complete via `PATCH /v1/governance/release-checklist/:id`.
- **Trust Receipt Conformance** — set a consequence class (C0–C3) and a
  Pass/Partial/Fail result (plus an "evidence unavailable" flag) for each of
  the twelve requirements, then evaluate via `POST /v1/trust-receipt/evaluate`
  to see the resulting conformance decision and deployment mode. The
  requirement catalog itself comes from `GET /v1/trust-receipt/requirements`.

`/v1/sessions`, `/v1/governance/*`, and `/v1/trust-receipt/*` are gated by the
same `API_KEY` bearer check as `/v1/turn` when one is configured. Governance
records and session state are in-memory and reset when the Worker isolate
restarts (see below).

This is a demo-grade rule engine, not a clinical risk model — the crisis
phrase list is narrow and literal by design. A production deployment should
route flagged messages to a reviewed detection service and back session state
with a Durable Object or KV instead of the in-memory `Map` used here (which
only persists for the lifetime of a single Worker isolate).

## Run the demo

No Cloudflare account required — the worker is plain Request/Response code
that also runs directly under Node.

```bash
cd middleware-worker
npm run test   # unit tests for the scoring/policy logic
npm run dev    # starts the middleware on http://localhost:8787
```

In another terminal, serve the frontend and open it in a browser:

```bash
cd frontend
python3 -m http.server 8080
# chat demo:  http://localhost:8080/index.html
# console:    http://localhost:8080/console.html
# both default their API base URL to localhost:8787
```

Or drive it with curl:

```bash
curl -X POST http://localhost:8787/v1/turn \
  -H "Content-Type: application/json" \
  -d '{"session_id": "demo-123", "user_message": "I want to kill myself"}'

curl http://localhost:8787/v1/session/demo-123
```

Try messages like `"I feel so sad and hopeless"` (soften), `"I want to kill
myself"` (escalate, with crisis resources injected into the directive), and
`"Thanks, that worked great!"` (allow) to see the different moderation paths
and how each one changes the assistant's actual reply.

### Using a real model

Without any key set, `assistant_reply` comes from a simulated, action-aware
fallback (`llm_backend: "simulated"`) so the demo works standalone. To have
the middleware actually call Claude:

```bash
ANTHROPIC_API_KEY=sk-ant-... npm run dev
```

Responses will come back with `llm_backend: "anthropic"`. `ANTHROPIC_MODEL`
is also configurable (defaults to `claude-sonnet-5`).

## Deploy

`middleware-worker/wrangler.toml` is set up for Cloudflare Workers:

```bash
cd middleware-worker
npx wrangler deploy
npx wrangler secret put API_KEY             # optional; unset = demo mode, no auth required
npx wrangler secret put ANTHROPIC_API_KEY   # optional; unset = simulated replies
```

Point `frontend/index.html`'s API base URL field at the deployed Worker URL,
then host `frontend/` on Cloudflare Pages or any static host.
