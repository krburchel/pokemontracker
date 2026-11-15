// App files (the list below) are saved per version and served from that copy, so the
// app opens without waiting on the network. Bump CACHE on every deploy: the browser
// then installs the new version in the background and the page reloads or offers to.
// Sprites and PokéAPI data: cache-first, since they never change.
// Sign-in and sync requests (googleapis.com) are never cached.
var CACHE = 'poketracker-v15';
// v2: remote sprites are now fetched with CORS. v1 held them as opaque responses,
// which browsers count as several MB each against the storage quota.
var SPRITES = 'poketracker-sprites-v2';
var POKEAPI = 'poketracker-pokeapi-v1';
var ASSETS = [
  './', './index.html', './style.css', './fonts/rubik-latin.woff2', './icons.js', './app.js', './detail.js', './timeline.js', './manifest.json',
  './data/species.json', './data/games.json', './data/badges.json', './data/exclusives.json', './data/dexnums.json',
  './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png', './favicon-32.png',
  './vendor/firebase/firebase-app-compat.js',
  './vendor/firebase/firebase-auth-compat.js',
  './logos/b2w2-0.webp',
  './logos/b2w2-1.webp',
  './logos/bdsp-0.webp',
  './logos/bdsp-1.webp',
  './logos/bw-0.webp',
  './logos/bw-1.webp',
  './logos/dpp-0.webp',
  './logos/dpp-1.webp',
  './logos/frlg-0.webp',
  './logos/frlg-1.webp',
  './logos/gsc-0.webp',
  './logos/gsc-1.webp',
  './logos/hgss-0.webp',
  './logos/hgss-1.webp',
  './logos/home-0.webp',
  './logos/legendsarceus-0.webp',
  './logos/legendsza-0.webp',
  './logos/letsgo-0.webp',
  './logos/letsgo-1.webp',
  './logos/oras-0.webp',
  './logos/oras-1.webp',
  './logos/pogo-0.webp',
  './logos/rse-0.webp',
  './logos/rse-1.webp',
  './logos/sumo-0.webp',
  './logos/sumo-1.webp',
  './logos/sv-0.webp',
  './logos/sv-1.webp',
  './logos/swsh-0.webp',
  './logos/swsh-1.webp',
  './logos/usum-0.webp',
  './logos/usum-1.webp',
  './logos/xy-0.webp',
  './logos/xy-1.webp'
];

self.addEventListener('install', function (e) {
  // cache: 'reload' skips the browser's HTTP cache, which can hold files from before the deploy.
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(ASSETS.map(function (url) {
      return fetch(new Request(url, { cache: 'reload' })).then(function (res) {
        if (!res.ok) throw new Error(url + ' ' + res.status);
        return c.put(url, res);
      });
    }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    // Only this app's caches: every app on krburchel.github.io shares one cache store.
    return Promise.all(keys.filter(function (k) { return k.indexOf('poketracker-') === 0 && k !== CACHE && k !== SPRITES && k !== POKEAPI; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function cacheFirst(cacheName, req, options) {
  return caches.open(cacheName).then(function (c) {
    return c.match(req, options).then(function (hit) {
      return hit || fetch(req).then(function (res) {
        if (res.ok) c.put(req, res.clone());
        return res;
      });
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  if (url.hostname === 'raw.githubusercontent.com') { e.respondWith(cacheFirst(SPRITES, req)); return; }
  if (url.hostname === 'pokeapi.co') { e.respondWith(cacheFirst(POKEAPI, req)); return; }
  if (url.origin !== self.location.origin) return;
  // Bundled sprites are saved as they're viewed (there are 17 MB of them).
  if (url.pathname.indexOf('/sprites/') !== -1) { e.respondWith(cacheFirst(SPRITES, req)); return; }

  // App files: this version's saved copy; anything not in it comes from the network.
  e.respondWith(cacheFirst(CACHE, req, { ignoreSearch: true, ignoreVary: true }).catch(function (err) {
    if (req.mode !== 'navigate') throw err;
    return caches.open(CACHE).then(function (c) { return c.match('./index.html'); });
  }));
});
