import { cp, writeFile, mkdir } from "node:fs/promises";

await mkdir("public/src", { recursive: true });
await mkdir("public/email", { recursive: true });

await cp("index.html", "public/index.html");
await cp("styles.css", "public/styles.css");
await cp("booking-request.html", "public/booking-request.html");
await cp("booking-request.css", "public/booking-request.css");
await cp("email/assets", "public/email/assets", { recursive: true }).catch(() => {});
await cp("icons", "public/icons", { recursive: true }).catch(() => {});
await cp("manifest.json", "public/manifest.json").catch(() => {});
await cp("sw.js", "public/sw.js").catch(() => {});
await cp("offline.html", "public/offline.html").catch(() => {});
await cp("src", "public/src", { recursive: true });

await writeFile(
  "public/env.js",
  `window.__TRZ_ENV__ = ${JSON.stringify({
    VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || "",
    VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY || ""
  })};\n`
);

console.log("public build generated");
