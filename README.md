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
  "safety": {
    "flags": ["crisis_language"],
    "action": "escalate",
    "severity": "high",
    "crisis_context": "first_person"
  },
  "suggested_system_directive": "The user's message contains language associated with self-harm...",
  "session_trend": "declining",
  "crisis_turn_count": 1,
  "assistant_reply": "I want to make sure you're safe first...",
  "llm_backend": "anthropic"
}
```

### Crisis language is answered proportionately

Detection is deliberately broad — a missed disclosure costs far more than an
unnecessary offer of support — so anything in the crisis vocabulary raises
`crisis_language`. What varies is the response, driven by `crisis_context`:
*who* the language refers to.

| `crisis_context` | example | action | severity |
|---|---|---|---|
| `first_person` | "I want to kill myself" | `escalate` | high |
| `third_party` | "my friend is suicidal" | `escalate` | medium |
| `topic_mention` | "suicide rates declined last year" | `allow` | low |

All three still surface support where someone may be at risk; only a pure
topic mention declines to treat the user as in crisis, and its directive
explicitly tells the model *not* to open with crisis resources. `null` when
no crisis vocabulary is present.

`crisis_turn_count` counts only first-person disclosures — the repeated-crisis
boundary exists to catch a user's own escalating risk, so asking about a
friend across several turns never accumulates toward it.

Two limits worth knowing: quoted speech (`she texted me "I want to kill
myself"`) is read as a first-person disclosure, left deliberately conservative
because substring matching cannot reliably separate quotation from disclosure;
and third-person detection covers common phrasings, not all of them.

- **`middleware-worker/lexicon.js`** — rule-based emotion/sentiment scoring,
  crisis/abuse/PII detection, and crisis-context classification. Deterministic,
  no external ML dependency.
- **`middleware-worker/policy.js`** — turns an analysis into an `allow` /
  `soften` / `escalate` decision and the directive text to inject ahead of the
  LLM's system prompt. Also escalates a session that has raised first-person
  crisis language more than once, even if a single message wouldn't trip it alone.
- **`middleware-worker/sessions.js`** — per-session state (turn count, sentiment
  history, crisis count, message history) behind a store the worker is
  constructed with, so a durable backing can be swapped in without touching
  request handling.
- **`middleware-worker/llm.js`** — actually generates the reply: builds the
  system prompt (base persona + injected directive) and calls the Anthropic
  Messages API with the session's conversation history. If no
  `ANTHROPIC_API_KEY` is configured, it falls back to a deterministic,
  action-aware simulated reply (still distinct per `allow`/`soften`/`escalate`)
  so the full pipeline runs with zero external dependencies. `llm_backend`
  reports where the reply text actually came from: a call that succeeds but
  returns no usable text reports `"simulated"`, not `"anthropic"`.
- **`middleware-worker/session-object.js`** — the `SessionObject` Durable
  Object: one instance per conversation, holding its state and applying each
  completed turn atomically.
- **`middleware-worker/index.js`** — the Worker's HTTP surface (`/v1/turn`,
  `/v1/session/:id`, CORS, optional `API_KEY` bearer auth).

### Session storage

Per-session state — turn count, sentiment trend, crisis count, and the message
history used as LLM context — is kept behind a store interface with two
implementations, chosen per request:

Each turn response reports which store served it, as `session_store`:

| condition | `session_store` | lifetime |
|---|---|---|
| a store is injected explicitly | `injected` | caller's |
| the `SESSIONS` binding exists | `durable_object` | the conversation's |
| neither | `memory` | one Worker isolate |

So the demo runs with no bindings configured, and a deployment that declares
the binding gets state that survives isolate recycling — without which a long
conversation silently loses its history, including the crisis count that gates
repeated-crisis escalation. Check `session_store` in any response to confirm
which one you are actually on; locally it is always `memory`, which is exactly
why the difference is easy to miss.

**The Durable Object works on the Workers Free plan.** Free accounts can create
SQLite-backed Durable Objects, and `wrangler.toml` declares exactly that
(`new_sqlite_classes`), so the committed configuration deploys as-is with no
changes. Free-plan limits are 100,000 Durable Object requests/day (a turn costs
about two).

**Durable Objects rather than KV, deliberately.** KV is eventually consistent,
and this value includes `crisisTurnCount`. Two turns landing close together
against stale reads would drop an increment — a safety regression nothing would
surface. A Durable Object serialises access per session id, and each turn's
read-modify-write happens inside the object under `blockConcurrencyWhile`, so
increments cannot be lost. (One honest limit: the *policy decision* is made
from a read taken before the model call, so two genuinely simultaneous turns in
one conversation can each decide against the same prior state. The recorded
counts stay correct; only the decision input is momentarily stale.)

This is a demo-grade rule engine, not a clinical risk model — the crisis
phrase list is narrow and literal by design. A production deployment should
route flagged messages to a reviewed detection service rather than relying on
a keyword list.

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

**Option A — CLI, from a machine with Cloudflare access:**

```bash
cd middleware-worker
npx wrangler deploy
npx wrangler secret put API_KEY             # optional; unset = demo mode, no auth required
npx wrangler secret put ANTHROPIC_API_KEY   # optional; unset = simulated replies
```

**Option B — Cloudflare's Git integration ("Workers Builds"), no CLI or
local credentials needed:** in the Cloudflare dashboard, Workers & Pages →
Create → Connect to Git → pick this repo, set the root directory to
`middleware-worker`. Cloudflare detects `wrangler.toml` and builds/deploys
automatically on every push to `main`. Add `ANTHROPIC_API_KEY` (and
`API_KEY`, if you want auth) as secrets in that Worker's dashboard settings.

Either way, the resulting `*.workers.dev` URL is the whole live demo —
nothing else to host or wire up.
