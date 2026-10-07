# PokéTracker (web)

Phone/browser companion to the PokemonTracker Mac app (`~/Developer/PokemonTracker`).
Living dex, shiny hunt counter and stats, synced through Supabase project
`pokemon-tracker` (`cmgajwvtnjqcoexzhgqa`), table `public.records`.

Live at https://krburchel.github.io/pokemontracker/

- `data/species.json`, `data/games.json` are copied from the Mac app's Resources; re-copy when those change.
- Record `data` shapes must match `SyncDTO` in the Mac app's `Services/SyncEngine.swift`.
- Bump `CACHE` in `sw.js` when shipping changes so installed copies refresh their offline cache.
