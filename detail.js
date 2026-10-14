'use strict';

// Pokémon detail sheet: sprites, cry, types, ownership per game (with notes,
// tags and catch date), base stats, evolution chain, Pokédex entry and where
// to find it. Port of the Mac app's PokemonDetailView + DetailFetcher.
// Loaded before app.js; everything here runs only after boot.

const TYPE_COLORS = {
  normal: '#a8a87a', fire: '#ed8230', water: '#638ff0', electric: '#f7d12b',
  grass: '#7ac74d', ice: '#96d9d6', fighting: '#c22e29', poison: '#a33da1',
  ground: '#e3bf66', flying: '#a88ff2', psychic: '#fa5487', bug: '#a6ba1a',
  rock: '#b5a136', ghost: '#735796', dragon: '#7036fc', dark: '#705745',
  steel: '#b8b8cf', fairy: '#d685ad',
};
const typeBadge = (t) =>
  `<span class="type" style="background:${TYPE_COLORS[t] || '#888'}">${t[0].toUpperCase() + t.slice(1)}</span>`;

// PokéAPI version names per game, for grouping encounter locations (Game.pokeapiVersions).
const POKEAPI_VERSIONS = {
  gsc: ['gold', 'silver', 'crystal'], rse: ['ruby', 'sapphire', 'emerald'],
  frlg: ['firered', 'leafgreen'], dpp: ['diamond', 'pearl', 'platinum'],
  hgss: ['heartgold', 'soulsilver'], bw: ['black', 'white'], b2w2: ['black-2', 'white-2'],
  xy: ['x', 'y'], oras: ['omega-ruby', 'alpha-sapphire'], sumo: ['sun', 'moon'],
  usum: ['ultra-sun', 'ultra-moon'], letsgo: ['lets-go-pikachu', 'lets-go-eevee'],
  swsh: ['sword', 'shield'], bdsp: ['brilliant-diamond', 'shining-pearl'],
  legendsarceus: ['legends-arceus'], sv: ['scarlet', 'violet'], legendsza: ['legends-z-a'],
};

const prettySlug = (s) => s.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

// ---- PokéAPI ----------------------------------------------------------------
const detailCache = new Map();   // speciesId -> Promise<detail>

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`PokéAPI ${res.status}`);
  return res.json();
}

function loadDetail(sp) {
  if (!detailCache.has(sp.id)) {
    const p = (async () => {
      const baseId = sp.baseSpeciesId ?? sp.id;
      const [pokemon, species, encounters] = await Promise.all([
        fetchJSON(`https://pokeapi.co/api/v2/pokemon/${sp.id}/`),
        fetchJSON(`https://pokeapi.co/api/v2/pokemon-species/${baseId}/`),
        fetchJSON(`https://pokeapi.co/api/v2/pokemon/${sp.id}/encounters`).catch(() => []),
      ]);
      const chain = species.evolution_chain?.url ? await fetchJSON(species.evolution_chain.url) : null;
      return {
        stats: parseStats(pokemon),
        flavor: parseFlavor(species),
        evolution: chain ? walkChain(chain.chain, null, []) : [],
        encounters: parseEncounters(encounters),
      };
    })();
    // Don't cache failures, so reopening retries.
    p.catch(() => detailCache.delete(sp.id));
    detailCache.set(sp.id, p);
  }
  return detailCache.get(sp.id);
}

function parseStats(json) {
  const labels = { hp: 'HP', attack: 'Atk', defense: 'Def', 'special-attack': 'SpA', 'special-defense': 'SpD', speed: 'Spe' };
  const by = Object.fromEntries((json.stats || []).map((s) => [s.stat.name, s.base_stat]));
  return Object.keys(labels).filter((k) => k in by).map((k) => ({ label: labels[k], value: by[k] }));
}

function parseFlavor(json) {
  const en = (json.flavor_text_entries || []).filter((e) => e.language?.name === 'en');
  const last = en[en.length - 1];
  return last ? last.flavor_text.replace(/[\f\n]/g, ' ').replace(/ {2,}/g, ' ') : null;
}

function walkChain(node, trigger, out) {
  const id = Number(node.species?.url?.split('/').filter(Boolean).pop());
  if (id) out.push({ speciesId: id, trigger });
  for (const child of node.evolves_to || []) walkChain(child, formatTrigger(child.evolution_details || []), out);
  return out;
}

