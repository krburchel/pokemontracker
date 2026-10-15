// App files: network-first so updates show up right away, cached copy when offline.
// Sprites and PokéAPI data: cache-first, since they never change.
// Firebase sync and sign-in requests (googleapis.com) are never cached.
var CACHE = 'poketracker-v11';
var SPRITES = 'poketracker-sprites-v1';
var POKEAPI = 'poketracker-pokeapi-v1';
var ASSETS = [
  './', './index.html', './style.css', './fonts/rubik-latin.woff2', './icons.js', './app.js', './detail.js', './timeline.js', './manifest.json',
  './data/species.json', './data/games.json', './data/badges.json', './data/exclusives.json',
  './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png', './favicon-32.png',
  './vendor/firebase/firebase-app-compat.js',
  './vendor/firebase/firebase-auth-compat.js',
  './vendor/firebase/firebase-firestore-compat.js',
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
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); })
    .then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE && k !== SPRITES && k !== POKEAPI; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  // Sprites and PokéAPI data never change, so serve them from cache once fetched.
  if (url.hostname === 'raw.githubusercontent.com' || url.hostname === 'pokeapi.co') {
    e.respondWith(caches.open(url.hostname === 'pokeapi.co' ? POKEAPI : SPRITES).then(function (c) {
      return c.match(req).then(function (hit) {
        return hit || fetch(req).then(function (res) {
          if (res.ok || res.type === 'opaque') c.put(req, res.clone());
          return res;
        });
      });
    }));
    return;
  }

  if (url.origin !== self.location.origin) return;
  // Bundled sprites never change: cache-first like the remote ones.
  if (url.pathname.indexOf('/sprites/') !== -1) {
    e.respondWith(caches.open(SPRITES).then(function (c) {
      return c.match(req).then(function (hit) {
        return hit || fetch(req).then(function (res) {
          if (res.ok) c.put(req, res.clone());
          return res;
        });
      });
    }));
    return;
  }
  // no-cache: always check with the server so a new version shows up on the next
  // open, not after the browser's own HTTP cache expires.
  e.respondWith(fetch(req, { cache: 'no-cache' }).then(function (res) {
    if (res.ok) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); });
    }
    return res;
  }).catch(function () {
    return caches.match(req, { ignoreSearch: true });
  }));
});
