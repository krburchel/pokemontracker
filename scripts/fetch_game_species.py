#!/usr/bin/env python3
"""Rebuild one game's species list in data/games.json from PokéAPI Pokédexes.

    python3 -I scripts/fetch_game_species.py legendsza lumiose-city hyperspace

The Pokédexes are joined in the order given (a species keeps its first place).
Regional forms already listed for the game stay right after their base species.
Run scripts/fetch_dex_numbers.py afterwards so the game's dex numbers match.
"""
import json
import os
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GAMES_PATH = os.path.join(ROOT, "data/games.json")


def fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    game_id, dexes = sys.argv[1], sys.argv[2:]
    games = json.load(open(GAMES_PATH))
    game = next((g for g in games if g["id"] == game_id), None)
    if not game:
        sys.exit(f"No game '{game_id}' in data/games.json")
    species = {s["id"]: s for s in json.load(open(os.path.join(ROOT, "data/species.json")))}

    forms = {}   # base species id -> the game's regional forms of it
    for sid in game["species"]:
        base = species.get(sid, {}).get("baseSpeciesId") or sid
        if base != sid:
            forms.setdefault(base, []).append(sid)

    ordered, seen = [], set()
    for name in dexes:
        d = fetch_json(f"https://pokeapi.co/api/v2/pokedex/{name}/")
        entries = sorted(d["pokemon_entries"], key=lambda e: e["entry_number"])
        added = 0
        for e in entries:
            sid = int(e["pokemon_species"]["url"].rstrip("/").split("/")[-1])
            if sid in seen or sid not in species:
                continue
            seen.add(sid)
            ordered.append(sid)
            ordered.extend(forms.get(sid, []))
            added += 1
        print(f"  {name}: {len(entries)} entries, {added} added")

    dropped = [sid for sid in game["species"] if sid not in set(ordered)]
    if dropped:
        sys.exit(f"Refusing to write: {len(dropped)} species now listed would be dropped: {dropped[:20]}")
    print(f"{game_id}: {len(game['species'])} -> {len(ordered)} species")
    game["species"] = ordered
    with open(GAMES_PATH, "w") as f:
        json.dump(games, f, separators=(",", ":"))


if __name__ == "__main__":
    main()
