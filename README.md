# Emotional Infrastructure Middleware

A compliance & safety layer that sits between a chat UI and an LLM. On every
turn it scores the user's message for emotional tone and safety risk, decides
whether the conversation needs to be softened or escalated, and returns a
system directive the upstream LLM call should be steered by.

```
frontend/            Static demo chat UI (vanilla HTML/CSS/JS)
middleware-worker/    Cloudflare Worker implementing POST /v1/turn
```

## How it works

`POST /v1/turn` takes `{ session_id, user_message }` and returns:

```json
{
  "session_id": "demo-123",
  "turn": 1,
  "emotional_state": { "sentiment_score": -0.8, "primary_emotion": "sadness", "intensity": 0.6 },
  "safety": { "flags": ["crisis_language"], "action": "escalate", "severity": "high" },
  "suggested_system_directive": "The user's message contains language associated with self-harm...",
  "session_trend": "declining"
}
```

- **`middleware-worker/lexicon.js`** — rule-based emotion/sentiment scoring and
  crisis/abuse/PII detection. Deterministic, no external ML dependency.
- **`middleware-worker/policy.js`** — turns an analysis into an `allow` /
  `soften` / `escalate` decision and the directive text to inject ahead of the
  LLM's system prompt. Also escalates a session that has raised crisis
  language more than once, even if a single message wouldn't trip it alone.
- **`middleware-worker/index.js`** — the Worker's HTTP surface (`/v1/turn`,
  `/v1/session/:id`, CORS, optional `API_KEY` bearer auth) plus in-memory
  per-session history (turn count, sentiment trend, crisis count).

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
# open http://localhost:8080, API base URL already defaults to localhost:8787
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
`"Thanks, that worked great!"` (allow) to see the different moderation paths.

## Deploy

`middleware-worker/wrangler.toml` is set up for Cloudflare Workers:

```bash
cd middleware-worker
npx wrangler deploy
npx wrangler secret put API_KEY   # optional; unset = demo mode, no auth required
```

Point `frontend/index.html`'s API base URL field at the deployed Worker URL,
then host `frontend/` on Cloudflare Pages or any static host.
