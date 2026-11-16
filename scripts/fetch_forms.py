#!/usr/bin/env python3
"""Builds data/forms.json and the sprites for the HOME "forms" dex.

  python3 scripts/fetch_forms.py [--cache DIR] [--no-sprites]

Adds the forms a full HOME living dex keeps apart, on top of the species and
regional forms already in data/species.json:

  * forms that stay when the Pokémon is put in HOME (Unown letters, Vivillon
    patterns, Alcremie, Rotom, Deoxys, Oricorio, ...), from PokéAPI's
    pokemon_forms table. Battle-only forms, Megas, Gigantamax, totems and
    anything in SKIP (item-held or fused forms, forms that revert in a Box,
    forms that look the same) are left out.
  * the female of every species with a visible gender difference.

Ids are stable and never reused, because catches are saved by id:
  a form that is its own PokéAPI "pokemon" (Heat Rotom)  -> that pokemon id (10008)
  a form that is only a PokéAPI "pokemon-form" (Unown B) -> 100000 + pokemon-form id
  a female                                               -> 200000 + species id

Sprites are PokéAPI's HOME renders, saved as 144px WebP next to the others
(sprites/home/r-{id}.webp, s-{id}.webp). Needs Pillow with WebP support.
"""
import argparse
import csv
import io
import json
import os
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV_URL = 'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/'
SPRITES_API = 'https://api.github.com/repos/PokeAPI/sprites/'
SPRITES_RAW = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/home/'
TABLES = ['pokemon', 'pokemon_forms', 'pokemon_form_names', 'pokemon_species',
          'pokemon_species_names', 'pokemon_types', 'types']
FORM_BASE = 100000
FEMALE_BASE = 200000

# Whole species whose extra forms are left out.
SKIP_SPECIES = {
    'arceus', 'silvally', 'genesect',          # decided by a held item
    'mothim', 'scatterbug', 'spewpa',          # no visible difference
    'kyurem', 'necrozma', 'calyrex',           # fusions can't be put in HOME
    'koraidon', 'miraidon', 'ogerpon', 'terapagos',
}
# Single forms left out, as "species:form" or "*:form" (any species; a trailing * matches a prefix).
SKIP = {
    '*:gmax', '*:totem*', '*:primal', '*:starter', '*:eternamax',
    'pikachu:cosplay', 'pikachu:rock-star', 'pikachu:belle', 'pikachu:pop-star', 'pikachu:phd', 'pikachu:libre',
    'pichu:spiky-eared',                       # can't leave HeartGold/SoulSilver
    'dialga:origin', 'palkia:origin', 'giratina:origin', 'shaymin:sky', 'hoopa:unbound',   # revert in a Box
    'greninja:battle-bond', 'rockruff:own-tempo',                                          # an ability, same look
    'zygarde:10-power-construct', 'zygarde:50-power-construct',
    'minior:*-meteor', 'minior:red',           # plain Minior stands for the red core
    '*:female',                                # handled as gender differences below
}
# Female forms that are their own PokéAPI pokemon count as forms, not gender differences.
FEMALE_FORMS = {'meowstic', 'indeedee', 'basculegion', 'oinkologne'}

# Words dropped from a form's name to keep it short in the grid.
TRIM = [' Pattern', ' Forme', ' Form', ' Cloak', ' Trim', ' Style', ' Size', ' Flower', ' Plumage', ' Sea', ' Breed']


def fetch(url, binary=False):
    req = urllib.request.Request(url, headers={'User-Agent': 'poketracker-forms-script'})
    with urllib.request.urlopen(req, timeout=60) as res:
        data = res.read()
    return data if binary else data.decode('utf-8')


def cached(cache, name, url, binary=False):
    path = os.path.join(cache, name)
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        data = fetch(url, binary=True)
        with open(path, 'wb') as f:
            f.write(data)
    with open(path, 'rb') as f:
        data = f.read()
    return data if binary else data.decode('utf-8')


