// App files: network-first so updates show up right away, cached copy when offline.
// Sprites and the Supabase library: cache-first, since they never change.
// Sync requests to supabase.co are never cached.
var CACHE = 'poketracker-v1';
var SPRITES = 'poketracker-sprites-v1';
var ASSETS = [
  './', './index.html', './style.css', './app.js', './manifest.json',
  './data/species.json', './data/games.json',
  './icon-192.png', './icon-512.png', './apple-touch-icon.png', './favicon-32.png',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); })
    .then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE && k !== SPRITES; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.hostname.endsWith('supabase.co')) return;

  if (url.hostname === 'raw.githubusercontent.com' || url.hostname === 'cdn.jsdelivr.net') {
    var bucket = url.hostname === 'cdn.jsdelivr.net' ? CACHE : SPRITES;
    e.respondWith(caches.open(bucket).then(function (c) {
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
