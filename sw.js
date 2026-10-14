// App files: network-first so updates show up right away, cached copy when offline.
// Sprites and PokéAPI data: cache-first, since they never change.
// Firebase sync and sign-in requests (googleapis.com) are never cached.
var CACHE = 'poketracker-v5';
var SPRITES = 'poketracker-sprites-v1';
var POKEAPI = 'poketracker-pokeapi-v1';
var ASSETS = [
  './', './index.html', './style.css', './app.js', './detail.js', './timeline.js', './manifest.json',
  './data/species.json', './data/games.json', './data/badges.json',
  './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png', './favicon-32.png',
  './vendor/firebase/firebase-app-compat.js',
  './vendor/firebase/firebase-auth-compat.js',
  './vendor/firebase/firebase-firestore-compat.js'
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
  e.respondWith(fetch(req).then(function (res) {
    if (res.ok) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); });
    }
    return res;
  }).catch(function () {
    return caches.match(req, { ignoreSearch: true });
  }));
});
