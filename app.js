'use strict';

// ---------------------------------------------------------------------------
// Config. These Firebase values are public by design: the security rules in
// firestore.rules limit every request to the signed-in user's own records.
// ---------------------------------------------------------------------------
firebase.initializeApp({
  apiKey: 'AIzaSyBBYo2uN1nfQMBHMb_C_XXTSnex6tp99dE',
  authDomain: 'pokemon-tracker-8d5ac.firebaseapp.com',
  projectId: 'pokemon-tracker-8d5ac',
  storageBucket: 'pokemon-tracker-8d5ac.firebasestorage.app',
  messagingSenderId: '869525751786',
  appId: '1:869525751786:web:2ec719a2da6bc79d47d493',
});
const auth = firebase.auth();
const db = firebase.firestore();
const POLL_MS = 20000;
const PULL_OVERLAP_MS = 120000;
const CACHE_KEY = 'pt-cache-v2';   // v1 was the Supabase era
const PREFS_KEY = 'pt-prefs-v1';
try { localStorage.removeItem('pt-cache-v1'); } catch { /* ignore */ }

// Must match HuntMethod raw values in the Mac app.
const METHODS = ['Full Odds', 'Masuda Method', 'SOS Chain', 'Mass Outbreak',
  'Sparkling Power Sandwich', 'Dynamax Adventure', 'Chain Fishing', 'Other'];

const CHAIN_LABELS = { 'SOS Chain': 'SOS Chain', 'Mass Outbreak': 'KOs in Outbreak', 'Chain Fishing': 'Fishing Chain' };

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uuid = () => crypto.randomUUID().toUpperCase();
const nowISO = () => new Date().toISOString();

function readJSON(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}
function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked */ }
}

// ---------------------------------------------------------------------------
// Static data
// ---------------------------------------------------------------------------
let SPECIES = [];
let SPECIES_BY_ID = new Map();
let GAMES = [];
let BADGES = {};   // game id -> [{id, name, type, category}] (from the Mac app's GymData)
const BADGE_CATEGORIES = ['Gym', 'Trial', 'Kahuna', 'Titan', 'Team Star', 'Noble'];

// Official game logos in logos/{game}-{n}.webp (one per version of paired games).
const GAME_LOGOS = { home: 1, pogo: 1, gsc: 2, rse: 2, frlg: 2, dpp: 2, hgss: 2, bw: 2, b2w2: 2, xy: 2, oras: 2, sumo: 2, usum: 2, letsgo: 2, swsh: 2, bdsp: 2, legendsarceus: 1, sv: 2, legendsza: 1 };
const gameLogos = (gameId, cls = '') => Array.from({ length: GAME_LOGOS[gameId] || 0 },
  (_, i) => `<img class="${cls}" src="logos/${gameId}-${i}.webp" alt="" loading="lazy" decoding="async">`).join('');

// Best-odds suggestions for a new hunt (port of MethodRecommender.swift).
const METHODS_BY_GAME = {
  gsc: ['Full Odds'], rse: ['Full Odds'], frlg: ['Full Odds'],
  dpp: ['Full Odds', 'Masuda Method'], hgss: ['Full Odds', 'Masuda Method'],
  bw: ['Full Odds', 'Masuda Method'], b2w2: ['Full Odds', 'Masuda Method'],
  xy: ['Full Odds', 'Masuda Method', 'Chain Fishing'], oras: ['Full Odds', 'Masuda Method', 'Chain Fishing'],
  sumo: ['Full Odds', 'Masuda Method', 'SOS Chain'], usum: ['Full Odds', 'Masuda Method', 'SOS Chain'],
  letsgo: ['Full Odds'], swsh: ['Full Odds', 'Masuda Method', 'Mass Outbreak', 'Dynamax Adventure'],
  bdsp: ['Full Odds', 'Masuda Method'], legendsarceus: ['Full Odds', 'Mass Outbreak'],
  sv: ['Full Odds', 'Masuda Method', 'Mass Outbreak', 'Sparkling Power Sandwich'], legendsza: ['Full Odds'],
};
const CHARM_GAMES = new Set(['b2w2', 'xy', 'oras', 'sumo', 'usum', 'letsgo', 'swsh', 'bdsp', 'legendsarceus', 'sv', 'legendsza']);
const BEST_MODIFIERS = {
  'Sparkling Power Sandwich': { sandwichLevel: 3, label: 'Sparkling Power Lv. 3' },
  'SOS Chain': { chainCount: 31, label: 'Chain ≥ 31' },
  'Mass Outbreak': { chainCount: 60, label: '60 KOs' },
  'Chain Fishing': { chainCount: 20, label: 'Chain ≥ 20' },
};

function recommendMethods(speciesId, limit = 5) {
  const out = [];
  for (const g of GAMES) {
    if (!g.species.includes(speciesId)) continue;
    for (const method of METHODS_BY_GAME[g.id] || []) {
      const mods = BEST_MODIFIERS[method] || {};
      const charm = CHARM_GAMES.has(g.id);
      const odds = huntOdds({ method, shinyCharm: charm, sandwichLevel: mods.sandwichLevel || 0, chainCount: mods.chainCount || 0 });
      const parts = [charm && 'Shiny Charm', mods.label].filter(Boolean);
      out.push({ game: g, method, charm, mods, odds, summary: [method, ...parts].join(' · ') });
    }
  }
  return out.sort((a, b) => b.odds.rolls - a.odds.rolls || a.summary.localeCompare(b.summary)).slice(0, limit);
}

const spriteURL = (id, shiny) =>
  `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${shiny ? 'shiny/' : ''}${id}.png`;
const dexNum = (sp) => '#' + String(sp.baseSpeciesId ?? sp.id).padStart(4, '0');
const speciesName = (id) => SPECIES_BY_ID.get(id)?.name ?? `#${id}`;
const gameGroup = (g) => (g.releaseGen === 'cross' ? 'Cross-Game' : `Gen ${g.releaseGen}`);

// ---------------------------------------------------------------------------
// Sync store: every record is a row {id, kind, data, deleted, updated_at}.
// In Firestore each one is users/{uid}/records/{id} = {kind, json, deleted,
// updatedAt}, the same documents the Mac app reads and writes.
// updated_at here is "seconds.nanoseconds" so it compares as a string.
// Local writes go into `pending` and are flushed in the background; pulls
// skip rows with unsent local edits so a tap is never overwritten.
// ---------------------------------------------------------------------------
const store = {
  userId: null,
  rows: new Map(),
  pending: new Map(),
  cursor: null,
  status: 'idle',      // idle | busy | error
  error: '',
  lastSync: null,
};

