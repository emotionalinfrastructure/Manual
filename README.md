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
benchmark/            Labeled corpus + scoring harness measuring how much of
                      the detector's claimed recall is actually there
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

Anything in the crisis vocabulary raises `crisis_language`. What varies is the
response, driven by `crisis_context`: *who* the language refers to.

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

#### How much this actually catches

**Recall is partial, and that is the honest headline.** The vocabulary is a
few dozen literal phrases, so it catches the phrasings it lists and nothing
else.

This is now measured rather than asserted. [`benchmark/`](benchmark/) holds a
versioned, labeled corpus and a scoring harness that runs in CI; current results
are in [`benchmark/results/open-v0.1.md`](benchmark/results/open-v0.1.md).

| | escalation recall |
|---|---|
| First-person disclosures, **explicitly** phrased | 100% (15/15) |
| First-person disclosures, **indirectly** phrased | **0% (0/6)** |
| Anyone at risk, including third-party concern | 81% (25/31) |
| False positives on benign controls | 0% (0/10) |

The gap between those first two rows is the whole story, and it is why a single
blended recall number is worse than useless here. It reliably catches explicit
statements —

> "I want to kill myself", "I'm going to take my own life", "there's no reason
> to live", "I don't want to be here anymore", "I'd be better off dead"

— and reliably misses indirect ones, which is how a great many real
disclosures are phrased:

> "I've been thinking about ending it", "I have a plan and I've written the
> note", "I've been stockpiling my pills", "nobody would miss me if I was
> gone", "I'm ready to go", "kms"

Each of those returns `action: "allow"`, `sentiment_score: 0` and
`primary_emotion: "neutral"`. Anything routing real users must put a reviewed
detection service in front of this list, not tune the list.

Building that corpus immediately found a defect 128 unit tests had not:
substring matching has no morphology, so an absent `-ing` is an absent
detection. `hurt myself` was listed and `hurting myself` was not, and the
third-party list carried no progressive forms at all — so `I have been hurting
myself` and `my sister is hurting herself` raised **no flag whatsoever** and
returned `allow`. Fixed, and the corpus now guards the whole class. That is the
argument for the benchmark in one paragraph: the misses you have written down
are not the dangerous ones.

Four further limits worth knowing:

- **Academic framing only works when it is adjacent to the topic word.**
  `TOPIC_FRAMING_TERMS` includes `dissertation`, `seminar` and `counsellor
  training`, but the link between framing and topic is one space or one
  preposition — so `my dissertation is about self-harm` and `we covered
  self-harm in my counsellor training` escalate as *personal disclosures*.
  Terms added specifically to prevent false escalation are unreachable in
  ordinary phrasing. Tracked as `open_defect: framing-adjacency`; unfixed
  because widening the link risks reintroducing the regression described below,
  where a framing word matching anywhere suppressed crisis resources for a real
  disclosure.
- Quoted speech (`she texted me "I want to kill myself"`) reads as a
  first-person disclosure. Left deliberately conservative — substring matching
  cannot reliably separate quotation from disclosure, and over-offering support
  is the safe error.
- Detection is English-only, and matches on substrings rather than words, so
  coverage of other languages is accidental where it exists at all.
- Third-person detection covers common phrasings, not all of them.

#### Who the vocabulary is about

Phrases that name their own subject settle the question by themselves: `kill
myself` is always a disclosure, `kill herself` is always about someone else.
The rest — `no reason to live`, `better off dead`, and the bare topic words
`suicide` / `suicidal` / `self-harm` — name nobody, so the subject is resolved
from the text *preceding* the match. An explicitly named person (`my brother`,
`someone`) wins outright; otherwise the nearest preceding subject decides;
with no subject anywhere, an explicit phrase falls to the riskier reading and a
bare topic word falls to subject matter.

Reading only what precedes the match matters more than it sounds. Bare pronouns
are ubiquitous, so scanning the whole message meant that a pronoun appearing
*after* a disclosure, about someone entirely incidental, reclassified it as
concern for that person — `I am suicidal because my brother died` dropped from
high to medium severity, the directive told the model not to treat the user as
personally at risk, and `crisis_turn_count` never incremented, so
repeated-crisis escalation could never fire for that user.

Academic framing reclassifies a bare topic word only when it is *tied* to that
word (`researching suicide`, `a paper on suicide`, `suicide statistics`) — one
space or one preposition. Matching a framing word anywhere in the message meant
ordinary vocabulary (`class`, `book`, `this paper`) turned live disclosures
into topic mentions, and a topic mention carries a directive that explicitly
tells the model *not* to surface crisis resources.

### What `emotional_state` is, and is not

`emotional_state` reads like a measurement. It is a word count, and the
limits are worth stating plainly before anyone builds on the numbers:

- **No negation.** `I am not happy at all` scores `+1.0` / `joy`; `I'm not sad`
  scores `-1.0` / `sadness`.
- **No morphology.** The lexicon matches whole tokens against ~45 listed words,
  so `depressed` is scored and `depression` is not; `anxiety`, `worrying`,
  `devastated`, `numb` and `exhausted` are all `neutral`.
- **`sentiment_score` is a ratio of hits, not a scale.** In practice it is
  almost always exactly `-1`, `0` or `+1`. `session_trend` thresholds changes in
  it at ±0.15, so treat the trend as a coarse hint rather than a signal.
- **`primary_emotion` ties break by declaration order** — `happy sad` is `joy`.

`intensity` is deliberately *not* a density: it saturates at three affective
hits regardless of message length. Dividing by token count made the same
distress score lower the more the user explained it, and because the soften
rule has an intensity floor, writing at length about your feelings was what
stopped the middleware responding to them.

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
npm run test        # unit tests for the scoring/policy logic
npm run benchmark   # scores the detector against benchmark/data/
npm run dev         # starts the whole demo on http://localhost:8787
```

`npm run benchmark` regenerates `benchmark/results/open-v0.1.md` and exits
non-zero on a regression — an item failing that is neither a documented design
limitation nor a tracked open defect. Both run in CI.

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
