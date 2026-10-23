// GhostFlix service worker: app shell only. Registered as /sw.js?v=<asset version>, so each deploy gets a fresh cache.
const VERSION = new URL(self.location).searchParams.get('v') || 'dev'; // shell build 20261023w3 (Normal default theme + background animation; footer wording; Halloween season theme; resume, genres, people search; offline page; up next, source switcher, skip intro)
const CACHE = `gf-shell-${VERSION}`;
const OFFLINE = '/offline.html';
const SHELL = ['/', OFFLINE, '/manifest.webmanifest', '/favicon.svg', '/img/logo.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('gf-shell-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

const isShellAsset = (url) => /\.(?:js|css|svg|png|webp|woff2?)$/.test(url.pathname) && !url.pathname.startsWith('/vendor/') && !url.pathname.startsWith('/brand/');

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // third-party embeds, TMDB images, fonts: never touched
  if (url.pathname.startsWith('/api/') || url.pathname === '/sw.js') return; // API (incl. playback) always live, never cached
  if (/\.(?:mp4|webm|m3u8|ts|m4s|vtt|mp3)$/.test(url.pathname)) return; // media streams never cached

  // HTML navigations: network-first; when the network is down, show the cached offline page.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('/', copy)); }
      return res;
    }).catch(() => caches.match(OFFLINE, { cacheName: CACHE })));
    return;
  }

  // Versioned shell assets (?v=...): the URL changes every deploy, so cache-first is safe.
  if (isShellAsset(url) && (url.searchParams.has('v') || SHELL.includes(url.pathname))) {
    e.respondWith(caches.open(CACHE).then((c) => c.match(req).then((hit) => hit || fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }))));
  }
  // Everything else: straight to the network.
});
