// Service worker: l'app si apre e funziona anche senza rete (tutti i dati sono nel telefono).
const SHELL = 'shell-v1';
const FILES = [
  './', 'index.html', 'css/style.css', 'manifest.webmanifest',
  'js/app.js', 'js/db.js', 'js/charts.js', 'js/version.js',
  'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;   // aggiornamenti da GitHub: diretti
  // Prima la rete (così le modifiche si vedono subito), poi la copia salvata.
  e.respondWith(
    fetch(url.href, { cache: 'no-cache', credentials: 'same-origin' }).then(res => {
      if (res.ok) caches.open(SHELL).then(c => c.put(e.request, res.clone()));
      return res.clone();
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
