// Run after `node build.mjs` so public/sw.js exists with the injected timestamp.
import { readFileSync } from "fs";
const swSrc    = readFileSync("sw.js",        "utf8");
const swPub    = readFileSync("public/sw.js", "utf8");
const buildMjs = readFileSync("build.mjs",    "utf8");
const serverMjs = readFileSync("server.mjs",  "utf8");
const app      = readFileSync("src/app.js",   "utf8");
const css      = readFileSync("styles.css",   "utf8");

function fnBlock(src, marker, maxLen = 2000) {
  const idx = src.indexOf(marker);
  return idx === -1 ? "" : src.slice(idx, idx + maxLen);
}

const checks = [
  // ── 1. CACHE_NAME: placeholder in source, injected in public ─────
  ["sw.js source has BUILD_TIMESTAMP placeholder",
    swSrc.includes("BUILD_TIMESTAMP")],
  ["sw.js source does NOT have a hardcoded version string (e.g. -shell-v)",
    !(/CACHE_NAME = "trz-pms-shell-v\d/.test(swSrc))],
  ["public/sw.js has injected cache name (BUILD_TIMESTAMP replaced)",
    !swPub.includes("BUILD_TIMESTAMP")],
  ["public/sw.js cache name matches trz-pms-YYYY pattern",
    /CACHE_NAME = "trz-pms-20\d\d-/.test(swPub)],

  // ── 2. build.mjs injects timestamp ───────────────────────────────
  ["build.mjs imports readFile",
    buildMjs.includes("readFile")],
  ["build.mjs generates cacheName from timestamp",
    buildMjs.includes("cacheName")],
  ["build.mjs replaces BUILD_TIMESTAMP placeholder in sw.js",
    buildMjs.includes("BUILD_TIMESTAMP")],
  ["build.mjs writes BUILD_MARKER into env.js",
    buildMjs.includes("BUILD_MARKER")],

  // ── 3. server.mjs Cache-Control headers ──────────────────────────
  ["server.mjs has no-cache, no-store, must-revalidate (for sw.js)",
    serverMjs.includes("no-cache, no-store, must-revalidate")],
  ["server.mjs has no-cache, must-revalidate (for shell assets)",
    serverMjs.includes("no-cache, must-revalidate")],
  ["server.mjs has cacheControlFor helper",
    serverMjs.includes("cacheControlFor")],
  ["server.mjs applies Cache-Control header on static file serve",
    serverMjs.includes('"Cache-Control"')],

  // ── 4. SW network-first strategy for shell assets ─────────────────
  ["sw.js has isShellAsset() function",
    swSrc.includes("function isShellAsset(")],
  ["isShellAsset regex covers js files",
    fnBlock(swSrc, "function isShellAsset(").includes("js")],
  ["isShellAsset regex covers css files",
    fnBlock(swSrc, "function isShellAsset(").includes("css")],
  ["sw.js fetch handler uses isShellAsset for network-first branching",
    swSrc.includes("isShellAsset(url)")],
  ["sw.js does not use pure cache-first for shell assets",
    !(/if \(cached\) return cached[\s\S]{0,80}isShellAsset/.test(swSrc))],

  // ── 5. Offline fallback intact ────────────────────────────────────
  ["sw.js skipWaiting() present in install event",
    swSrc.includes("skipWaiting()")],
  ["sw.js clients.claim() present in activate event",
    swSrc.includes("clients.claim()")],
  ["sw.js OFFLINE_HTML fallback present",
    swSrc.includes("OFFLINE_HTML")],
  ["sw.js activate event deletes old caches",
    swSrc.includes("caches.delete(key)")],

  // ── 6. Build marker visible in Settings ──────────────────────────
  ["settingsView() reads BUILD_MARKER from window.__TRZ_ENV__",
    fnBlock(app, "function settingsView(").includes("BUILD_MARKER")],
  [".build-marker CSS class defined",
    css.includes(".build-marker")],

  // ── 7. FAB completely removed ─────────────────────────────────────
  ["renderFloatingActions removed from app.js",
    !app.includes("function renderFloatingActions(")],
  ["renderFloatingActions call removed from bind sequence",
    !app.includes("renderFloatingActions()")],
  ["#trz-fab-menu removed from CSS",
    !css.includes("#trz-fab-menu")],
  ["#trz-fab { removed from CSS",
    !css.includes("#trz-fab {")],
  ["#trz-fab-backdrop removed from CSS",
    !css.includes("#trz-fab-backdrop")],
];

let pass = 0, fail = 0;
checks.forEach(([label, ok]) => {
  console.log((ok ? "PASS" : "FAIL") + " " + label);
  ok ? pass++ : fail++;
});
console.log("");
console.log(pass + "/" + checks.length + " checks passed" + (fail ? " — " + fail + " FAILED" : ""));
process.exit(fail > 0 ? 1 : 0);
