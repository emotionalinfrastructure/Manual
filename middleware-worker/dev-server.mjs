// Standalone local runner for the demo. The worker module (index.js) only
// uses standard Request/Response, so it runs unmodified under plain Node
// (v18+) via this thin http -> fetch adapter, with no wrangler/Cloudflare
// account required. `npm run deploy` still uses wrangler for real deployment.
//
// Also serves frontend/ as static files, mirroring how a deployed Worker's
// [assets] config serves them from the same origin ahead of the Worker
// script — so http://localhost:8787/ behaves the same locally as it will
// once deployed.
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import worker from "./index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.join(__dirname, "..", "frontend");

const PORT = process.env.PORT || 8787;
const env = {
  API_KEY: process.env.API_KEY || "",
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "",
  ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL || "",
};

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

async function tryServeStaticFile(pathname) {
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  const resolved = path.join(FRONTEND_DIR, relative);
  if (!resolved.startsWith(FRONTEND_DIR)) return null; // no path traversal
  try {
    const data = await readFile(resolved);
    const ext = path.extname(resolved);
    return { data, contentType: CONTENT_TYPES[ext] || "application/octet-stream" };
  } catch {
    return null;
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" || req.method === "HEAD") {
    const pathname = new URL(req.url, `http://localhost:${PORT}`).pathname;
    const staticFile = await tryServeStaticFile(pathname);
    if (staticFile) {
      res.writeHead(200, { "content-type": staticFile.contentType });
      res.end(staticFile.data);
      return;
    }
  }

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
