import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { sendAutomationEmail, sendGuestMemoryEmail } from "./email/resend.mjs";

const port = Number(process.env.PORT || 5173);
const root = fileURLToPath(new URL(".", import.meta.url));
const env = await loadEnv();

const types = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".sql": "text/plain"
};

createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${port}`);
  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);

  if (req.method === "POST" && url.pathname === "/api/memory/send") {
    let payload = {};
    try {
      payload = await readJson(req);
      const result = await sendGuestMemoryEmail({ memoryId: payload.memory_id, env });
      sendJson(res, 200, result);
    } catch (error) {
      console.error("[memory/send]", {
        memory_id: payload.memory_id || null,
        error: error.message
      });
      sendJson(res, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/automation/send") {
    let payload = {};
    try {
      payload = await readJson(req);
      const result = await sendAutomationEmail({ queueId: payload.queue_id, env });
      sendJson(res, 200, result);
    } catch (error) {
      console.error("[automation/send]", {
        queue_id: payload.queue_id || null,
        error: error.message
      });
      sendJson(res, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (requested === "/env.js") {
    res.writeHead(200, { "Content-Type": "text/javascript" });
    res.end(
      `window.__TRZ_ENV__ = ${JSON.stringify({
        VITE_SUPABASE_URL: env.VITE_SUPABASE_URL || "",
        VITE_SUPABASE_ANON_KEY: env.VITE_SUPABASE_ANON_KEY || ""
      })};`
    );
    return;
  }

  const filePath = normalize(join(root, requested));

  if (!filePath.startsWith(normalize(root)) || !existsSync(filePath)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  try {
    const body = await readFile(filePath);
    res.writeHead(200, { "Content-Type": types[extname(filePath)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(500);
    res.end("Server error");
  }
}).listen(port, () => {
  console.log(`TRZ PMS Phase 1 running at http://localhost:${port}`);
});

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

async function loadEnv() {
  const values = { ...process.env };
  const envPath = join(root, ".env");
  if (!existsSync(envPath)) return values;

  const raw = await readFile(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    values[key] = value;
  }
  return values;
}
