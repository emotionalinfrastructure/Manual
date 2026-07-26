# Emotional Infrastructure Middleware

A compliance & safety layer that sits between a chat UI and an LLM. On every
turn it scores the user's message for emotional tone and safety risk, decides
whether the conversation needs to be softened or escalated, builds a system
directive from that decision, and uses it to steer the actual model call that
generates the reply.

```
frontend/            Static demo chat UI (vanilla HTML/CSS/JS)
middleware-worker/    Cloudflare Worker implementing POST /v1/turn, and
                      serving frontend/ as static assets from the same origin
```

The Worker is configured (`middleware-worker/wrangler.toml`'s `[assets]`
block) to serve `frontend/` itself, so one deployed Worker is the whole live
demo — the page and the API it calls share an origin, no separate static
host or CORS wiring needed. `middleware-worker/dev-server.mjs` mirrors this
locally.

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
  "llm_backend": "anthropic",
  "session_store": "kv"
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
  `/v1/session/:id`, CORS, optional `API_KEY` bearer auth) plus the per-session
  state it maintains (turn count, sentiment trend, crisis count, and the
  message history used as LLM context).
- **`middleware-worker/store.js`** — the session-persistence layer. When a
  `SESSIONS` KV binding is present, session records are stored in Cloudflare
  KV keyed by `session:<id>` (with a 30-day TTL), so state survives across
  isolates, requests, and deploys. With no binding it falls back to an
  in-memory `Map` — single-isolate only, but keeps the Node dev-server and the
  tests running with zero configuration. Each response reports which backend
  is active via `session_store: "kv" | "memory"`.

This is a demo-grade rule engine, not a clinical risk model — the crisis
phrase list is narrow and literal by design. A production deployment should
route flagged messages to a reviewed detection service. Session state is
already durable when KV is configured (see below); note that KV is eventually
consistent, so two near-simultaneous turns on the *same* session can race on
the read-modify-write — a Durable Object would serialize those if strict
per-session ordering ever matters.

## Run the demo

No Cloudflare account required — the worker is plain Request/Response code
that also runs directly under Node.

```bash
cd middleware-worker
npm run test   # unit tests for the scoring/policy logic
npm run dev    # starts the whole demo on http://localhost:8787
```

Open `http://localhost:8787/` in a browser — that one server serves the chat
UI and the `/v1/turn` API it calls. The "API base URL" field on the page can
be left blank (same origin) or pointed at a different deployment.

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

`middleware-worker/wrangler.toml` is set up to deploy the Worker *and* serve
`frontend/` as static assets from the same origin — one deploy, one URL, the
whole demo.

The `SESSIONS` KV namespaces already exist and their ids are committed in
`wrangler.toml`, so no namespace setup is needed to deploy. (To recreate them
from scratch: `npx wrangler kv namespace create SESSIONS` and
`... SESSIONS --preview`, then paste the ids into the `[[kv_namespaces]]`
block.)

**Option A — GitHub Actions, deploy on merge (recommended):**
`.github/workflows/deploy.yml` runs the tests and then `wrangler deploy` on
every push to `main`. It's dormant until you add one repository secret, so it
never blocks merges on its own:

1. Create a Cloudflare API token: dashboard → My Profile → API Tokens →
   Create Token → **"Edit Cloudflare Workers"** template (grants Workers
   Scripts:Edit and Workers KV Storage:Edit).
2. Add it under the repo's **Settings → Secrets and variables → Actions** as
   `CLOUDFLARE_API_TOKEN`. If the token can access more than one account, also
   add `CLOUDFLARE_ACCOUNT_ID`.
3. Push/merge to `main`. The workflow deploys automatically. Set the optional
   runtime secrets once from a machine with the token:
   `npx wrangler secret put ANTHROPIC_API_KEY` (unset = simulated replies) and
   `npx wrangler secret put API_KEY` (unset = open demo mode).

**Option B — CLI, from a machine with Cloudflare access:**

```bash
cd middleware-worker
npx wrangler login          # or export CLOUDFLARE_API_TOKEN=...
npx wrangler deploy
npx wrangler secret put API_KEY             # optional; unset = demo mode, no auth required
npx wrangler secret put ANTHROPIC_API_KEY   # optional; unset = simulated replies
```

**Option C — Cloudflare's own Git integration ("Workers Builds"):** in the
Cloudflare dashboard, Workers & Pages → Create → Connect to Git → pick this
repo, root directory `middleware-worker`. Cloudflare detects `wrangler.toml`
and builds/deploys on every push to `main`. (If you use this *and* Option A,
both deploy the same code — harmless, just redundant; pick one.)

Session state persists in the bound KV namespace. Deploying without the
binding still runs, but falls back to per-isolate in-memory state
(`session_store: "memory"`), which won't survive across isolates or deploys.

Any of these yields a `*.workers.dev` URL that is the whole live demo —
nothing else to host or wire up.
