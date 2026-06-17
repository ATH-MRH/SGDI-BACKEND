// Service Worker — Portail RH IRONGS
const CACHE = 'portail-rh-v17-qr-fix';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first : API jamais mise en cache
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) {
          caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

// Réception d'une notification push
self.addEventListener('push', e => {
  if (!e.data) return;
  let d;
  try { d = e.data.json(); } catch { d = { title: 'Portail RH', body: e.data.text() }; }
  e.waitUntil(
    self.registration.showNotification(d.title || 'Portail RH', {
      body: d.body || '',
      icon: '/static/sgdi-icon-192.png',
      badge: '/static/sgdi-icon-192.png',
      tag: d.tag || 'portail-rh',
      data: { url: d.url || '/' },
      vibrate: [200, 100, 200],
      requireInteraction: !!d.requireInteraction
    })
  );
});

// Clic sur la notification → ouvrir ou ramener l'app
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const w = list.find(c => new URL(c.url).origin === self.location.origin);
      return w ? w.focus() : clients.openWindow(url);
    })
  );
});
