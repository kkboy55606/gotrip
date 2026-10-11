// Service Worker：讓 App 可以「加到主畫面」，並在網路不穩時仍能打開畫面。
// 策略：App 本身的檔案「先上網抓新版、失敗才用快取」，避免改版後卡在舊版；
// API 請求（開放地圖、路線、氣象署、TDX…）都是別的網域，一律直接走網路、不快取。
const CACHE = 'gotrip-shell-v2';
const SHELL = [
  './',
  'index.html',
  'css/app.css',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'js/app.js',
  'js/closures.js',
  'js/config.js',
  'js/demo.js',
  'js/dom.js',
  'js/errors.js',
  'js/geo.js',
  'js/links.js',
  'js/map.js',
  'js/opening-hours.js',
  'js/osm.js',
  'js/osrm.js',
  'js/places-logic.js',
  'js/route-order.js',
  'js/storage.js',
  'js/tdx.js',
  'js/weather.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
