#!/usr/bin/env python3
"""Write data/dexnums.json: each game's own (regional) Pokédex numbers.

{gameId: {"dexes": [full names], "short": [grid prefixes, "" for the main dex],
          "nums": {speciesOrFormId: [dexIndex, number]}}}

Forms use their base species' number. A species in several of a game's dexes
keeps its number from the first one listed. Species on no regional dex (and
games with no regional dex: Home, GO) fall back to the national number in the app.

Run: python3 -I scripts/fetch_dex_numbers.py
"""
import json
import os
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# gameId: [(PokéAPI pokedex, full name, grid prefix)]
DEXES = {
    "gsc": [("original-johto", "Johto", "")],
    "rse": [("hoenn", "Hoenn", "")],
    "frlg": [("kanto", "Kanto", "")],
    "dpp": [("extended-sinnoh", "Sinnoh", "")],
    "hgss": [("updated-johto", "Johto", "")],
    "bw": [("original-unova", "Unova", "")],
    "b2w2": [("updated-unova", "Unova", "")],
    "xy": [("kalos-central", "Central Kalos", ""), ("kalos-coastal", "Coastal Kalos", "Coastal"),
           ("kalos-mountain", "Mountain Kalos", "Mountain")],
    "oras": [("updated-hoenn", "Hoenn", "")],
    "sumo": [("original-alola", "Alola", "")],
    "usum": [("updated-alola", "Alola", "")],
    "letsgo": [("letsgo-kanto", "Kanto", "")],
    "swsh": [("galar", "Galar", ""), ("isle-of-armor", "Isle of Armor", "Armor"),
             ("crown-tundra", "Crown Tundra", "Tundra")],
    # BDSP's Sinnoh dex is the original Diamond/Pearl one; Platinum additions are national-only there.
    "bdsp": [("original-sinnoh", "Sinnoh", "")],
    "legendsarceus": [("hisui", "Hisui", "")],
    "sv": [("paldea", "Paldea", ""), ("kitakami", "Kitakami", "Kitakami"), ("blueberry", "Blueberry", "Blueberry")],
    "legendsza": [("lumiose-city", "Lumiose", "")],
}


def fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def main():
    games = json.load(open(os.path.join(ROOT, "data/games.json")))
    species = {s["id"]: s for s in json.load(open(os.path.join(ROOT, "data/species.json")))}
    out = {}
    for game in games:
        dexes = DEXES.get(game["id"])
        if not dexes:
            continue
        by_species = {}
        for i, (name, _, _) in enumerate(dexes):
            d = fetch_json(f"https://pokeapi.co/api/v2/pokedex/{name}/")
            nums = [e["entry_number"] for e in d["pokemon_entries"]]
            print(f"  {name}: {len(nums)} entries, #{min(nums)}–#{max(nums)}")
            for e in d["pokemon_entries"]:
                sid = int(e["pokemon_species"]["url"].rstrip("/").split("/")[-1])
                by_species.setdefault(sid, [i, int(e["entry_number"])])
        nums = {}
        missing = []
        for sid in game["species"]:
            base = species.get(sid, {}).get("baseSpeciesId") or sid
            if base in by_species:
                nums[str(sid)] = by_species[base]
            else:
                missing.append(sid)
        out[game["id"]] = {"dexes": [d[1] for d in dexes], "short": [d[2] for d in dexes], "nums": nums}
        print(f"{game['id']}: {len(nums)}/{len(game['species'])} numbered" +
              (f"; national only: {missing[:12]}{'…' if len(missing) > 12 else ''} ({len(missing)})" if missing else ""))
    with open(os.path.join(ROOT, "data/dexnums.json"), "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"Wrote {len(out)} games")


if __name__ == "__main__":
    main()