function loadCache(userId) {
  const c = readJSON(CACHE_KEY);
  store.rows = new Map();
  store.pending = new Map();
  store.cursor = null;
  if (!c || c.userId !== userId) return;
  for (const r of c.rows || []) store.rows.set(r.id, r);
  for (const r of c.pending || []) store.pending.set(r.id, r);
  store.cursor = c.cursor || null;
}

function saveCache() {
  writeJSON(CACHE_KEY, {
    userId: store.userId,
    cursor: store.cursor,
    rows: [...store.rows.values()],
    pending: [...store.pending.values()],
  });
}

const recordsRef = () => db.collection('users').doc(store.userId).collection('records');
const stamp = (ts) => `${ts.seconds}.${String(ts.nanoseconds).padStart(9, '0')}`;

async function pull() {
  const pageSize = 1000;
  let changed = false;
  let newest = store.cursor;
  let last = null;
  for (;;) {
    let q = recordsRef();
    if (store.cursor) {
      const since = Number(store.cursor.split('.')[0]) * 1000 - PULL_OVERLAP_MS;
      q = q.where('updatedAt', '>', firebase.firestore.Timestamp.fromMillis(since));
    }
    q = q.orderBy('updatedAt').orderBy(firebase.firestore.FieldPath.documentId()).limit(pageSize);
    if (last) q = q.startAfter(last);
    const snap = await q.get({ source: 'server' });
    for (const doc of snap.docs) {
      const f = doc.data();
      if (!f.updatedAt) continue;
      const updated = stamp(f.updatedAt);
      if (!newest || updated > newest) newest = updated;
      if (store.pending.has(doc.id)) continue;
      const cur = store.rows.get(doc.id);
      if (cur && cur.updated_at === updated) continue;
      let data;
      try { data = JSON.parse(f.json); } catch { continue; }
      store.rows.set(doc.id, { id: doc.id, kind: f.kind, data, deleted: !!f.deleted, updated_at: updated });
      changed = true;
    }
    if (snap.size < pageSize) break;
    last = snap.docs[snap.docs.length - 1];
  }
  store.cursor = newest;
  return changed;
}

let flushTimer = null;
let flushing = false;
function scheduleFlush(delay = 600) {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, delay);
}

