import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.env.PORT || 5173);
const root = fileURLToPath(new URL(".", import.meta.url));
const env = await loadEnv();

const types = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".sql": "text/plain",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp"
};

createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${port}`);
  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);

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
