# Frontend for Emotional Infrastructure Middleware

Static demo page (vanilla HTML/CSS/JS, no build step) that talks to the
middleware worker's `POST /v1/turn` endpoint and renders its moderation
decision live. Host it anywhere static (Cloudflare Pages, `python3 -m
http.server`, etc.) — it just needs the middleware's API base URL, which is
configurable in the page itself.

See the top-level [README](../README.md) for how to run the whole demo end to end.
