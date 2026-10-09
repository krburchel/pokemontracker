# PokéTracker (web)

Phone/browser companion to the PokemonTracker Mac app (`~/Developer/PokemonTracker`).
Living dex, shiny hunt counter and stats, synced through Firebase project
`pokemon-tracker-8d5ac` (Firestore `users/{uid}/records/{id}`).

Live at https://krburchel.github.io/pokemontracker/

- `data/species.json`, `data/games.json` are copied from the Mac app's Resources; re-copy when those change.
- Record payloads (the `json` field) must match `SyncDTO` in the Mac app's `Services/SyncEngine.swift`.
- `firestore.rules` is the project's full ruleset (it also keeps the older `pokemon_tracker/{uid}`
  Z-A checklist rule). Deploy with `firebase deploy --only firestore:rules`.
- `vendor/firebase` is the Firebase JS SDK 12.19.0 compat build (Apache 2.0), bundled for offline use.
- Bump `CACHE` in `sw.js` when shipping changes so installed copies refresh their offline cache.
