# Firebase JS SDK (compat builds)

`firebase-app-compat.js` and `firebase-auth-compat.js` are the unmodified compat builds of the
[Firebase JS SDK](https://github.com/firebase/firebase-js-sdk) version 12.19.0, from
`https://www.gstatic.com/firebasejs/12.19.0/`. They're bundled so sign-in works offline (the
service worker caches them). Copyright Google LLC, Apache License 2.0 (see `LICENSE`).

`app.js` loads them after the first screen is drawn (`startFirebase`). Sync uses Firestore's REST
API directly, so the Firestore library isn't needed.
