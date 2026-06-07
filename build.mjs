import { cp, writeFile, mkdir, readFile } from "node:fs/promises";

// Unique per-build cache name — forces SW to reinstall and evict old cached assets.
const buildTs = new Date().toISOString().slice(0, 19).replace(/[:.]/g, "-");
const cacheName = `trz-pms-${buildTs}`;

await mkdir("public/src", { recursive: true });
await mkdir("public/email", { recursive: true });

await cp("index.html", "public/index.html");
await cp("styles.css", "public/styles.css");
await cp("booking-request.html", "public/booking-request.html");
await cp("booking-request.css", "public/booking-request.css");
await cp("email/assets", "public/email/assets", { recursive: true }).catch(() => {});
await cp("icons", "public/icons", { recursive: true }).catch(() => {});
await cp("manifest.json", "public/manifest.json").catch(() => {});
await cp("offline.html", "public/offline.html").catch(() => {});
await cp("src", "public/src", { recursive: true });

// Inject build timestamp into sw.js so every deploy produces a new SW byte signature.
const swSource = await readFile("sw.js", "utf8");
await writeFile("public/sw.js", swSource.replace("BUILD_TIMESTAMP", cacheName));

await writeFile(
  "public/env.js",
  `window.__TRZ_ENV__ = ${JSON.stringify({
    VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || "",
    VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY || "",
    BUILD_MARKER: cacheName
  })};\n`
);

console.log(`public build generated — cache: ${cacheName}`);
