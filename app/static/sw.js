const SGDI_CACHE = "sgdi-pwa-v20260624-visible-commercial-billing-tabs";
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

  // 3) Navigation / HTML : RÉSEAU D'ABORD (toujours la dernière version de l'app),
  //    repli sur le cache si hors-ligne.
  if (req.mode === "navigate" || url.pathname.endsWith(".html") || url.pathname === "/") {
    event.respondWith(
      fetch(req, { cache: "reload" })
        .then(res => {
          const copy = res.clone();
          caches.open(SGDI_CACHE).then(cache => cache.put(req, copy)).catch(() => null);
          return res;
        })
        .catch(() => caches.match(req).then(cached => cached || caches.match("/")))
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
