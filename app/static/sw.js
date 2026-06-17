const SGDI_CACHE = "sgdi-pwa-v20260616-gps-column";
const SGDI_ASSETS = [
  "/",
  "/static/manifest.webmanifest",
  "/static/iron-solution-logo.png",
  "/static/sgdi-icon-192.png",
  "/static/sgdi-icon-512.png"
];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(SGDI_CACHE).then(cache => cache.addAll(SGDI_ASSETS)).catch(() => null));
  self.skipWaiting();
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== SGDI_CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const dataRoute = [
    "/api/",
    "/auth/",
    "/drh/",
    "/ops/",
    "/materiel/",
    "/commercial/",
    "/finance/",
    "/erp/",
    "/ui/",
    "/irongs/"
  ].some(prefix => url.pathname.startsWith(prefix));
  if (dataRoute) {
    event.respondWith(fetch(req, { cache: "no-store" }));
    return;
  }
  const bypassCache = req.mode === "navigate" || [".js", ".css", ".html"].some(ext => url.pathname.endsWith(ext));
  if (bypassCache) {
    event.respondWith(fetch(req, { cache: "reload" }).catch(() => caches.match(req).then(cached => cached || caches.match("/"))));
    return;
  }
  event.respondWith(fetch(req).then(res => {
    const copy = res.clone();
    caches.open(SGDI_CACHE).then(cache => cache.put(req, copy)).catch(() => null);
    return res;
  }).catch(() => caches.match(req).then(cached => cached || caches.match("/"))));
});
