// Standalone local runner for the demo. The worker module (index.js) only
// uses standard Request/Response, so it runs unmodified under plain Node
// (v18+) via this thin http -> fetch adapter, with no wrangler/Cloudflare
// account required. `npm run deploy` still uses wrangler for real deployment.
import http from "node:http";
import worker from "./index.js";

const PORT = process.env.PORT || 8787;
const env = {
  API_KEY: process.env.API_KEY || "",
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "",
  ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL || "",
};

const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;

  const request = new Request(`http://localhost:${PORT}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: ["GET", "HEAD"].includes(req.method) ? undefined : body,
  });

  const response = await worker.fetch(request, env);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
});

server.listen(PORT, () => {
  console.log(`Emotional Infrastructure Middleware (local demo) listening on http://localhost:${PORT}`);
});
