'use strict';

// Move to HOME sheet (opened from Stats or the palette): Pokémon you've caught
// in a game that can send them to HOME but haven't marked in HOME yet, one game
// at a time. Tap one after moving it to mark it in HOME. Loaded before app.js.

// The games that can still send Pokémon to HOME on their own, without Pokémon
// Bank: GO (through GO Transporter), FireRed / LeafGreen on Switch and Let's Go
// (both one way) and the other Switch games.
const HOME_SOURCES = new Set(['pogo', 'frlg', 'letsgo', 'swsh', 'bdsp', 'legendsarceus', 'sv', 'legendsza']);

// Caught means a record in any playthrough, in HOME and in the game.
function toHomeData(shiny = !!prefs.toHomeShiny) {
  const home = GAMES.find((g) => g.id === 'home');
  const order = new Map((home?.species || []).map((id, i) => [id, i]));
  const catches = live('catch').filter((r) => !!r.data.isShiny === shiny);
  const inHome = new Set(catches.filter((r) => r.data.gameId === 'home').map((r) => r.data.speciesId));
  const byGame = new Map();
  for (const { data: { gameId, speciesId } } of catches) {
    if (!HOME_SOURCES.has(gameId) || inHome.has(speciesId) || !order.has(speciesId)) continue;
    if (!byGame.has(gameId)) byGame.set(gameId, new Set());
    byGame.get(gameId).add(speciesId);
  }
  // HOME's own order, so the list runs the way its boxes fill.
  const games = GAMES.filter((g) => byGame.has(g.id))
    .map((g) => ({ g, ids: [...byGame.get(g.id)].sort((a, b) => order.get(a) - order.get(b)) }));
  const total = new Set(games.flatMap((x) => x.ids)).size;
  return { shiny, games, total };
}

// The game whose list is showing: the one picked last, else the biggest list.
function toHomePick(d) {
  return d.games.find((x) => x.g.id === prefs.toHomeGame)
    || d.games.reduce((best, x) => (!best || x.ids.length > best.ids.length ? x : best), null);
}

function openToHome() {
  // From a source game's dex, start on that game.
  const game = currentGame();
  if (HOME_SOURCES.has(game.id) && toHomeData().games.some((x) => x.g.id === game.id)) { prefs.toHomeGame = game.id; savePrefs(); }
  renderToHome();
  openDialog($('#tohome-dlg'));
  $('#tohome-body').scrollTop = 0;
}

