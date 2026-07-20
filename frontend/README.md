# Frontend for Emotional Infrastructure Middleware

Static pages (vanilla HTML/CSS/JS, no build step) that talk to the
middleware worker. Host them anywhere static (Cloudflare Pages, `python3 -m
http.server`, etc.) — each just needs the middleware's API base URL, which is
configurable in the page itself.

- **`index.html`** — demo chat UI. Talks to `POST /v1/turn` and renders its
  moderation decision live.
- **`console.html`** — admin console: live session monitoring
  (`GET /v1/sessions`) plus the manual's governance record-keeping
  instruments (AI Use Inventory, Disclosure Review, QA Findings Tracker,
  Release Readiness Checklist) via `/v1/governance/*`. Set the API key field
  if the worker has `API_KEY` configured.

See the top-level [README](../README.md) for how to run the whole demo end to end.
