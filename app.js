'use strict';

// ---------------------------------------------------------------------------
// Config. The publishable key is safe in the page: row-level security limits
// every request to the signed-in user's own rows.
// ---------------------------------------------------------------------------
const SB_URL = 'https://cmgajwvtnjqcoexzhgqa.supabase.co';
const SB_KEY = 'sb_publishable_wZiRW1VLIg_aEepzfQMAHQ_zh0P7Isb';
const POLL_MS = 20000;
const PULL_OVERLAP_MS = 120000;
const CACHE_KEY = 'pt-cache-v1';
const PREFS_KEY = 'pt-prefs-v1';

const sb = supabase.createClient(SB_URL, SB_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

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

const spriteURL = (id, shiny) =>
  `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${shiny ? 'shiny/' : ''}${id}.png`;
const dexNum = (sp) => '#' + String(sp.baseSpeciesId ?? sp.id).padStart(4, '0');
const speciesName = (id) => SPECIES_BY_ID.get(id)?.name ?? `#${id}`;
const gameGroup = (g) => (g.releaseGen === 'cross' ? 'Cross-Game' : `Gen ${g.releaseGen}`);

// ---------------------------------------------------------------------------
// Sync store: every record is a row {id, kind, data, deleted, updated_at}.
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

function overlapped(cursor) {
  // Server timestamps look like 2026-10-07T16:40:00.123456+00:00 (UTC).
  const t = Date.parse(cursor.slice(0, 19) + 'Z');
  return Number.isFinite(t) ? new Date(t - PULL_OVERLAP_MS).toISOString() : cursor;
}

async function pull() {
  const pageSize = 1000;
  let from = 0;
  let changed = false;
  let newest = store.cursor;
  for (;;) {
    let q = sb.from('records').select('id,kind,data,deleted,updated_at')
      .order('updated_at', { ascending: true }).order('id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (store.cursor) q = q.gt('updated_at', overlapped(store.cursor));
    const { data, error } = await q;
    if (error) throw error;
    for (const r of data) {
      if (!newest || r.updated_at > newest) newest = r.updated_at;
      if (store.pending.has(r.id)) continue;
      const cur = store.rows.get(r.id);
      if (cur && cur.updated_at === r.updated_at) continue;
      store.rows.set(r.id, r);
      changed = true;
    }
    if (data.length < pageSize) break;
    from += pageSize;
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
  const { error } = await sb.from('records').upsert(
    batch.map((r) => ({ user_id: store.userId, id: r.id, kind: r.kind, data: r.data, deleted: r.deleted })),
    { onConflict: 'user_id,id' });
  flushing = false;
  if (error) {
    setStatus('error', describeError(error));
    scheduleFlush(10000);
    return;
  }
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
  if (/fetch|network|Failed/i.test(msg)) return "Can't reach the sync server. If it hasn't been used in a week, restore the project in Supabase.";
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
  return { oneIn: Math.round(1 / p), cumulative };
}

// ---------------------------------------------------------------------------
// UI state
// ---------------------------------------------------------------------------
const prefs = Object.assign({
  tab: 'dex', gameId: 'home', playthroughId: '', mode: 'regular',
  gen: 'all', type: 'all', status: 'all', lastCaughtGame: 'sv',
}, readJSON(PREFS_KEY) || {});
const savePrefs = () => writeJSON(PREFS_KEY, prefs);
let search = '';

function render() {
  if (!store.userId) return;
  if (prefs.tab === 'dex') renderDex();
  else if (prefs.tab === 'hunts') renderHunts();
  else renderStats();
}

// ---- Tabs -----------------------------------------------------------------
const TITLES = { dex: 'Living Dex', hunts: 'Shiny Hunts', stats: 'Stats' };
function showTab(tab) {
  prefs.tab = tab;
  savePrefs();
  for (const t of ['dex', 'hunts', 'stats']) $(`#tab-${t}`).hidden = t !== tab;
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  $('#title').textContent = TITLES[tab];
  render();
  window.scrollTo(0, 0);
}

// ---- Dex ------------------------------------------------------------------
function currentGame() {
  return GAMES.find((g) => g.id === prefs.gameId) || GAMES[0];
}

function renderDexControls() {
  const game = currentGame();

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
}

function renderDex() {
  renderDexControls();
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
  const list = dexSpecies.filter((s) => {
    if (prefs.gen !== 'all' && s.generation !== Number(prefs.gen)) return false;
    if (prefs.type !== 'all' && !s.types.includes(prefs.type)) return false;
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
      `<img loading="lazy" alt="" src="${spriteURL(s.id, shiny)}">` +
      `<span class="num">${dexNum(s)}</span><span class="name">${esc(s.name)}</span></button>`;
  }).join('') : '<p class="empty">Nothing matches these filters.</p>';
}

function onDexTap(e) {
  const cell = e.target.closest('.cell');
  if (!cell) return;
  const id = Number(cell.dataset.id);
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
    const nPhases = phases.filter((p) => p.data.huntId === h.id).length;
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
      <div class="odds">1/${odds.oneIn.toLocaleString()} odds · ${(odds.cumulative * 100).toFixed(1)}% chance of a shiny by now</div>
      <div class="hunt-actions">
        <button class="caught-btn" data-act="caught">✨ Caught it!</button>
        <button data-act="charm">${d.shinyCharm ? 'Remove' : 'Add'} Charm</button>
        <button data-act="abandon">Abandon</button>
      </div>
    </article>`;
  };

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

function onHuntTap(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const id = btn.closest('[data-id]').dataset.id;
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

// New hunt dialog
let pickedSpecies = null;
function renderSpeciesPicker() {
  const q = $('#hunt-species').value.trim().toLowerCase();
  if (!q || (pickedSpecies && SPECIES_BY_ID.get(pickedSpecies)?.name.toLowerCase() === q)) {
    $('#hunt-species-results').innerHTML = '';
    return;
  }
  const matches = SPECIES.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 20);
  $('#hunt-species-results').innerHTML = matches.map((s) =>
    `<button type="button" data-id="${s.id}" class="${s.id === pickedSpecies ? 'on' : ''}">` +
    `<img alt="" loading="lazy" src="${spriteURL(s.id, true)}">${esc(s.name)} <span class="muted">${dexNum(s)}</span></button>`).join('');
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
}

// ---------------------------------------------------------------------------
// Auth + boot
// ---------------------------------------------------------------------------
let pollTimer = null;

function enterApp(session) {
  store.userId = session.user.id;
  store.email = session.user.email;
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
    if (authMode === 'signup') {
      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) { msg.textContent = error.message; return; }
      if (!data.session) msg.textContent = 'Check your email to confirm the account, then sign in.';
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) msg.textContent = error.message;
    }
  });

  // Tabs
  document.querySelectorAll('.tabbar button').forEach((b) =>
    b.addEventListener('click', () => showTab(b.dataset.tab)));

  // Dex controls
  $('#game-select').addEventListener('change', (e) => {
    prefs.gameId = e.target.value;
    prefs.playthroughId = '';
    savePrefs();
    renderDex();
    window.scrollTo(0, 0);
  });
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
  for (const [sel, key] of [['#gen-filter', 'gen'], ['#type-filter', 'type'], ['#status-filter', 'status']]) {
    $(sel).addEventListener('change', (e) => { prefs[key] = e.target.value; savePrefs(); renderDex(); });
  }
  $('#dex-search').addEventListener('input', (e) => { search = e.target.value; renderDex(); });
  $('#dex-grid').addEventListener('click', onDexTap);

  // Hunts
  $('#hunt-list').addEventListener('click', onHuntTap);
  $('#new-hunt').addEventListener('click', () => {
    pickedSpecies = null;
    $('#hunt-form').reset();
    $('#hunt-species-results').innerHTML = '';
    $('#hunt-dlg').showModal();
    $('#hunt-species').focus();
  });
  $('#hunt-species').addEventListener('input', () => { pickedSpecies = null; renderSpeciesPicker(); });
  $('#hunt-species-results').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    pickedSpecies = Number(b.dataset.id);
    $('#hunt-species').value = speciesName(pickedSpecies);
    renderSpeciesPicker();
  });
  $('#hunt-form').addEventListener('submit', (e) => {
    if (!pickedSpecies) {
      const exact = SPECIES.find((s) => s.name.toLowerCase() === $('#hunt-species').value.trim().toLowerCase());
      if (!exact) { e.preventDefault(); $('#hunt-species').focus(); return; }
      pickedSpecies = exact.id;
    }
    write('hunt', uuid(), {
      speciesId: pickedSpecies,
      method: $('#hunt-method').value,
      encounters: Math.max(0, parseInt($('#hunt-start').value, 10) || 0),
      startedAt: nowISO(),
      completedAt: null,
      abandonedAt: null,
      notes: '',
      shinyCharm: $('#hunt-charm').checked,
      sandwichLevel: 0,
      chainCount: 0,
      maxMilestoneNotified: 0,
    });
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
    await sb.auth.signOut();
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
  $('#game-select').innerHTML = options;
  $('#game-select').value = currentGame().id;
  $('#caught-game').innerHTML = options;
  $('#hunt-method').innerHTML = METHODS.map((m) => `<option>${m}</option>`).join('');
}

async function boot() {
  const [species, games] = await Promise.all([
    fetch('data/species.json').then((r) => r.json()),
    fetch('data/games.json').then((r) => r.json()),
  ]);
  SPECIES = species;
  SPECIES_BY_ID = new Map(species.map((s) => [s.id, s]));
  GAMES = games;
  fillStaticSelects();
  wireEvents();

  sb.auth.onAuthStateChange((event, session) => {
    if (session && session.user.id !== store.userId) enterApp(session);
    else if (!session) leaveApp();
  });
  const { data } = await sb.auth.getSession();
  if (!data.session) leaveApp();

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

boot();
