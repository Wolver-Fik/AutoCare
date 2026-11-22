/* AutoCare · Service Worker · caché para uso sin conexión / offline cache */
'use strict';

const CACHE = 'autocare-v1.0.9';
/* CDNs permitidos para el módulo y los pesos WASM/ONNX del recorte de fondo */
const AI_CDN = /^(?:.+\.)?(?:esm\.sh|jsdelivr\.net|imgly\.com|staticimgly\.com)$/i;
const CORE = [
  './',
  './index.html',
  './css/styles.css',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/demo-car.png',
  './js/i18n.js',
  './js/i18n/en.js',
  './js/i18n/es.js',
  './js/i18n/pt.js',
  './js/i18n/fr.js',
  './js/i18n/it.js',
  './js/i18n/de.js',
  './js/i18n/ru.js',
  './js/i18n/ja.js',
  './js/storage.js',
  './js/app.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(CORE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    Promise.all([
      caches.keys().then(keys =>
        Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))
      ),
      self.clients.claim()
    ])
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  const crossOrigin = url.origin !== self.location.origin;
  if (crossOrigin && !AI_CDN.test(url.hostname)) return;

  /* HTML: primero la red, siempre la versión más reciente. */
  const isHTML = !crossOrigin && (req.mode === 'navigate' || (req.headers.get('accept') || '').indexOf('text/html') >= 0);
  if (isHTML) {
    event.respondWith(
      fetch(req).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(cache => cache.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() =>
        caches.match(req).then(hit => hit || caches.match('./index.html'))
      )
    );
    return;
  }

  /* Recursos propios y pesos WASM/ONNX del CDN de IA: caché primero,
     con actualización silenciosa en segundo plano cuando hay conexión. */
  event.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req).then(res => {
        if (res && (res.ok || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(CACHE).then(cache => cache.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => cached || Response.error());
      return cached || network;
    })
  );
});
