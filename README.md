# PokéTracker (web)

The main PokéTracker app (the Mac app in `~/Developer/PokemonTracker` is optional and uses the
same data). Living dex with gym badges, Pokémon detail sheet (stats, evolutions, locations,
notes/tags per catch), shiny hunts with phases/notes/best-method suggestions, timeline and stats,
synced through Firebase project `pokemon-tracker-8d5ac` (Firestore `users/{uid}/records/{id}`).

Files: `icons.js` (icon set), `app.js` (sync, dex, hunts, stats, auth), `detail.js` (detail sheet + PokéAPI),
`timeline.js` (timeline tab). Script order in `index.html`: icons.js, detail.js, timeline.js, app.js.

Live at https://krburchel.github.io/pokemontracker/

- `data/species.json`, `data/games.json` are copied from the Mac app's Resources; `data/badges.json` is
  generated from its `Services/GymData.swift`. Re-copy when those change.
- Catches in paired games may carry `versions: ["scarlet", ...]` (ids in `VERSIONS` in app.js, same as the
  Mac app's exclusives.json); the Mac app stores them as `versionsRaw`.
- Record payloads (the `json` field) must match `SyncDTO` in the Mac app's `Services/SyncEngine.swift`.
- `firestore.rules` is the project's full ruleset (the old Z-A checklist app and its
  `pokemon_tracker/{uid}` data were removed 2026-10-14). Deploy with `firebase deploy --only firestore:rules`.
- `logos/` holds the official English game logos (Nintendo / The Pokémon Company trademarks, personal fan use),
  from Bulbagarden Archives, plus Gold/Silver from Wikipedia; re-encoded to 112px-tall WebP. One file per
  version of paired games (`{game}-0.webp`, `{game}-1.webp`); counts are in `GAME_LOGOS` in app.js.
- `sprites/home/{r|s}-{id}.webp` are 144px copies of PokéAPI's HOME 3D renders (regular/shiny) for grids;
  the detail sheet loads the full-size render. Settings → Pokémon sprites switches to pixel sprites.
- `icons.js` is the shared line-icon set (tab bar, toolbar, markers, timeline).
- `vendor/firebase` is the Firebase JS SDK 12.19.0 compat build (Apache 2.0), bundled for offline use.
- Bump `CACHE` in `sw.js` when shipping changes so installed copies refresh their offline cache.