def table(cache, name):
    return list(csv.DictReader(io.StringIO(cached(cache, f'csv/{name}.csv', f'{CSV_URL}{name}.csv'))))


def home_sprites(cache):
    """Every file under sprites/pokemon/other/home in PokeAPI/sprites."""
    path = os.path.join(cache, 'home_tree.json')
    if not os.path.exists(path):
        listing = json.loads(fetch(f'{SPRITES_API}contents/sprites/pokemon/other'))
        sha = next(x['sha'] for x in listing if x['name'] == 'home')
        with open(path, 'w') as f:
            f.write(fetch(f'{SPRITES_API}git/trees/{sha}?recursive=1'))
    with open(path) as f:
        return {x['path'] for x in json.load(f)['tree'] if x['type'] == 'blob'}


def skipped(species, form):
    if species in SKIP_SPECIES:
        return True
    for rule in SKIP:
        sp, fm = rule.split(':')
        if sp not in ('*', species):
            continue
        if fm == form or (fm.endswith('*') and form.startswith(fm[:-1])) or (fm.startswith('*') and form.endswith(fm[1:])):
            return True
    return False


def short(text):
    for word in TRIM:
        text = text.replace(word, '')
    return text.strip()


def form_title(ident, base, label, names):
    if ident == 'unown':
        return f'{base} {label}'
    if ident == 'alcremie' or not names.get('pokemon_name'):
        return f'{base} ({label})'
    return short(names['pokemon_name'])


def build(cache):
    pokemon = {int(r['id']): r for r in table(cache, 'pokemon')}
    species = {int(r['id']): r for r in table(cache, 'pokemon_species')}
    species_name = {int(r['pokemon_species_id']): r['name'] for r in table(cache, 'pokemon_species_names')
                    if r['local_language_id'] == '9'}
    form_names = {int(r['pokemon_form_id']): r for r in table(cache, 'pokemon_form_names')
                  if r['local_language_id'] == '9'}
    type_name = {r['id']: r['identifier'] for r in table(cache, 'types')}
    types = {}
    for r in sorted(table(cache, 'pokemon_types'), key=lambda r: int(r['slot'])):
        types.setdefault(int(r['pokemon_id']), []).append(type_name[r['type_id']])
    tree = home_sprites(cache)
    with open(os.path.join(ROOT, 'data', 'species.json')) as f:
        have = {s['id'] for s in json.load(f)}

    out = []
    defaults = {}                                      # species id -> its default form's row
    for f in table(cache, 'pokemon_forms'):
        p = pokemon[int(f['pokemon_id'])]
        if f['is_default'] == '1' and p['is_default'] == '1':
            defaults[int(p['species_id'])] = f
    for f in sorted(table(cache, 'pokemon_forms'), key=lambda r: (int(r['order']), int(r['id']))):
        p = pokemon[int(f['pokemon_id'])]
        sid = int(p['species_id'])
        own_pokemon = f['is_default'] == '1'          # the form is a PokéAPI pokemon of its own
        if own_pokemon and p['is_default'] == '1':
            continue                                   # the species itself
        if f['is_mega'] == '1' or f['is_battle_only'] == '1':
            continue
        ident = species[sid]['identifier']
        form = f['form_identifier']
        if own_pokemon and int(p['id']) in have:
            continue                                   # a regional form already in species.json
        if form == 'female' and own_pokemon and ident in FEMALE_FORMS:
            pass
        elif skipped(ident, form):
            continue
        names = form_names.get(int(f['id']), {})
        base = species_name[sid]
        label = names.get('form_name') or form.replace('-', ' ').title()
        if ident != 'alcremie':
            label = short(label)
        else:                                          # "Ruby Cream Strawberry Sweet" -> "Ruby Cream, Strawberry"
            label = label.replace(' Sweet', '')
            for cream in ('Cream ', 'Swirl '):
                if cream in label:
                    head, tail = label.split(cream, 1)
                    label = f'{head}{cream.strip()}, {tail}'
                    break
        if form == 'female':
            name = f'{base} ♀'
        else:
            name = form_title(ident, base, label, names)
        key = str(p['id']) if own_pokemon else f'{sid}-{form}'
        out.append({
            'id': int(p['id']) if own_pokemon else FORM_BASE + int(f['id']),
            'name': name,
            'generation': int(species[sid]['generation_id']),
            'types': types[int(p['id'])],
            'baseSpeciesId': sid,
            'formName': form,
            'kind': 'form',
            'apiId': int(p['id']),
            'sprite': key if f'{key}.png' in tree else str(sid),
        })

    for sid in sorted(species):
        s = species[sid]
        if s['has_gender_differences'] != '1' or s['identifier'] in FEMALE_FORMS:
            continue
        if f'female/{sid}.png' not in tree:
            continue
        out.append({
            'id': FEMALE_BASE + sid,
            'name': f'{species_name[sid]} ♀',
            'generation': int(s['generation_id']),
            'types': types[sid],
            'baseSpeciesId': sid,
            'formName': 'female',
            'kind': 'female',
            'apiId': sid,
            'sprite': f'female/{sid}',
        })
    # What the plain species entry is called once its other forms are listed
    # beside it: "Unown A", "Meadow Vivillon", "Meowstic ♂".
    base_names = {}
    for sid in sorted({e['baseSpeciesId'] for e in out if e['kind'] == 'form'}):
        ident = species[sid]['identifier']
        f = defaults[sid]
        names = form_names.get(int(f['id']), {})
        if ident in FEMALE_FORMS:
            base_names[sid] = f'{species_name[sid]} ♂'
        elif ident != 'minior' and names.get('form_name'):
            label = short(names.get('form_name') or '')
            if ident == 'alcremie':
                label = 'Vanilla Cream, Strawberry'
            if label and label != species_name[sid]:
                base_names[sid] = form_title(ident, species_name[sid], label, names)
    ids = [e['id'] for e in out]
    assert len(ids) == len(set(ids)) and not (set(ids) & have), 'form ids must be unique'
    return out, base_names, tree


