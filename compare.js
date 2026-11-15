'use strict';

// Compare sheet (opened from Stats): what you have in one game but not another,
// and a one-step way to mark those in the other game after a transfer.
// Port of the Mac app's CompareView + Transfer Planner. Loaded before app.js.

let cmpSeg = 'a';   // which list is showing: 'a' (only in A), 'both', 'b' (only in B)

function openCompare() {
  // Start from the game the dex is on, against HOME (or Scarlet / Violet when that is HOME).
  if (!GAMES.some((g) => g.id === prefs.cmpA)) prefs.cmpA = prefs.gameId;
  if (!GAMES.some((g) => g.id === prefs.cmpB) || prefs.cmpB === prefs.cmpA) prefs.cmpB = prefs.cmpA === 'home' ? 'sv' : 'home';
  cmpSeg = 'a';
  renderCompare();
  openDialog($('#compare-dlg'));
}

// Caught in a game means a record in any of its playthroughs.
function compareData() {
  const a = GAMES.find((g) => g.id === prefs.cmpA) || GAMES[0];
  const b = GAMES.find((g) => g.id === prefs.cmpB) || GAMES.find((g) => g.id !== a.id);
  const shiny = !!prefs.cmpShiny;
  const have = (gameId) => new Set(live('catch')
    .filter((r) => r.data.gameId === gameId && !!r.data.isShiny === shiny).map((r) => r.data.speciesId));
  const inA = have(a.id);
  const inB = have(b.id);
  // National Dex order, regional forms next to their base.
  const sortKey = (id) => { const sp = SPECIES_BY_ID.get(id); return [sp?.baseSpeciesId ?? id, id]; };
  const sorted = (ids) => ids.sort((x, y) => { const p = sortKey(x), q = sortKey(y); return p[0] - q[0] || p[1] - q[1]; });
  return {
    a, b, shiny,
    onlyA: sorted([...inA].filter((id) => !inB.has(id))),
    both: sorted([...inA].filter((id) => inB.has(id))),
    onlyB: sorted([...inB].filter((id) => !inA.has(id))),
  };
}

// The Pokémon in the showing list that the other game's dex has room for.
function compareMove(d) {
  if (cmpSeg === 'both') return null;
  const to = cmpSeg === 'a' ? d.b : d.a;
  const dex = new Set(to.species);
  const list = cmpSeg === 'a' ? d.onlyA : d.onlyB;
  return { from: cmpSeg === 'a' ? d.a : d.b, to, dex, ids: list.filter((id) => dex.has(id)) };
}

function renderCompare() {
  const d = compareData();
  const options = (selected) => GAMES.map((g) => `<option value="${g.id}" ${g.id === selected ? 'selected' : ''}>${esc(g.name)}</option>`).join('');
  const segs = [['a', `Only ${d.a.shortName}`, d.onlyA], ['both', 'In both', d.both], ['b', `Only ${d.b.shortName}`, d.onlyB]];
  const list = segs.find(([key]) => key === cmpSeg)[2];
  const move = compareMove(d);
  const word = d.shiny ? 'shiny' : 'caught';

  let foot = '';
  if (move && list.length) {
    const out = list.length - move.ids.length;
    foot = `<div class="cmp-move">` +
      (move.ids.length ? `<button class="primary wide" data-act="move">Mark ${move.ids.length.toLocaleString()} ${word} in ${esc(move.to.shortName)}</button>` : '') +
      `<p class="muted">${move.ids.length ? 'For after you transfer them. ' : ''}` +
      `${out ? `${out.toLocaleString()} ${out === 1 ? "isn't" : "aren't"} in ${esc(move.to.shortName)}'s dex (faded).` : ''}</p></div>`;
  }

  setHTML($('#compare-body'), `
    <div class="detail-top"><h2>Compare games</h2>
      <button class="ghost close" data-act="close" aria-label="Close">✕</button></div>
    <div class="cmp-pick">
      <select data-cmp="cmpA" aria-label="First game">${options(d.a.id)}</select>
      <button data-act="swap" aria-label="Swap the two games" title="Swap">⇄</button>
      <select data-cmp="cmpB" aria-label="Second game">${options(d.b.id)}</select>
    </div>
    <div class="cmp-mode"><div class="seg" role="group" aria-label="Regular or shiny">
      <button data-shiny="0" class="${d.shiny ? '' : 'on'}" aria-pressed="${!d.shiny}">Regular</button>
      <button data-shiny="1" class="${d.shiny ? 'on' : ''}" aria-pressed="${d.shiny}">Shiny</button>
    </div></div>
    <div class="choice cmp-segs">${segs.map(([key, label, ids]) =>
      `<button data-seg="${key}" aria-pressed="${key === cmpSeg}">${esc(label)} <b>${ids.length.toLocaleString()}</b></button>`).join('')}</div>
    ${foot}
    <div class="cmp-grid">${list.map((id) =>
      `<button data-id="${id}" class="${move && !move.dex.has(id) ? 'off' : ''}" title="${esc(speciesName(id))}" aria-label="${esc(speciesName(id))}">` +
      `${spriteImg(id, d.shiny, 'loading="lazy" decoding="async"')}</button>`).join('')
      || `<p class="empty">${cmpSeg === 'both' ? 'Nothing is in both yet.' : 'Nothing here.'}</p>`}</div>`);
}

function onCompareChange(e) {
  const key = e.target.dataset.cmp;
  if (!key) return;
  const other = key === 'cmpA' ? 'cmpB' : 'cmpA';
  // Picking the game that's already on the other side swaps the two.
  if (e.target.value === prefs[other]) prefs[other] = prefs[key];
  prefs[key] = e.target.value;
  savePrefs();
  renderCompare();
}

async function onCompareClick(e) {
  const btn = e.target.closest('button');
  if (!btn) return;
  if (btn.dataset.act === 'close') { $('#compare-dlg').close(); return; }
  if (btn.dataset.act === 'swap') {
    [prefs.cmpA, prefs.cmpB] = [prefs.cmpB, prefs.cmpA];
    cmpSeg = cmpSeg === 'a' ? 'b' : cmpSeg === 'b' ? 'a' : 'both';
    savePrefs();
  } else if (btn.dataset.seg) {
    cmpSeg = btn.dataset.seg;
  } else if (btn.dataset.shiny) {
    prefs.cmpShiny = btn.dataset.shiny === '1';
    savePrefs();
  } else if (btn.dataset.id) {
    openDetail(Number(btn.dataset.id));
    return;
  } else if (btn.dataset.act === 'move') {
    const d = compareData();
    const move = compareMove(d);
    if (!move?.ids.length) return;
    const count = `${move.ids.length.toLocaleString()} Pokémon`;
    const word = d.shiny ? 'shiny' : 'caught';
    const yes = await ask({ title: `Mark ${count} as ${word} in ${move.to.name}?`,
      body: `They're added to its Main playthrough with today's date. Nothing changes in ${move.from.name}.`, ok: 'Mark' });
    if (!yes) return;
    writeWithUndo(move.ids.map((id) => ({ kind: 'catch', id: uuid(), data: {
      speciesId: id, gameId: move.to.id, isShiny: d.shiny, playthroughId: null, notes: '', tagsRaw: '', caughtAt: nowISO(),
    } })), `Marked ${count} as ${word} in ${move.to.shortName}`, 15000);
    render();
    return;
  } else {
    return;
  }
  renderCompare();
}
