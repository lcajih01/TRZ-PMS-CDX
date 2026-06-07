import { cp, writeFile, mkdir } from "node:fs/promises";

await mkdir("public", { recursive: true });

await cp(".", "public", {
  recursive: true,
  filter: (src) =>
    !src.includes("node_modules") &&
    !src.includes(".git") &&
    !src.includes("public")
});

await writeFile(
  "public/env.js",
  `window.__TRZ_ENV__ = ${JSON.stringify({
    VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || "",
    VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY || ""
  })};\n`
);

console.log("public build generated");