async function flush() {
  if (flushing || !store.pending.size || !store.userId) return;
  flushing = true;
  const batch = [...store.pending.values()];
  setStatus('busy');
  try {
    for (let i = 0; i < batch.length; i += 500) {
      const wb = db.batch();
      for (const r of batch.slice(i, i + 500)) {
        wb.set(recordsRef().doc(r.id), {
          kind: r.kind,
          json: JSON.stringify(r.data),
          deleted: r.deleted,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      }
      await wb.commit();
    }
  } catch (e) {
    flushing = false;
    setStatus('error', describeError(e));
    scheduleFlush(10000);
    return;
  }
  flushing = false;
  // Only clear entries that weren't edited again while the request was in flight.
  for (const r of batch) if (store.pending.get(r.id) === r) store.pending.delete(r.id);
  saveCache();
  if (store.pending.size) scheduleFlush(0);
  else syncNow();
}

let syncing = false;
async function syncNow() {
  if (syncing || !store.userId) return;
  syncing = true;
  setStatus('busy');
  try {
    if (store.pending.size) await flush();
    const changed = await pull();
    saveCache();
    store.lastSync = new Date();
    setStatus('idle');
    if (changed) render();
  } catch (e) {
    setStatus('error', describeError(e));
  } finally {
    syncing = false;
  }
}

function describeError(e) {
  if (!navigator.onLine) return 'Offline — changes are saved on this device and will sync when you reconnect.';
  const msg = e?.message || String(e);
  if (/unavailable|network|offline|Failed to get/i.test(msg)) return "Can't reach the sync server. Changes are saved on this device and will sync once it's reachable.";
  return msg;
}

function setStatus(status, error = '') {
  store.status = status;
  store.error = error;
  const dot = $('#sync-dot');
  dot.className = 'dot' + (status === 'busy' ? ' busy' : status === 'error' ? ' err' : '');
  if ($('#account-dlg').open) renderAccount();
}

function write(kind, id, data, deleted = false) {
  const row = { id, kind, data, deleted };
  const prev = store.rows.get(id);
  store.rows.set(id, { ...row, updated_at: prev?.updated_at ?? '' });
  store.pending.set(id, row);
  saveCache();
  scheduleFlush();
}

const live = (kind) => [...store.rows.values()].filter((r) => r.kind === kind && !r.deleted);

// ---------------------------------------------------------------------------
// Derived data
// ---------------------------------------------------------------------------
const catchKey = (d) => `${d.speciesId}|${d.gameId}|${d.isShiny ? 1 : 0}|${d.playthroughId || ''}`;

function catchIndex() {
  const byKey = new Map();
  for (const r of live('catch')) {
    const k = catchKey(r.data);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(r);
  }
  return byKey;
}

function toggleCatch(speciesId, gameId, isShiny, playthroughId, index) {
  const key = catchKey({ speciesId, gameId, isShiny, playthroughId });
  const existing = index.get(key);
  if (existing?.length) {
    for (const r of existing) write('catch', r.id, r.data, true);
    return false;
  }
  write('catch', uuid(), {
    speciesId, gameId, isShiny, playthroughId: playthroughId || null,
    notes: '', tagsRaw: '', caughtAt: nowISO(),
  });
  return true;
}

// Port of OddsCalculator.swift.
function huntOdds(h) {
  let rolls = 1;
  switch (h.method) {
    case 'Masuda Method': rolls = 6; break;
    case 'SOS Chain':
      if (h.chainCount >= 31) rolls += 12;
      else if (h.chainCount >= 21) rolls += 8;
      else if (h.chainCount >= 11) rolls += 4;
      break;
    case 'Mass Outbreak':
      if (h.chainCount >= 60) rolls += 3;
      else if (h.chainCount >= 30) rolls += 2;
      else if (h.chainCount >= 1) rolls += 1;
      break;
    case 'Sparkling Power Sandwich': rolls += Math.max(0, Math.min(3, h.sandwichLevel || 0)); break;
    case 'Dynamax Adventure': rolls = 13; break;
    case 'Chain Fishing': rolls = 1 + 2 * Math.max(0, Math.min(20, h.chainCount || 0)); break;
  }
  if (h.shinyCharm) rolls += 2;
  const p = rolls / 4096;
  const cumulative = 1 - Math.pow(1 - p, Math.max(0, h.encounters || 0));
  return { rolls, oneIn: Math.round(1 / p), cumulative };
}

// ---------------------------------------------------------------------------
// UI state
// ---------------------------------------------------------------------------
const prefs = Object.assign({
  tab: 'dex', gameId: 'home', playthroughId: '', mode: 'regular',
  gen: 'all', type: 'all', status: 'all', tag: 'all', lastCaughtGame: 'sv',
  reviewYear: null, badgesOpen: true,
}, readJSON(PREFS_KEY) || {});
const savePrefs = () => writeJSON(PREFS_KEY, prefs);
let search = '';

function render() {
  if (!store.userId) return;
  if (prefs.tab === 'dex') renderDex();
  else if (prefs.tab === 'hunts') renderHunts();
  else if (prefs.tab === 'timeline') renderTimeline();
  else renderStats();
  refreshDetailIfOpen();
}

// ---- Tabs -----------------------------------------------------------------
const TITLES = { dex: 'Living Dex', hunts: 'Shiny Hunts', timeline: 'Timeline', stats: 'Stats' };
const TABS = Object.keys(TITLES);
function showTab(tab) {
  prefs.tab = tab;
  savePrefs();
  if (!TABS.includes(tab)) tab = prefs.tab = 'dex';
  if (tab === 'timeline') timelineShown = TIMELINE_PAGE;
  for (const t of TABS) $(`#tab-${t}`).hidden = t !== tab;
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  $('#title').textContent = TITLES[tab];
  render();
  window.scrollTo(0, 0);
}

// ---- Dex ------------------------------------------------------------------
function currentGame() {
  return GAMES.find((g) => g.id === prefs.gameId) || GAMES[0];
}

function renderGameButton() {
  const game = currentGame();
  $('#game-btn').innerHTML = `<span class="game-logos">${gameLogos(game.id)}</span>` +
    `<span class="game-name">${esc(game.name)}</span><span class="caret">▾</span>`;
  $('#game-btn').setAttribute('aria-label', `Game: ${game.name}. Change game`);
}

function openGamePicker() {
  // Progress counts distinct species caught (regular) in each game, any playthrough.
  const caughtBy = new Map();
  for (const r of live('catch')) {
    if (r.data.isShiny) continue;
    if (!caughtBy.has(r.data.gameId)) caughtBy.set(r.data.gameId, new Set());
    caughtBy.get(r.data.gameId).add(r.data.speciesId);
  }
  const groups = [];
  for (const g of GAMES) {
    const label = gameGroup(g);
    let grp = groups.find((x) => x.label === label);
    if (!grp) groups.push(grp = { label, games: [] });
    grp.games.push(g);
  }
  $('#game-grid').innerHTML = groups.map((grp) => `<h3 class="game-group">${grp.label}</h3><div class="game-tiles">` +
    grp.games.map((g) => {
      const dex = new Set(g.species);
      const n = [...(caughtBy.get(g.id) || [])].filter((id) => dex.has(id)).length;
      const pct = g.species.length ? (n / g.species.length) * 100 : 0;
      return `<button class="game-tile ${g.id === prefs.gameId ? 'on' : ''}" data-game="${g.id}">` +
        `<span class="tile-logos n${GAME_LOGOS[g.id] || 0}">${gameLogos(g.id)}</span>` +
        `<span class="tile-name">${esc(g.name)}</span>` +
        `<span class="tile-progress">${n} / ${g.species.length}</span><span class="bar"><i style="width:${pct.toFixed(1)}%"></i></span></button>`;
    }).join('') + '</div>').join('');
  $('#game-dlg').showModal();
  $('#game-grid .game-tile.on')?.scrollIntoView({ block: 'center' });
}

function renderDexControls() {
  const game = currentGame();
  renderGameButton();

  const pts = live('playthrough').filter((r) => r.data.gameId === game.id)
    .sort((a, b) => a.data.createdAt.localeCompare(b.data.createdAt));
  if (prefs.playthroughId && !pts.some((r) => r.id === prefs.playthroughId)) prefs.playthroughId = '';
  $('#pt-select').innerHTML = '<option value="">Main</option>' +
    pts.map((r) => `<option value="${esc(r.id)}">${esc(r.data.name)}</option>`).join('') +
    '<option value="__new">＋ New playthrough…</option>';
  $('#pt-select').value = prefs.playthroughId;

  const dexSpecies = game.species.map((id) => SPECIES_BY_ID.get(id)).filter(Boolean);
  const gens = [...new Set(dexSpecies.map((s) => s.generation))].sort((a, b) => a - b);
  const types = [...new Set(dexSpecies.flatMap((s) => s.types))].sort();
  if (prefs.gen !== 'all' && !gens.includes(Number(prefs.gen))) prefs.gen = 'all';
  if (prefs.type !== 'all' && !types.includes(prefs.type)) prefs.type = 'all';
  $('#gen-filter').innerHTML = '<option value="all">All gens</option>' +
    gens.map((g) => `<option value="${g}">Gen ${g}</option>`).join('');
  $('#gen-filter').value = String(prefs.gen);
  $('#type-filter').innerHTML = '<option value="all">All types</option>' +
    types.map((t) => `<option value="${t}">${t[0].toUpperCase() + t.slice(1)}</option>`).join('');
  $('#type-filter').value = prefs.type;
  $('#status-filter').value = prefs.status;
  document.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === prefs.mode));

  // Tag filter: only shown when records in this game + playthrough carry tags.
  const pt = prefs.playthroughId || '';
  const tags = [...new Set(live('catch')
    .filter((r) => r.data.gameId === game.id && (r.data.playthroughId || '') === pt)
    .flatMap((r) => tagsOf(r.data.tagsRaw)))].sort();
  if (prefs.tag !== 'all' && !tags.includes(prefs.tag)) prefs.tag = 'all';
  $('#tag-filter').hidden = !tags.length;
  $('#tag-filter').innerHTML = '<option value="all">Any tag</option>' +
    tags.map((t) => `<option value="${esc(t)}">#${esc(t)}</option>`).join('');
  $('#tag-filter').value = prefs.tag;
}

