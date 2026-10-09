# Firebase JS SDK (compat builds)

`firebase-app-compat.js`, `firebase-auth-compat.js` and `firebase-firestore-compat.js` are the
unmodified compat builds of the [Firebase JS SDK](https://github.com/firebase/firebase-js-sdk)
version 12.19.0, from `https://www.gstatic.com/firebasejs/12.19.0/`. They're bundled so sync
works offline (the service worker caches them). Copyright Google LLC, Apache License 2.0
(see `LICENSE`).

The app loads them only on devices signed in to sync (see `js/sync.js`).