function renderToHome() {
  const d = toHomeData();
  const cur = toHomePick(d);
  // Stay on the game shown, even after another game's list grows past it.
  if (cur && cur.g.id !== prefs.toHomeGame) { prefs.toHomeGame = cur.g.id; savePrefs(); }
  const word = d.shiny ? 'shiny' : 'caught';
  const n = cur?.ids.length || 0;

  setHTML($('#tohome-head'), `
    <div class="detail-top"><h2>Move to HOME</h2>
      <button class="ghost close" data-act="close" aria-label="Close">✕</button></div>
    <div class="cmp-mode"><div class="seg" role="group" aria-label="Regular or shiny">
      <button data-shiny="0" class="${d.shiny ? '' : 'on'}" aria-pressed="${!d.shiny}">Regular</button>
      <button data-shiny="1" class="${d.shiny ? 'on' : ''}" aria-pressed="${d.shiny}">Shiny</button>
    </div></div>
    <p class="th-intro">${d.total
      ? `<b>${d.total.toLocaleString()}</b> ${word} Pokémon ${d.total === 1 ? "isn't" : "aren't"} in HOME yet. Tap one after you move it.`
      : `Every ${d.shiny ? 'shiny ' : ''}Pokémon you've caught in these games is in HOME.`}</p>
    ${d.games.length ? `<div class="choice cmp-segs">${d.games.map(({ g, ids }) =>
      `<button data-game="${g.id}" aria-pressed="${g.id === cur.g.id}">${esc(g.shortName)} <b>${ids.length.toLocaleString()}</b></button>`).join('')}</div>` : ''}
    ${n > 1 ? `<button class="primary wide" data-act="all">Mark all ${n.toLocaleString()} from ${esc(cur.g.shortName)} in HOME</button>` : ''}`);

  // Updated in place, so a tap doesn't reload every sprite.
  morphChildren($('#tohome-grid'), cur ? cur.ids.map((id) => ({ key: id, html:
    `<button data-id="${id}" title="${esc(speciesName(id))}">` +
    `${spriteImg(id, d.shiny, 'loading="lazy" decoding="async"')}<span>${esc(speciesName(id))}</span></button>` }))
    : []);

  setHTML($('#tohome-foot'), 'Every game here can send Pokémon to HOME. Press and hold one for its details.');
}

// Marks catches in HOME's Main playthrough. The game's own catch stays as it is.
function markInHome(ids, shiny, message, timeout) {
  writeWithUndo(ids.map((id) => ({ kind: 'catch', id: uuid(), data: {
    speciesId: id, gameId: 'home', isShiny: shiny, playthroughId: null, notes: '', tagsRaw: '', caughtAt: nowISO(),
  } })), message, timeout);
  render();
}

// Press and hold (or right-click) opens the details instead of marking.
let thPress = null;
let thSuppressClick = false;
function thCancelPress() { if (thPress) clearTimeout(thPress.timer); thPress = null; }

async function onToHomeClick(e) {
  const btn = e.target.closest('button');
  if (!btn) return;
  const d = toHomeData();
  if (btn.dataset.act === 'close') { $('#tohome-dlg').close(); return; }
  if (btn.dataset.shiny) {
    prefs.toHomeShiny = btn.dataset.shiny === '1';
  } else if (btn.dataset.game) {
    prefs.toHomeGame = btn.dataset.game;
  } else if (btn.dataset.id) {
    if (thSuppressClick) { thSuppressClick = false; if (e.detail) return; }   // Enter still marks
    const id = Number(btn.dataset.id);
    const focused = document.activeElement === btn;
    const at = [...$('#tohome-grid').children].indexOf(btn);
    markInHome([id], d.shiny, `Marked ${d.shiny ? 'shiny ' : ''}${speciesName(id)} in HOME`);
    // With a keyboard, focus moves on to the Pokémon that took its place.
    if (focused) {
      const left = [...$('#tohome-grid').querySelectorAll('[data-id]')];
      (left[at] || left.at(-1))?.focus({ preventScroll: true });
    }
    return;
  } else if (btn.dataset.act === 'all') {
    const cur = toHomePick(d);
    if (!cur?.ids.length) return;
    const count = `${cur.ids.length.toLocaleString()} Pokémon`;
    const word = d.shiny ? 'shiny' : 'caught';
    const yes = await ask({ title: `Mark ${count} as ${word} in HOME?`,
      body: `For after you move them from ${cur.g.name}. They're added to HOME's Main playthrough with today's date. Their ${cur.g.shortName} catches stay marked.`, ok: 'Mark' });
    if (!yes) return;
    markInHome(cur.ids, d.shiny, `Marked ${count} as ${word} in HOME`, 15000);
    return;
  } else {
    return;
  }
  savePrefs();
  renderToHome();
}

function wireToHome() {
  const body = $('#tohome-body');
  const grid = $('#tohome-grid');
  body.addEventListener('click', onToHomeClick);
  $('#tohome-dlg').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
  grid.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('[data-id]');
    if (!b || e.button) return;
    thCancelPress();
    thSuppressClick = false;
    thPress = { x: e.clientX, y: e.clientY, timer: setTimeout(() => {
      thSuppressClick = true;
      openDetail(Number(b.dataset.id));
    }, 450) };
  });
  grid.addEventListener('pointermove', (e) => {
    if (thPress && Math.hypot(e.clientX - thPress.x, e.clientY - thPress.y) > 10) thCancelPress();
  });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) grid.addEventListener(ev, thCancelPress);
  grid.addEventListener('contextmenu', (e) => {
    const b = e.target.closest('[data-id]');
    if (!b) return;
    e.preventDefault();
    thCancelPress();
    thSuppressClick = true;   // a touch long-press can still send a click afterwards
    // A long-press may already have opened it.
    if (!$('#detail-dlg').open) openDetail(Number(b.dataset.id));
  });
}