// Gym badges / trials / titans for the selected game + playthrough.
function renderBadges() {
  const game = currentGame();
  const list = BADGES[game.id] || [];
  const el = $('#badge-strip');
  el.hidden = !list.length;
  if (!list.length) return;
  const pt = prefs.playthroughId || '';
  const earned = new Set(live('badge').filter((r) => r.data.gameId === game.id && (r.data.playthroughId || '') === pt)
    .map((r) => r.data.badgeId));
  const count = list.filter((b) => earned.has(b.id)).length;
  const groups = BADGE_CATEGORIES.map((cat) => [cat, list.filter((b) => (b.category || 'Gym') === cat)]).filter(([, l]) => l.length);
  el.innerHTML = `<details ${prefs.badgesOpen ? 'open' : ''}><summary>Badges <span class="muted">${count} / ${list.length}</span></summary>` +
    groups.map(([cat, l]) => `<div class="badge-group">${groups.length > 1 ? `<span class="badge-cat">${cat}</span>` : ''}` +
      l.map((b) => {
        const on = earned.has(b.id);
        return `<button class="gym ${on ? 'on' : ''}" data-badge="${esc(b.id)}" aria-pressed="${on}"` +
          `${on ? ` style="background:${TYPE_COLORS[b.type] || '#888'}"` : ''} title="${esc(b.name)} (${b.type})">${esc(b.name)}</button>`;
      }).join('') + '</div>').join('') + '</details>';
}

function toggleBadge(badgeId) {
  const game = currentGame();
  const pt = prefs.playthroughId || null;
  const matches = live('badge').filter((r) => r.data.gameId === game.id && (r.data.playthroughId || null) === pt && r.data.badgeId === badgeId);
  if (matches.length) for (const r of matches) write('badge', r.id, r.data, true);
  else write('badge', uuid(), { gameId: game.id, playthroughId: pt, badgeId, earnedAt: nowISO() });
  renderBadges();
}