def save_sprites(cache, forms, tree):
    from PIL import Image
    dest = os.path.join(ROOT, 'sprites', 'home')

    def one(job):
        entry, shiny = job
        target = os.path.join(dest, f"{'s' if shiny else 'r'}-{entry['id']}.webp")
        if os.path.exists(target):
            return 0
        key = entry['sprite']
        path = f"{'shiny/' if shiny else ''}{key}.png"
        if path not in tree:                           # no shiny render of this form: use the species'
            path = f"{'shiny/' if shiny else ''}{entry['baseSpeciesId']}.png"
        png = cached(cache, f'png/{path}', SPRITES_RAW + path, binary=True)
        img = Image.open(io.BytesIO(png)).convert('RGBA').resize((144, 144), Image.LANCZOS)
        img.save(target, 'WEBP', quality=82, method=6)
        return 1

    jobs = [(e, shiny) for e in forms for shiny in (False, True)]
    with ThreadPoolExecutor(8) as pool:
        made = sum(pool.map(one, jobs))
    print(f'sprites: {made} new, {len(jobs) - made} already there')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache', default=os.path.join(ROOT, '.forms-cache'), help='where downloads are kept')
    ap.add_argument('--no-sprites', action='store_true')
    args = ap.parse_args()
    forms, base_names, tree = build(args.cache)
    with open(os.path.join(ROOT, 'data', 'forms.json'), 'w') as f:
        json.dump({'forms': forms, 'baseNames': base_names}, f, ensure_ascii=False, separators=(',', ':'))
        f.write('\n')
    kinds = {k: sum(1 for e in forms if e['kind'] == k) for k in ('form', 'female')}
    print(f"data/forms.json: {kinds['form']} forms, {kinds['female']} females")
    if not args.no_sprites:
        save_sprites(args.cache, forms, tree)


if __name__ == '__main__':
    sys.exit(main())