function formatTrigger(details) {
  const d = details[0];
  if (!d) return null;
  const trigger = d.trigger?.name || '';
  const parts = [];
  switch (trigger) {
    case 'level-up':
      if (d.min_level) parts.push(`Lv. ${d.min_level}`);
      if (d.min_happiness != null) parts.push(parts.length ? '+ Friendship' : 'Friendship');
      if (d.min_affection != null) parts.push(parts.length ? '+ Affection' : 'Affection');
      if (d.time_of_day) parts.push(`(${d.time_of_day})`);
      if (d.location?.name) parts.push(`at ${prettySlug(d.location.name)}`);
      if (d.held_item?.name) parts.push(`holding ${prettySlug(d.held_item.name)}`);
      if (d.known_move?.name) parts.push(`knowing ${prettySlug(d.known_move.name)}`);
      if (d.known_move_type?.name) parts.push(`with ${prettySlug(d.known_move_type.name)} move`);
      if (d.gender != null) parts.push(d.gender === 1 ? '(Female)' : '(Male)');
      if (!parts.length) parts.push('Level Up');
      break;
    case 'trade':
      parts.push('Trade');
      if (d.held_item?.name) parts.push(`w/ ${prettySlug(d.held_item.name)}`);
      if (d.trade_species?.name) parts.push(`for ${prettySlug(d.trade_species.name)}`);
      break;
    case 'use-item':
      parts.push(d.item?.name ? prettySlug(d.item.name) : 'Use Item');
      break;
    case 'shed': parts.push('Lv. 20+ w/ empty slot + extra Poké Ball'); break;
    case 'three-critical-hits': parts.push('3 Crits in one battle'); break;
    case 'take-damage': parts.push('Take damage'); break;
    case '': return null;
    default: parts.push(prettySlug(trigger));
  }
  return parts.join(' ');
}

function parseEncounters(arr) {
  // game id -> Set of location names
  const byGame = new Map();
  for (const entry of arr || []) {
    const loc = entry.location_area?.name;
    if (!loc) continue;
    for (const vd of entry.version_details || []) {
      const v = vd.version?.name;
      for (const [gameId, versions] of Object.entries(POKEAPI_VERSIONS)) {
        if (!versions.includes(v)) continue;
        if (!byGame.has(gameId)) byGame.set(gameId, new Set());
        byGame.get(gameId).add(prettySlug(loc));
      }
    }
  }
  return byGame;
}