function renderDex() {
  renderDexControls();
  renderBadges();
  const game = currentGame();
  const pt = prefs.playthroughId || '';
  const index = catchIndex();
  const has = (id, shiny) => index.has(catchKey({ speciesId: id, gameId: game.id, isShiny: shiny, playthroughId: pt }));

  const dexSpecies = game.species.map((id) => SPECIES_BY_ID.get(id)).filter(Boolean);
  const caughtCount = dexSpecies.filter((s) => has(s.id, false)).length;
  const shinyCount = dexSpecies.filter((s) => has(s.id, true)).length;
  const pct = dexSpecies.length ? Math.round((caughtCount / dexSpecies.length) * 100) : 0;
  $('#dex-progress').innerHTML =
    `${caughtCount} / ${dexSpecies.length} caught (${pct}%) · ${shinyCount} shiny` +
    `<div class="bar"><i style="width:${pct}%"></i></div>`;

  const q = search.trim().toLowerCase();
  const target = prefs.mode === 'shiny';
  // Notes/tags per species for this game + playthrough.
  const recs = new Map();
  for (const r of live('catch')) {
    const d = r.data;
    if (d.gameId !== game.id || (d.playthroughId || '') !== pt) continue;
    const cur = recs.get(d.speciesId) || { notes: false, tags: [] };
    cur.notes = cur.notes || !!(d.notes || '').trim();
    cur.tags.push(...tagsOf(d.tagsRaw));
    recs.set(d.speciesId, cur);
  }
  const list = dexSpecies.filter((s) => {
    if (prefs.gen !== 'all' && s.generation !== Number(prefs.gen)) return false;
    if (prefs.type !== 'all' && !s.types.includes(prefs.type)) return false;
    if (prefs.tag !== 'all' && !recs.get(s.id)?.tags.includes(prefs.tag)) return false;
    if (prefs.status !== 'all') {
      const owned = has(s.id, target);
      if (prefs.status === 'caught' ? !owned : owned) return false;
    }
    if (q && !s.name.toLowerCase().includes(q) && !dexNum(s).includes(q.replace(/^#/, ''))) return false;
    return true;
  });

  $('#dex-grid').innerHTML = list.length ? list.map((s) => {
    const caught = has(s.id, false);
    const shiny = has(s.id, true);
    const cls = ['cell', caught && 'caught', shiny && 'shiny'].filter(Boolean).join(' ');
    return `<button class="${cls}" data-id="${s.id}" aria-pressed="${target ? shiny : caught}">` +
      `${shiny ? '<span class="badge">✨</span>' : ''}` +
      `${recs.get(s.id)?.notes ? '<span class="note-dot" title="Has notes">📝</span>' : ''}` +
      `<img loading="lazy" alt="" draggable="false" src="${spriteURL(s.id, shiny)}">` +
      `<span class="num">${dexNum(s)}</span><span class="name">${esc(s.name)}</span></button>`;
  }).join('') : '<p class="empty">Nothing matches these filters.</p>';
}

// Long-press (touch) or right-click (mouse) on a cell opens its detail sheet.
let pressTimer = null;
let pressStart = null;
let suppressClick = false;
function onDexPointerDown(e) {
  const cell = e.target.closest('.cell');
  if (!cell || e.button > 0) return;
  pressStart = { x: e.clientX, y: e.clientY };
  clearTimeout(pressTimer);
  pressTimer = setTimeout(() => {
    suppressClick = true;
    openDetail(Number(cell.dataset.id));
  }, 450);
}
function onDexPointerMove(e) {
  if (pressStart && Math.hypot(e.clientX - pressStart.x, e.clientY - pressStart.y) > 10) cancelPress();
}
function cancelPress() { clearTimeout(pressTimer); pressStart = null; }

function onDexTap(e) {
  const cell = e.target.closest('.cell');
  if (!cell) return;
  if (suppressClick) { suppressClick = false; return; }
  const id = Number(cell.dataset.id);
  if (prefs.mode === 'info') { openDetail(id); return; }
  const added = toggleCatch(id, currentGame().id, prefs.mode === 'shiny', prefs.playthroughId || null, catchIndex());
  renderDex();
  if (added) {
    const fresh = $(`#dex-grid .cell[data-id="${id}"]`);
    fresh?.classList.add('pop');
  }
}

// ---- Hunts ----------------------------------------------------------------
function renderHunts() {
  const hunts = live('hunt');
  const phases = live('phase');
  const active = hunts.filter((h) => !h.data.completedAt && !h.data.abandonedAt)
    .sort((a, b) => b.data.startedAt.localeCompare(a.data.startedAt));
  const done = hunts.filter((h) => h.data.completedAt)
    .sort((a, b) => b.data.completedAt.localeCompare(a.data.completedAt));
  const abandoned = hunts.filter((h) => !h.data.completedAt && h.data.abandonedAt);

  const card = (h) => {
    const d = h.data;
    const odds = huntOdds(d);
    const myPhases = phases.filter((p) => p.data.huntId === h.id)
      .sort((a, b) => b.data.endedAt.localeCompare(a.data.endedAt));
    const nPhases = myPhases.length;
    const sincePhase = nPhases ? (d.encounters || 0) - Math.max(...myPhases.map((p) => p.data.encountersAtPhase || 0)) : null;
    return `<article class="hunt" data-id="${esc(h.id)}">
      <div class="hunt-head">
        <img alt="" src="${spriteURL(d.speciesId, true)}">
        <div class="meta">
          <h3>${esc(speciesName(d.speciesId))}</h3>
          <div class="sub">${esc(d.method)}${d.shinyCharm ? ' · Shiny Charm' : ''}${nPhases ? ` · ${nPhases} phase${nPhases > 1 ? 's' : ''}` : ''}</div>
        </div>
      </div>
      <div class="counter">
        <button class="minus" data-act="minus" aria-label="Minus one">−</button>
        <button class="count" data-act="set" aria-label="Set encounters">${(d.encounters || 0).toLocaleString()}</button>
        <span style="width:56px"></span>
      </div>
      <button class="plus" data-act="plus">+1</button>
      ${modifierRow(d)}
      <div class="odds">1/${odds.oneIn.toLocaleString()} odds · ${(odds.cumulative * 100).toFixed(1)}% chance of a shiny by now` +
      `${sincePhase != null ? ` · ${sincePhase.toLocaleString()} since last phase` : ''}</div>
      ${d.notes ? `<p class="hunt-notes">${esc(d.notes)}</p>` : ''}
      <div class="hunt-actions">
        <button class="caught-btn" data-act="caught">✨ Caught it!</button>
        <button data-act="phase">Phase</button>
        <button data-act="notes">Notes</button>
        <button data-act="charm">${d.shinyCharm ? '− Charm' : '+ Charm'}</button>
        <button data-act="abandon">Abandon</button>
      </div>
      ${nPhases ? `<details class="phases"><summary>Phases (${nPhases})</summary>${myPhases.map(phaseRow).join('')}</details>` : ''}
    </article>`;
  };

  const phaseRow = (p) => `<div class="phase" data-phase="${esc(p.id)}">
      <img alt="" loading="lazy" src="${spriteURL(p.data.speciesId, true)}">
      <div class="meta"><b>${esc(speciesName(p.data.speciesId))}</b>
        <small>at encounter ${(p.data.encountersAtPhase || 0).toLocaleString()} · ${new Date(p.data.endedAt).toLocaleDateString()}</small>
        ${p.data.notes ? `<small>${esc(p.data.notes)}</small>` : ''}</div>
      <button class="ghost" data-act="del-phase" aria-label="Delete phase">✕</button>
    </div>`;

  // Same method-specific modifiers the Mac's HuntDetailView exposes.
  const modifierRow = (d) => {
    let label, value;
    if (d.method === 'Sparkling Power Sandwich') { label = 'Sparkling Power Lv'; value = d.sandwichLevel || 0; }
    else if (CHAIN_LABELS[d.method]) { label = CHAIN_LABELS[d.method]; value = d.chainCount || 0; }
    else return '';
    return `<div class="modifier"><span>${label}</span>` +
      `<button data-act="mod-minus" aria-label="Decrease">−</button><b>${value}</b>` +
      `<button data-act="mod-plus" aria-label="Increase">+</button></div>`;
  };

  const mini = (h, button) => `<div class="mini" data-id="${esc(h.id)}">
      <img alt="" src="${spriteURL(h.data.speciesId, true)}">
      <div class="meta">${esc(speciesName(h.data.speciesId))}
        <small>${(h.data.encounters || 0).toLocaleString()} encounters · ${esc(h.data.method)}</small></div>
      ${button}
    </div>`;

  $('#hunt-list').innerHTML =
    (active.length ? active.map(card).join('') : '<p class="empty">No active hunts. Start one above.</p>') +
    (done.length ? `<details class="archive"><summary>Caught (${done.length})</summary>${done.map((h) => mini(h, '')).join('')}</details>` : '') +
    (abandoned.length ? `<details class="archive"><summary>Abandoned (${abandoned.length})</summary>${abandoned.map((h) => mini(h, '<button data-act="resurrect">Resurrect</button>')).join('')}</details>` : '');
}

let countHuntId = null;
let caughtHuntId = null;
let phaseHuntId = null;
let notesHuntId = null;

function onHuntTap(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const id = btn.closest('article[data-id], .mini[data-id]').dataset.id;
  const row = store.rows.get(id);
  if (!row) return;
  const d = { ...row.data };
  switch (btn.dataset.act) {
    case 'plus': d.encounters = (d.encounters || 0) + 1; break;
    case 'minus': d.encounters = Math.max(0, (d.encounters || 0) - 1); break;
    case 'charm': d.shinyCharm = !d.shinyCharm; break;
    case 'mod-minus':
    case 'mod-plus': {
      const step = btn.dataset.act === 'mod-plus' ? 1 : -1;
      if (d.method === 'Sparkling Power Sandwich') d.sandwichLevel = Math.max(0, Math.min(3, (d.sandwichLevel || 0) + step));
      else d.chainCount = Math.max(0, (d.chainCount || 0) + step);
      break;
    }
    case 'abandon':
      if (!confirm(`Abandon the ${speciesName(d.speciesId)} hunt? You can resurrect it later.`)) return;
      d.abandonedAt = nowISO();
      break;
    case 'resurrect': d.abandonedAt = null; break;
    case 'set':
      countHuntId = id;
      $('#count-input').value = d.encounters || 0;
      $('#count-dlg').showModal();
      $('#count-input').select();
      return;
    case 'phase':
      phaseHuntId = id;
      phasePicker.reset();
      $('#phase-notes').value = '';
      $('#phase-sub').textContent = `Log a non-target shiny found during your ${speciesName(d.speciesId)} hunt. It's recorded at encounter ${(d.encounters || 0).toLocaleString()}; the count keeps running.`;
      $('#phase-dlg').showModal();
      return;
    case 'del-phase': {
      const pid = btn.closest('[data-phase]').dataset.phase;
      const prow = store.rows.get(pid);
      if (prow && confirm(`Delete the ${speciesName(prow.data.speciesId)} phase?`)) {
        write('phase', pid, prow.data, true);
        renderHunts();
      }
      return;
    }
    case 'notes':
      notesHuntId = id;
      $('#notes-input').value = d.notes || '';
      $('#notes-dlg').showModal();
      return;
    case 'caught':
      caughtHuntId = id;
      $('#caught-name').textContent = `${speciesName(d.speciesId)} after ${(d.encounters || 0).toLocaleString()} encounters`;
      $('#caught-game').value = prefs.lastCaughtGame;
      $('#caught-dlg').showModal();
      return;
  }
  write('hunt', id, d);
  renderHunts();
}

// Species search box + result list, used by the New Hunt and Phase dialogs.
function makeSpeciesPicker(input, results, onPick = () => {}) {
  const picker = {
    picked: null,
    reset() { picker.picked = null; input.value = ''; results.innerHTML = ''; onPick(null); },
    render() {
      const q = input.value.trim().toLowerCase();
      if (!q || (picker.picked && speciesName(picker.picked).toLowerCase() === q)) { results.innerHTML = ''; return; }
      const matches = SPECIES.filter((s) => s.name.toLowerCase().includes(q) || String(s.id) === q).slice(0, 20);
      results.innerHTML = matches.map((s) =>
        `<button type="button" data-id="${s.id}" class="${s.id === picker.picked ? 'on' : ''}">` +
        `<img alt="" loading="lazy" src="${spriteURL(s.id, true)}">${esc(s.name)} <span class="muted">${dexNum(s)}</span></button>`).join('')
        || '<p class="muted">No Pokémon by that name.</p>';
    },
    // Accept an exact typed name even if no result was tapped.
    resolve() {
      if (picker.picked) return picker.picked;
      const exact = SPECIES.find((s) => s.name.toLowerCase() === input.value.trim().toLowerCase());
      return exact ? exact.id : null;
    },
  };
  input.addEventListener('input', () => { picker.picked = null; onPick(null); picker.render(); });
  results.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-id]');
    if (!b) return;
    picker.picked = Number(b.dataset.id);
    input.value = speciesName(picker.picked);
    picker.render();
    onPick(picker.picked);
  });
  return picker;
}

