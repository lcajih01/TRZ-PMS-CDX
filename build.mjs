import { writeFile } from "node:fs/promises";

await writeFile(
  "env.js",
  `window.__TRZ_ENV__ = ${JSON.stringify({
    VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || "",
    VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY || ""
  })};\n`
);

console.log("env.js generated");