// ---- Cry ------------------------------------------------------------------
function playCry(sp) {
  const base = SPECIES_BY_ID.get(sp.baseSpeciesId ?? sp.id) || sp;
  const slug = base.name.toLowerCase().replace(/[.' -]/g, '');
  new Audio(`https://play.pokemonshowdown.com/audio/cries/${slug}.mp3`).play().catch(() => {});
}

// ---- Sheet ------------------------------------------------------------------
const detailState = { id: null, expanded: new Set(), history: [] };

// push: opened from inside the sheet (evolution chain), so Back returns here.
// keepHistory: this is the Back step itself.
function openDetail(speciesId, { push = false, keepHistory = false } = {}) {
  if (push && detailState.id != null) detailState.history.push(detailState.id);
  else if (!keepHistory) detailState.history = [];
  detailState.id = speciesId;
  detailState.expanded = new Set();
  const dlg = $('#detail-dlg');
  renderDetail();
  if (!dlg.open) dlg.showModal();
  $('#detail-body').scrollTop = 0;
  const sp = SPECIES_BY_ID.get(speciesId);
  loadDetail(sp).then(() => { if (detailState.id === speciesId) renderDetailRemote(); })
    .catch(() => { if (detailState.id === speciesId) renderDetailRemote(); });
}

// The playthrough a game's pills act on: the one selected in the dex for that
// game, Main everywhere else.
const ptFor = (gameId) => (gameId === prefs.gameId ? prefs.playthroughId || '' : '');

function renderDetail() {
  const sp = SPECIES_BY_ID.get(detailState.id);
  if (!sp) return;
  const back = detailState.history.length
    ? `<button class="ghost back" data-act="back">‹ ${esc(speciesName(detailState.history[detailState.history.length - 1]))}</button>` : '';
  $('#detail-body').innerHTML = `
    <div class="detail-top">
      ${back}
      <button class="ghost close" data-act="close" aria-label="Close">✕</button>
    </div>
    <div class="detail-head">
      <div class="sprites">
        <figure><img alt="" src="${spriteURL(sp.id, false)}"><figcaption>Regular</figcaption></figure>
        <figure><img alt="" src="${spriteURL(sp.id, true)}"><figcaption>Shiny</figcaption></figure>
      </div>
      <h2>${esc(sp.name)} <button class="ghost cry" data-act="cry" aria-label="Play cry">🔊</button></h2>
      <div class="muted">${dexNum(sp)} · Gen ${sp.generation}</div>
      <div class="types">${sp.types.map(typeBadge).join('')}</div>
    </div>
    <section class="detail-sec"><h3>Your collection</h3><div id="detail-own"></div></section>
    <div id="detail-remote"></div>`;
  renderOwnership();
  renderDetailRemote();
}

function renderOwnership() {
  const sp = SPECIES_BY_ID.get(detailState.id);
  const el = $('#detail-own');
  if (!sp || !el) return;
  const index = catchIndex();
  const games = GAMES.filter((g) => g.species.includes(sp.id));
  if (!games.length) { el.innerHTML = '<p class="muted">Not in any tracked game\'s dex.</p>'; return; }
  el.innerHTML = games.map((g) => {
    const pt = ptFor(g.id);
    const reg = index.get(catchKey({ speciesId: sp.id, gameId: g.id, isShiny: false, playthroughId: pt }))?.[0];
    const shi = index.get(catchKey({ speciesId: sp.id, gameId: g.id, isShiny: true, playthroughId: pt }))?.[0];
    const open = detailState.expanded.has(g.id) && (reg || shi);
    const ptName = pt ? store.rows.get(pt)?.data.name : null;
    return `<div class="own ${shi ? 'has-shiny' : reg ? 'has-reg' : ''}" data-game="${g.id}">
      <div class="own-row">
        <span class="own-game">${esc(g.shortName)}${ptName ? ` <small>· ${esc(ptName)}</small>` : ''}</span>
        <button class="pill ${reg ? 'on' : ''}" data-act="own" data-shiny="0">${reg ? '✓' : '○'} Regular</button>
        <button class="pill shiny ${shi ? 'on' : ''}" data-act="own" data-shiny="1">${shi ? '✨' : '✧'} Shiny</button>
        ${reg || shi ? `<button class="ghost chev" data-act="expand" aria-label="Notes, tags, date">${open ? '▴' : '▾'}</button>` : '<span class="chev"></span>'}
      </div>
      ${open ? [reg && recordEditor(reg, 'Regular'), shi && recordEditor(shi, 'Shiny')].filter(Boolean).join('') : ''}
    </div>`;
  }).join('');
}

const tagsOf = (raw) => (raw || '').split(',').map((t) => t.trim()).filter(Boolean);

function recordEditor(row, label) {
  const d = row.data;
  const date = (d.caughtAt || '').slice(0, 10);
  return `<div class="rec-edit" data-rec="${esc(row.id)}">
    <div class="rec-line"><b>${label}</b><input type="date" data-field="caughtAt" value="${esc(date)}" aria-label="Catch date"></div>
    <textarea data-field="notes" rows="2" placeholder="Notes (e.g. Route 5, Quick Ball, lvl 12)">${esc(d.notes)}</textarea>
    <input data-field="tagsRaw" value="${esc(d.tagsRaw)}" placeholder="Tags, comma-separated (favorite, for-trade)">
    <div class="chips">${tagsOf(d.tagsRaw).map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>
  </div>`;
}

function renderDetailRemote() {
  const el = $('#detail-remote');
  const sp = SPECIES_BY_ID.get(detailState.id);
  if (!el || !sp) return;
  const p = detailCache.get(sp.id);
  if (!p) { el.innerHTML = ''; return; }
  el.innerHTML = '<p class="muted center">Loading Pokédex data…</p>';
  p.then((d) => {
    if (detailState.id !== sp.id) return;
    const anyCaught = new Set(live('catch').filter((r) => !r.data.isShiny).map((r) => r.data.speciesId));
    const tier = (v) => (v < 50 ? '#e5533d' : v < 80 ? '#f0913a' : v < 100 ? '#e8c22c' : v < 130 ? '#5bb85b' : '#2fa3a3');
    const total = d.stats.reduce((n, s) => n + s.value, 0);
    const stats = d.stats.map((s) => `<div class="stat"><span>${s.label}</span><b>${s.value}</b>` +
      `<i><u style="width:${Math.min(100, (s.value / 200) * 100)}%;background:${tier(s.value)}"></u></i></div>`).join('');
    const evo = d.evolution.length > 1 ? d.evolution.map((e, i) => {
      const esp = SPECIES_BY_ID.get(e.speciesId);
      const current = e.speciesId === (sp.baseSpeciesId ?? sp.id);
      const arrow = i > 0 ? `<span class="evo-arrow">→<small>${esc(e.trigger || '')}</small></span>` : '';
      return `${arrow}<button class="evo ${current ? 'current' : ''}" data-act="evo" data-id="${e.speciesId}" ${current ? 'disabled' : ''}>` +
        `<img alt="" loading="lazy" src="${spriteURL(e.speciesId, false)}"><span>${esc(esp?.name || '#' + e.speciesId)}</span>` +
        `<small class="${anyCaught.has(e.speciesId) ? 'yes' : ''}">${anyCaught.has(e.speciesId) ? '✓ caught' : '○ missing'}</small></button>`;
    }).join('') : '<p class="muted">Doesn\'t evolve.</p>';
    const enc = [...d.encounters.entries()]
      .sort((a, b) => GAMES.findIndex((g) => g.id === a[0]) - GAMES.findIndex((g) => g.id === b[0]))
      .map(([gid, locs]) => {
        const list = [...locs];
        const shown = list.slice(0, 6).map(esc).join(', ');
        return `<div class="enc"><b>${esc(GAMES.find((g) => g.id === gid)?.shortName || gid)}</b><span>${shown}${list.length > 6 ? ` +${list.length - 6} more` : ''}</span></div>`;
      }).join('') || '<p class="muted">No wild encounter data (often gifts, legendaries or newer games).</p>';
    el.innerHTML = `
      ${d.flavor ? `<section class="detail-sec"><p class="flavor">${esc(d.flavor)}</p></section>` : ''}
      <section class="detail-sec"><h3>Base stats <small class="muted">· total ${total}</small></h3>${stats}</section>
      <section class="detail-sec"><h3>Evolution</h3><div class="evo-row">${evo}</div></section>
      <section class="detail-sec"><h3>Where to find</h3>${enc}</section>`;
  }).catch(() => {
    if (detailState.id !== sp.id) return;
    el.innerHTML = '<p class="muted center">Couldn\'t load Pokédex data. <button class="ghost" data-act="retry">Retry</button></p>';
  });
}

function onDetailClick(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const sp = SPECIES_BY_ID.get(detailState.id);
  switch (btn.dataset.act) {
    case 'close': $('#detail-dlg').close(); break;
    case 'back': openDetail(detailState.history.pop(), { push: false, keepHistory: true }); break;
    case 'cry': playCry(sp); break;
    case 'evo': openDetail(Number(btn.dataset.id), { push: true }); break;
    case 'retry': detailCache.delete(sp.id); openDetail(sp.id); break;
    case 'expand': {
      const gid = btn.closest('[data-game]').dataset.game;
      if (detailState.expanded.has(gid)) detailState.expanded.delete(gid); else detailState.expanded.add(gid);
      renderOwnership();
      break;
    }
    case 'own': {
      const gid = btn.closest('[data-game]').dataset.game;
      toggleCatch(sp.id, gid, btn.dataset.shiny === '1', ptFor(gid) || null, catchIndex());
      renderOwnership();
      render();
      break;
    }
  }
}

function onDetailChange(e) {
  const field = e.target.dataset.field;
  const box = e.target.closest('[data-rec]');
  if (!field || !box) return;
  const row = store.rows.get(box.dataset.rec);
  if (!row || row.deleted) return;
  const d = { ...row.data };
  if (field === 'caughtAt') {
    if (!e.target.value) return;
    // Keep the original time of day; only the date changes.
    const time = (d.caughtAt || '').slice(10) || 'T12:00:00.000Z';
    d.caughtAt = e.target.value + time;
  } else if (field === 'tagsRaw') {
    d.tagsRaw = tagsOf(e.target.value).join(', ');
    e.target.value = d.tagsRaw;
    box.querySelector('.chips').innerHTML = tagsOf(d.tagsRaw).map((t) => `<span class="chip">${esc(t)}</span>`).join('');
  } else {
    d[field] = e.target.value;
  }
  write('catch', row.id, d);
  if (field === 'tagsRaw' && prefs.tab === 'dex') renderDex();
}

// Called after a sync pull. Re-render unless the user is typing in the sheet.
function refreshDetailIfOpen() {
  const dlg = $('#detail-dlg');
  if (!dlg.open) return;
  if (dlg.contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
  renderOwnership();
}