let huntPicker = null;
let phasePicker = null;
let huntMods = {};   // sandwich/chain values from a tapped recommendation

function renderRecommendations(speciesId) {
  const el = $('#hunt-recs');
  huntMods = {};
  if (!speciesId) { el.innerHTML = ''; return; }
  const recs = recommendMethods(speciesId);
  el.innerHTML = recs.length
    ? `<p class="muted">Best odds for ${esc(speciesName(speciesId))} — tap one to use it:</p>` + recs.map((r, i) =>
      `<button type="button" class="rec" data-rec="${i}"><b>${esc(r.game.shortName)}</b>` +
      `<span>${esc(r.summary)}</span><em>1/${r.odds.oneIn.toLocaleString()}</em></button>`).join('')
    : `<p class="muted">${esc(speciesName(speciesId))} can't be shiny hunted in the tracked mainline games.</p>`;
  el.onclick = (e) => {
    const b = e.target.closest('[data-rec]');
    if (!b) return;
    const r = recs[Number(b.dataset.rec)];
    $('#hunt-method').value = r.method;
    $('#hunt-charm').checked = r.charm;
    huntMods = { sandwichLevel: r.mods.sandwichLevel || 0, chainCount: r.mods.chainCount || 0 };
    el.querySelectorAll('.rec').forEach((x) => x.classList.toggle('on', x === b));
  };
}

// ---- Stats ----------------------------------------------------------------
function renderStats() {
  const catches = live('catch').map((r) => r.data);
  const regular = catches.filter((c) => !c.isShiny);
  const shiny = catches.filter((c) => c.isShiny);
  const hunts = live('hunt').map((r) => r.data);
  const doneHunts = hunts.filter((h) => h.completedAt);
  const activeHunts = hunts.filter((h) => !h.completedAt && !h.abandonedAt);
  const avg = doneHunts.length
    ? Math.round(doneHunts.reduce((n, h) => n + (h.encounters || 0), 0) / doneHunts.length) : 0;

  const tile = (n, label) => `<div class="tile"><b>${n.toLocaleString()}</b><span>${label}</span></div>`;
  const byGame = new Map();
  for (const c of regular) {
    if (!byGame.has(c.gameId)) byGame.set(c.gameId, new Set());
    byGame.get(c.gameId).add(c.speciesId);
  }
  const rows = GAMES.map((g) => {
    const dex = new Set(g.species);
    const caught = [...(byGame.get(g.id) || [])].filter((id) => dex.has(id)).length;
    const pct = g.species.length ? (caught / g.species.length) * 100 : 0;
    return `<div class="game-row"><div class="line"><span>${esc(g.name)}</span>` +
      `<span>${caught} / ${g.species.length}</span></div>` +
      `<div class="bar"><i style="width:${pct.toFixed(1)}%"></i></div></div>`;
  }).join('');

  $('#stats').innerHTML = `<div class="tiles">
      ${tile(new Set(regular.map((c) => c.speciesId)).size, 'unique species caught')}
      ${tile(new Set(shiny.map((c) => c.speciesId)).size, 'unique shinies')}
      ${tile(catches.length, 'catch records')}
      ${tile(activeHunts.length, 'active hunts')}
      ${tile(doneHunts.length, 'shinies from hunts')}
      ${tile(avg, 'avg encounters per shiny')}
    </div>
    <div class="card"><h2>Progress by game</h2>${rows}</div>`;
}

