const CACHE_NAME = "trz-pms-shell-v2";
const CACHE_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./src/app.js",
  "./src/core.js",
  "./src/supabase.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png"
];

const OFFLINE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#073f22" />
    <title>TRZ PMS Offline</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: Arial, sans-serif; background: #00140b; color: #f2f7f0; }
      main { width: min(92vw, 520px); border: 1px solid #15592d; border-radius: 10px; background: #082313; padding: 28px; }
      h1 { margin: 0 0 12px; font-size: 24px; }
      p { line-height: 1.6; color: #d9e7da; }
      strong { color: #f1d36b; }
    </style>
  </head>
  <body>
    <main>
      <h1>TRZ PMS is offline</h1>
      <p>The app shell is available, but live PMS records require an internet connection.</p>
      <p><strong>Read-only notice:</strong> booking creation, payments, deposits, finance actions, email sending, and other business operations are disabled while offline.</p>
    </main>
  </body>
</html>`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(CACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET" || shouldBypassCache(url)) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", clone));
          return response;
        })
        .catch(() => new Response(OFFLINE_HTML, {
          status: 200,
          headers: { "Content-Type": "text/html" }
        }))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (isCacheableShellAsset(url, response)) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          return Response.error();
        });
    })
  );
});

function shouldBypassCache(url) {
  if (url.origin !== self.location.origin) return true;
  if (url.pathname === "/env.js") return true;
  if (url.pathname.startsWith("/api/")) return true;
  if (url.hostname.includes("supabase.co")) return true;
  return false;
}

function isCacheableShellAsset(url, response) {
  if (!response || response.status !== 200 || url.origin !== self.location.origin) return false;
  return /\.(html|css|js|webmanifest|svg|png|ico)$/.test(url.pathname) || url.pathname === "/";
}
