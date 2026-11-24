/* AutoCare · Service Worker · caché para uso sin conexión / offline cache */
'use strict';

const CACHE = 'autocare-v1.2.4';
/* El recorte IA carga modulos y pesos desde estos CDNs. El service worker NO
   debe interceptarlos: un cache outage (o una respuesta HTML del offline
   fallback) rompe la carga de WASM/ONNX y deja el recorte en fallback. */
const AI_CDN_HOSTS = new Set([
  'cdn.jsdelivr.net',
  'huggingface.co',
  'cdn-lfs.huggingface.co',
  'cdn-lfs-us-1.huggingface.co',
  'cdn-lfs-eu-1.huggingface.co'
]);
function isAICdn(host) {
  const h = String(host || '').toLowerCase();
  return AI_CDN_HOSTS.has(h) || h.endsWith('.huggingface.co');
}
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

/* URLs de la app: nunca se borran al purgar imágenes de usuario. */
const CORE_URLS = new Set(CORE.map(p => new URL(p, self.location.href).href));
const IMAGE_RE = /\.(?:png|jpe?g|gif|webp|avif|bmp|svg)(?:$|\?)/i;
function isUserImageRequest(req) {
  try {
    const u = new URL(req.url);
    if (CORE_URLS.has(u.href) || /\/icons\//i.test(u.pathname)) return false;
    return req.destination === 'image' || IMAGE_RE.test(u.pathname);
  } catch (e) { return false; }
}
async function purgeUserImages() {
  const names = await caches.keys();
  await Promise.all(names.map(async name => {
    const cache = await caches.open(name);
    const requests = await cache.keys();
    await Promise.all(requests.filter(isUserImageRequest).map(req => cache.delete(req).catch(() => {})));
  }));
}

/* Solicitado por storage.wipe(): limpia cualquier imagen cacheada al borrar todos los datos. */
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'AC_PURGE_USER_IMAGES') {
    event.waitUntil(purgeUserImages());
  }
});

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
  /* Peticiones externas: directo a la red, sin cache ni interceptacion.
     Solo se gestionan aqui las URLs propias de la app. */
  if (crossOrigin) return;

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

  /* Recursos propios de la app: caché primero, con actualización
     silenciosa en segundo plano cuando hay conexión. */
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