// ---- Account --------------------------------------------------------------
function renderAccount() {
  $('#account-email').textContent = `Signed in as ${store.email || ''}`;
  let s;
  if (store.status === 'error') s = store.error;
  else if (store.status === 'busy') s = 'Syncing…';
  else s = store.lastSync ? `Up to date · last synced ${store.lastSync.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Waiting to sync…';
  if (store.pending.size) s += ` · ${store.pending.size} change${store.pending.size > 1 ? 's' : ''} waiting to upload`;
  $('#account-status').textContent = s;
  // A Google-only account has no password, which the Mac app needs.
  const user = auth.currentUser;
  $('#mac-password-box').hidden = !user;
  if (!user) return;
  const hasPassword = user.providerData.some((p) => p.providerId === 'password');
  $('#mac-password-title').textContent = hasPassword ? 'Change Mac password.' : 'Set Mac password.';
  $('#mac-password-hint').textContent = hasPassword
    ? 'The Mac app signs in with this email and password. Set a new one here if you need to.'
    : 'You signed in with Google; the Mac app signs in with email and password. Add a password to this same account:';
  $('#mac-username').value = user.email || '';
}

// Adds a password to a Google-only account, or replaces the existing one.
// Changing a password needs a recent sign-in; for Google accounts we redo the
// Google popup and try once more.
async function saveMacPassword(pw) {
  const user = auth.currentUser;
  const hasPassword = user.providerData.some((p) => p.providerId === 'password');
  const attempt = async () => {
    if (!hasPassword) {
      try {
        await user.linkWithCredential(firebase.auth.EmailAuthProvider.credential(user.email, pw));
        return;
      } catch (err) {
        if (err.code !== 'auth/provider-already-linked' && err.code !== 'auth/credential-already-in-use') throw err;
      }
    }
    await user.updatePassword(pw);
  };
  try {
    await attempt();
  } catch (err) {
    const google = user.providerData.some((p) => p.providerId === 'google.com');
    if (err.code !== 'auth/requires-recent-login' || !google) throw err;
    await user.reauthenticateWithPopup(new firebase.auth.GoogleAuthProvider());
    await attempt();
  }
  await user.reload();
}

function authMessage(err) {
  switch (err?.code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found': return 'Wrong email or password.';
    case 'auth/email-already-in-use': return 'That email already has an account. Sign in instead (or use Continue with Google if you made it that way).';
    case 'auth/weak-password': return 'Password must be at least 6 characters.';
    case 'auth/invalid-email': return "That doesn't look like an email address.";
    case 'auth/too-many-requests': return 'Too many attempts. Try again in a few minutes.';
    case 'auth/requires-recent-login': return 'For security, sign out and back in, then try again.';
    case 'auth/popup-blocked': return 'The Google sign-in window was blocked. Allow pop-ups for this site, or use email and password.';
    case 'auth/credential-already-in-use':
    case 'auth/provider-already-linked': return 'This account already has a password.';
    default: return err?.message || String(err);
  }
}

// ---------------------------------------------------------------------------
// Auth + boot
// ---------------------------------------------------------------------------
let pollTimer = null;

function enterApp(user) {
  store.userId = user.uid;
  store.email = user.email;
  loadCache(store.userId);
  $('#auth').hidden = true;
  $('#app').hidden = false;
  showTab(prefs.tab);
  syncNow();
  clearInterval(pollTimer);
  pollTimer = setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, POLL_MS);
}

function leaveApp() {
  store.userId = null;
  clearInterval(pollTimer);
  $('#app').hidden = true;
  $('#auth').hidden = false;
}

function wireEvents() {
  // Auth form
  let authMode = 'signin';
  document.querySelectorAll('#auth-form button').forEach((b) =>
    b.addEventListener('click', () => { authMode = b.dataset.mode; }));
  $('#auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#auth-email').value.trim();
    const password = $('#auth-password').value;
    const msg = $('#auth-msg');
    msg.textContent = '';
    try {
      if (authMode === 'signup') await auth.createUserWithEmailAndPassword(email, password);
      else await auth.signInWithEmailAndPassword(email, password);
    } catch (err) {
      msg.textContent = authMessage(err);
    }
  });
  $('#google-signin').addEventListener('click', async () => {
    $('#auth-msg').textContent = '';
    try {
      await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user') $('#auth-msg').textContent = authMessage(err);
    }
  });

  // Tabs
  document.querySelectorAll('.tabbar button').forEach((b) =>
    b.addEventListener('click', () => showTab(b.dataset.tab)));

  // Dex controls
  $('#game-btn').addEventListener('click', openGamePicker);
  $('#game-grid').addEventListener('click', (e) => {
    const tile = e.target.closest('[data-game]');
    if (!tile) return;
    $('#game-dlg').close();
    if (tile.dataset.game === prefs.gameId) return;
    prefs.gameId = tile.dataset.game;
    prefs.playthroughId = '';
    savePrefs();
    renderDex();
    window.scrollTo(0, 0);
  });
  $('#game-dlg').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
  $('#pt-select').addEventListener('change', (e) => {
    if (e.target.value === '__new') {
      const name = prompt(`Name for the new ${currentGame().shortName} playthrough (e.g. Nuzlocke):`);
      if (name && name.trim()) {
        const id = uuid();
        write('playthrough', id, { name: name.trim(), gameId: currentGame().id, createdAt: nowISO() });
        prefs.playthroughId = id;
      }
    } else {
      prefs.playthroughId = e.target.value;
    }
    savePrefs();
    renderDex();
  });
  document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => {
    prefs.mode = b.dataset.mode;
    savePrefs();
    renderDex();
  }));
  for (const [sel, key] of [['#gen-filter', 'gen'], ['#type-filter', 'type'], ['#status-filter', 'status'], ['#tag-filter', 'tag']]) {
    $(sel).addEventListener('change', (e) => { prefs[key] = e.target.value; savePrefs(); renderDex(); });
  }
  $('#dex-search').addEventListener('input', (e) => { search = e.target.value; renderDex(); });
  const grid = $('#dex-grid');
  grid.addEventListener('click', onDexTap);
  grid.addEventListener('pointerdown', onDexPointerDown);
  grid.addEventListener('pointermove', onDexPointerMove);
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) grid.addEventListener(ev, cancelPress);
  grid.addEventListener('contextmenu', (e) => {
    const cell = e.target.closest('.cell');
    if (!cell) return;
    e.preventDefault();
    cancelPress();
    // A long-press may already have opened it.
    if (!$('#detail-dlg').open) openDetail(Number(cell.dataset.id));
  });
  $('#badge-strip').addEventListener('click', (e) => {
    const b = e.target.closest('[data-badge]');
    if (b) toggleBadge(b.dataset.badge);
  });
  $('#badge-strip').addEventListener('toggle', (e) => {
    prefs.badgesOpen = e.target.open;
    savePrefs();
  }, true);

  // Detail sheet
  $('#detail-body').addEventListener('click', onDetailClick);
  $('#detail-body').addEventListener('change', onDetailChange);
  $('#detail-dlg').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });

  // Timeline
  $('#timeline').addEventListener('change', (e) => {
    if (e.target.id !== 'review-year') return;
    prefs.reviewYear = Number(e.target.value);
    savePrefs();
    renderTimeline();
  });
  $('#timeline').addEventListener('click', (e) => {
    if (e.target.id !== 'timeline-more') return;
    timelineShown += TIMELINE_PAGE;
    renderTimeline();
  });

  // Hunts
  $('#hunt-list').addEventListener('click', onHuntTap);
  huntPicker = makeSpeciesPicker($('#hunt-species'), $('#hunt-species-results'), renderRecommendations);
  phasePicker = makeSpeciesPicker($('#phase-species'), $('#phase-species-results'));
  $('#new-hunt').addEventListener('click', () => {
    $('#hunt-form').reset();
    huntPicker.reset();
    $('#hunt-dlg').showModal();
    $('#hunt-species').focus();
  });
  // Changing method or charm by hand drops a tapped recommendation's modifiers.
  $('#hunt-method').addEventListener('change', () => {
    huntMods = {};
    $('#hunt-recs').querySelectorAll('.rec').forEach((x) => x.classList.remove('on'));
  });
  $('#hunt-form').addEventListener('submit', (e) => {
    const speciesId = huntPicker.resolve();
    if (!speciesId) { e.preventDefault(); $('#hunt-species').focus(); return; }
    write('hunt', uuid(), {
      speciesId,
      method: $('#hunt-method').value,
      encounters: Math.max(0, parseInt($('#hunt-start').value, 10) || 0),
      startedAt: nowISO(),
      completedAt: null,
      abandonedAt: null,
      notes: '',
      shinyCharm: $('#hunt-charm').checked,
      sandwichLevel: huntMods.sandwichLevel || 0,
      chainCount: huntMods.chainCount || 0,
      maxMilestoneNotified: 0,
    });
    renderHunts();
  });
  $('#phase-form').addEventListener('submit', (e) => {
    const speciesId = phasePicker.resolve();
    const hunt = store.rows.get(phaseHuntId);
    if (!speciesId || !hunt) { e.preventDefault(); $('#phase-species').focus(); return; }
    write('phase', uuid(), {
      huntId: hunt.id,
      speciesId,
      encountersAtPhase: hunt.data.encounters || 0,
      endedAt: nowISO(),
      notes: $('#phase-notes').value.trim(),
    });
    renderHunts();
  });
  $('#notes-form').addEventListener('submit', () => {
    const row = store.rows.get(notesHuntId);
    if (!row) return;
    write('hunt', row.id, { ...row.data, notes: $('#notes-input').value.trim() });
    renderHunts();
  });
  $('#count-form').addEventListener('submit', () => {
    const row = store.rows.get(countHuntId);
    const n = parseInt($('#count-input').value, 10);
    if (row && Number.isFinite(n) && n >= 0) {
      write('hunt', row.id, { ...row.data, encounters: n });
      renderHunts();
    }
  });
  $('#caught-form').addEventListener('submit', () => {
    const row = store.rows.get(caughtHuntId);
    if (!row) return;
    const gameId = $('#caught-game').value;
    prefs.lastCaughtGame = gameId;
    savePrefs();
    write('hunt', row.id, { ...row.data, completedAt: nowISO() });
    const index = catchIndex();
    if (!index.has(catchKey({ speciesId: row.data.speciesId, gameId, isShiny: true, playthroughId: null }))) {
      toggleCatch(row.data.speciesId, gameId, true, null, index);
    }
    renderHunts();
  });
  document.querySelectorAll('dialog [data-close]').forEach((b) =>
    b.addEventListener('click', () => b.closest('dialog').close()));

  // Account
  $('#sync-btn').addEventListener('click', () => { renderAccount(); $('#account-dlg').showModal(); });
  $('#sync-now').addEventListener('click', () => syncNow());
  $('#sign-out').addEventListener('click', async () => {
    if (store.pending.size && !confirm('Some changes haven\'t uploaded yet. Sign out anyway and lose them?')) return;
    $('#account-dlg').close();
    try { localStorage.removeItem(CACHE_KEY); } catch { /* ignore */ }
    await auth.signOut();
  });
  $('#mac-password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = $('#mac-password').value;
    const msg = $('#mac-password-msg');
    msg.textContent = '';
    msg.classList.remove('ok');
    try {
      await saveMacPassword(pw);
      // Hiding the form after a successful submit is the cue password managers
      // use to offer saving the email + password pair.
      $('#mac-password-form').hidden = true;
      msg.classList.add('ok');
      msg.textContent = `Saved. On the Mac, sign in with ${auth.currentUser.email} and this password.`;
    } catch (err) {
      msg.textContent = authMessage(err);
    }
  });
  $('#sync-btn').addEventListener('click', () => {
    $('#mac-password-form').hidden = false;
    $('#mac-password').value = '';
    $('#mac-password-msg').textContent = '';
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncNow();
    else if (store.pending.size) flush();
  });
  window.addEventListener('online', () => syncNow());
}

function fillStaticSelects() {
  const groups = [];
  for (const g of GAMES) {
    const label = gameGroup(g);
    let grp = groups.find((x) => x.label === label);
    if (!grp) groups.push(grp = { label, games: [] });
    grp.games.push(g);
  }
  const options = groups.map((grp) => `<optgroup label="${grp.label}">` +
    grp.games.map((g) => `<option value="${g.id}">${esc(g.name)}</option>`).join('') + '</optgroup>').join('');
  $('#caught-game').innerHTML = options;
  $('#hunt-method').innerHTML = METHODS.map((m) => `<option>${m}</option>`).join('');
}

async function boot() {
  const [species, games, badges] = await Promise.all([
    fetch('data/species.json').then((r) => r.json()),
    fetch('data/games.json').then((r) => r.json()),
    fetch('data/badges.json').then((r) => r.json()),
  ]);
  BADGES = badges;
  SPECIES = species;
  SPECIES_BY_ID = new Map(species.map((s) => [s.id, s]));
  GAMES = games;
  fillStaticSelects();
  wireEvents();

  auth.onAuthStateChanged((user) => {
    if (user && user.uid !== store.userId) enterApp(user);
    else if (!user) leaveApp();
  });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

boot();
