const CACHE = 'kakeibo-v16';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'syncCore.js', 'sync.js', 'firebase-config.js', 'manifest.json', 'icon.svg'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.hostname === 'www.gstatic.com') {
    // Firebase SDK: ネット優先、オフラインなら前回のキャッシュ(同期はオフラインでも起動できるように)
    e.respondWith(caches.open(CACHE).then(c => fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => c.match(e.request))));
    return;
  }
  if (url.origin !== location.origin) return;
  // アプリ本体: ネット優先(更新がすぐ反映される)、オフラインなら保存済みの版を使う
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});
