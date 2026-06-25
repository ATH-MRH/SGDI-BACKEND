const SGDI_CACHE = "sgdi-pwa-v20260625-local-frontend-cache";
const SGDI_ASSETS = [
  "/",
  "/static/manifest.webmanifest",
  "/static/tailwind.min.css",
  "/static/sgdi-app.css",
  "/static/sgdi-app.js",
  "/static/erp-frontend.js",
  "/static/sgdi-inline-2.js",
  "/static/favicon.svg",
  "/static/iron-solution-logo.png",
  "/static/iron-securite-logo.png",
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

self.addEventListener("message", event => {
  const data = event.data || {};
  if (data.type === "SKIP_WAITING") self.skipWaiting();
  if (data.type === "PRECACHE_URLS" && Array.isArray(data.urls)) {
    const urls = data.urls.filter(u => typeof u === "string" && u.startsWith("/"));
    event.waitUntil(caches.open(SGDI_CACHE).then(cache => cache.addAll([...new Set(urls)]).catch(() => null)));
  }
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // 1) Données API : toujours le réseau, jamais de cache (données fraîches).
  const dataRoute = [
    "/api/", "/auth/", "/drh/", "/ops/", "/materiel/", "/commercial/",
    "/finance/", "/erp/", "/ui/", "/irongs/"
  ].some(prefix => url.pathname.startsWith(prefix));
  if (dataRoute) {
    event.respondWith(fetch(req, { cache: "no-store" }));
    return;
  }

  // 2) Fichiers statiques versionnés (.js, .css, images, polices) : CACHE D'ABORD.
  //    Chaque fichier porte un ?v=hash : si le contenu change, l'URL change =>
  //    re-téléchargement automatique. Sinon, servi instantanément depuis le disque,
  //    comme un logiciel installé (plus aucun re-téléchargement à chaque ouverture).
  const isVersionedAsset = url.pathname.startsWith("/static/") &&
    [".js", ".css", ".png", ".jpg", ".jpeg", ".svg", ".webp", ".woff", ".woff2", ".ttf", ".ico"]
      .some(ext => url.pathname.endsWith(ext));
  if (isVersionedAsset) {
    event.respondWith(
      caches.match(req).then(cached => {
        if (cached) return cached;
        return fetch(req).then(res => {
          const copy = res.clone();
          caches.open(SGDI_CACHE).then(cache => cache.put(req, copy)).catch(() => null);
          return res;
        });
      })
    );
    return;
  }

  // 3) Navigation / HTML : LOCAL D'ABORD pour démarrer comme une app installée.
  //    Le réseau met le cache à jour en arrière-plan; les données restent servies
  //    exclusivement par les appels API ci-dessus.
  if (req.mode === "navigate" || url.pathname.endsWith(".html") || url.pathname === "/") {
    event.respondWith(
      caches.match(req).then(cached => {
        const refresh = fetch(req, { cache: "reload" }).then(res => {
          const copy = res.clone();
          caches.open(SGDI_CACHE).then(cache => cache.put(req, copy)).catch(() => null);
          return res;
        }).catch(() => null);
        return cached || refresh.then(res => res || caches.match("/"));
      })
    );
    return;
  }

  // 4) Le reste : réseau avec repli sur cache.
  event.respondWith(
    fetch(req).then(res => {
      const copy = res.clone();
      caches.open(SGDI_CACHE).then(cache => cache.put(req, copy)).catch(() => null);
      return res;
    }).catch(() => caches.match(req).then(cached => cached || caches.match("/")))
  );
});
