# PokéTracker (web)

The main PokéTracker app (the Mac app in `~/Developer/PokemonTracker` is optional and uses the
same data). Living dex with gym badges, Pokémon detail sheet (stats, evolutions, locations,
notes/tags per catch), shiny hunts with phases/notes/best-method suggestions, timeline and stats,
synced through Firebase project `pokemon-tracker-8d5ac` (Firestore `users/{uid}/records/{id}`).

Files: `icons.js` (icon set), `app.js` (sync, dex, hunts, stats, auth), `detail.js` (detail sheet + PokéAPI),
`timeline.js` (timeline tab), `compare.js` (Compare sheet, opened from Stats), `tohome.js` (Move to HOME sheet,
opened from Stats), `palette.js` (command palette: bolt button or Ctrl/⌘K). Script order in `index.html`: icons.js,
detail.js, timeline.js, compare.js, tohome.js, palette.js, app.js.

Games shown: HOME and the Switch / Switch 2 games only (`SHOWN_GAMES` in `app.js`). The older games and GO stay
in `data/games.json`, and their catches, badges and playthroughs stay in the account and in JSON backups, but
`live()` leaves them out everywhere else. Add an id to `SHOWN_GAMES` to bring a game back (and its logos to
`ASSETS` in `sw.js`).

Startup: the app draws from this device's saved copy (IndexedDB database `poketracker`: `rows`, `pending`,
`meta`) before anything else loads. `app.js` then loads Firebase Auth, checks sign-in and syncs with
Firestore over its REST API (`runQuery` / `commit`, the same calls as the Mac app's `CloudClient.swift`);
there is no Firestore library.

Live at https://krburchel.github.io/pokemontracker/

- Legends: Z-A's list is Lumiose plus the Mega Dimension DLC's Hyperspace Pokédex, added here with
  `python3 -I scripts/fetch_game_species.py legendsza lumiose-city hyperspace` (then `scripts/fetch_dex_numbers.py`).
  The Mac app's copy doesn't have it, so re-copying `games.json` from there would drop it.
- `data/species.json`, `data/games.json` are copied from the Mac app's Resources; `data/badges.json` is
  generated from its `Services/GymData.swift`. Re-copy when those change. `data/exclusives.json` (version exclusives) comes from the Mac
  project's `scripts/fetch_exclusives.py`.
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
- HOME forms (Settings → HOME forms: Off / Forms / Forms + ♀; `prefs.homeForms`, per device, off by default):
  `data/forms.json` holds 204 extra forms that stay in HOME (Unown letters, Vivillon patterns, Alcremie, Rotom,
  cap Pikachu…) and the 98 females with a visible gender difference, plus `baseNames` (what the plain entry is
  called beside its forms: "Unown A"). `applyHomeForms` in app.js inserts them into HOME's list right after
  their species (female first, then forms), so the grid, box view, Stats and Compare all follow. Only HOME lists
  them. Rebuild with `python3 scripts/fetch_forms.py` (needs Pillow; reads PokéAPI's CSV tables and HOME renders);
  what's left out and why is in `SKIP` / `SKIP_SPECIES` at the top of that script. Ids are permanent because
  catches are saved by id: a form that is its own PokéAPI pokemon keeps that id (Heat Rotom 10008), other forms
  are 100000 + the PokéAPI pokemon-form id (Unown B 110001), females are 200000 + the species id. Each entry has
  `sprite` (PokéAPI file name, e.g. `201-b`, `female/3`) and `apiId` (the pokemon its stats load from). The Mac
  app doesn't know these ids.
- Wide screens (CSS at the end of style.css): from 900px the tab bar is a rail down the left; from 1100px, on
  the Dex tab, the detail sheet opens docked on the right instead of over the grid (`detailDocks` /
  `openDialog(dlg, false)`; `#detail-dlg.docked`, `.app.with-panel`). It is a non-modal dialog, so code that
  asks "is a dialog in the way?" checks `dialog:modal`, not `dialog[open]`. The docked panel shows the Pokémon
  last opened (outlined in the grid), follows the arrow keys, and closes with Esc, its ✕, Back or a tab change.
  Grid keys (`onDexKey`): arrows, Home / End, Enter or Space to mark, I for details.
- `icons.js` is the shared line-icon set (tab bar, toolbar, markers, timeline).
- Dex extras: box view (`boxesOf` in app.js: 30 per box, Gen 2 20, filled in the same order as the grid, so
  regional forms sit right after their base Pokémon, HOME included; none for GO / Let's Go), mark or unmark everything shown (Filters sheet),
  an Undo toast whenever a catch is removed (`writeWithUndo`), CSV export of catches (Settings → Backup;
  `buildCatchesCSV`, the Mac app's columns plus `versions`), and saved filter sets (`prefs.savedFilters`,
  kept per device in localStorage, not synced).
- Hunts: Space adds +1 with a keyboard, and the screen stays on while counting (wake lock, dropped after
  10 minutes without a tap).
  A hunt saves its game as `gameId` (from the suggestion tapped or the Game menu in New Shiny Hunt; older hunts
  have none), shown on the card and used to prefill "Shiny caught!", which also asks which copy of a paired game
  and saves it as the catch's `versions`. `gameId` is not in the Mac app's `SyncDTO` yet, so the Mac app would
  drop it when it rewrites a hunt. Counting uploads at most every 5 s (`COUNT_FLUSH_MS`, the `lazy` flag on
  `write`); every other edit still uploads 0.6 s after the last one.
- Dex layout: Search, Filters and the tap mode sit in `.pinbar`, which stays under the top bar while the dex
  scrolls (on phones the top bar scrolls away on the Dex tab instead). Settings → Dex grid switches to a compact
  grid (`prefs.density`, per device): sprite and number only, a dot per version marked, five across on a phone.
- `vendor/firebase` is the Firebase JS SDK 12.19.0 compat build of App + Auth (Apache 2.0), bundled for offline use.
- **Bump `CACHE` in `sw.js` on every deploy.** The service worker serves app files from that version's saved
  copy, so without a bump nobody gets the change. A new file the app needs offline goes in `ASSETS` too.
  When a new version takes over, the page reloads itself (or shows a Reload toast if it's in use).
