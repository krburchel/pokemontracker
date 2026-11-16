'use strict';

// Command palette: the bolt button in the top bar, or ⌘K / Ctrl+K. Type to jump
// to a Pokémon, a game, a tab, a hunt or an action. A Pokémon plus a game
// ("pikachu sv", "eevee violet shiny") offers to mark that catch on the spot.
// Port of the Mac app's CommandPaletteView. Loaded before app.js.

let palItems = [];
let palIndex = 0;

// Words that name a game, or one version of a paired game: alias -> {game, version}.
let palAliases = null;
function paletteAliases() {
  if (palAliases) return palAliases;
  palAliases = new Map();
  const add = (alias, game, version = null) => {
    const key = alias.toLowerCase();
    if (!palAliases.has(key)) palAliases.set(key, { game, version });
  };
  const extra = { legendsza: ['za', 'z-a', 'plza'], legendsarceus: ['pla', 'arceus'], pogo: ['go'], letsgo: ['lgpe', 'lets go'] };
  const speciesNames = new Set(SPECIES.map((sp) => sp.name.toLowerCase()));
  for (const g of GAMES) {
    for (const alias of [g.id, g.shortName, g.name, ...(extra[g.id] || [])]) add(alias, g);
    for (const v of versionsOf(g.id)) {
      add(v.id, g, v.id);
      // Let's Go's versions are called Pikachu and Eevee; those words mean the Pokémon.
      if (!speciesNames.has(v.label.toLowerCase())) add(v.label, g, v.id);
    }
  }
  return palAliases;
}

// "pikachu sv shiny" -> {game, version, shiny, words: ['pikachu']}; the game can lead or trail.
function parseQuickAdd(words) {
  const rest = words.filter((w) => w !== 'shiny');
  const shiny = rest.length !== words.length;
  for (let n = Math.min(3, rest.length - 1); n >= 1; n--) {
    const tail = paletteAliases().get(rest.slice(-n).join(' '));
    if (tail) return { ...tail, shiny, words: rest.slice(0, -n) };
    const head = paletteAliases().get(rest.slice(0, n).join(' '));
    if (head) return { ...head, shiny, words: rest.slice(n) };
  }
  return null;
}

// Lower is better: 0 when every word starts the text, +1 per word that starts a
// later word, +2 per word found mid-word. -1 when a word is missing.
function palScore(text, words) {
  let total = 0;
  for (const w of words) {
    const i = text.indexOf(w);
    if (i < 0) return -1;
    total += i === 0 ? 0 : /[\s/:(.-]/.test(text[i - 1]) ? 1 : 2;
  }
  return total;
}

function paletteResults(query) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const found = [];
  const add = (kindRank, text, item) => {
    const score = words.length ? palScore(text.toLowerCase(), words) : 0;
    if (score >= 0) found.push({ score, kindRank, order: found.length, ...item });
  };

  // Tabs and actions.
  for (const tab of TABS) {
    add(1, `${TITLES[tab]} ${tab} go to`, { kind: 'Go to', label: TITLES[tab], art: icon(tab), run: () => showTab(tab) });
  }
  const game = currentGame();
  const actions = [
    ['New shiny hunt', 'hunts', 'start hunt', () => { showTab('hunts'); $('#new-hunt').click(); }],
    ['Compare two games', 'stats', 'transfer', openCompare],
    ['Filters', 'filter', 'filter missing caught type generation', () => { showTab('dex'); $('#filter-btn').click(); }],
    ...(boxLayout(game.id) ? [[prefs.view === 'boxes' ? 'Grid view' : 'Box view', 'boxes', 'boxes grid view layout', () => {
      prefs.view = prefs.view === 'boxes' ? 'grid' : 'boxes';
      savePrefs();
      showTab('dex');
    }]] : []),
    [prefs.density === 'compact' ? 'Large dex grid' : 'Compact dex grid', 'boxes', 'grid size small big density more per screen', () => {
      setDensity(prefs.density === 'compact' ? 'large' : 'compact');
      showTab('dex');
    }],
    ['Settings', 'gear', 'sync account sprites sign out', () => $('#sync-btn').click()],
    ['Download backup', 'note', 'export save file', () => exportBackup().catch((e) => showToast(`Couldn't save the backup: ${e.message || e}`))],
    ['Export catches as a spreadsheet (CSV)', 'note', 'excel sheets csv export', () => exportCSV().then((said) => said && showToast(said), (e) => showToast(`Couldn't export: ${e.message || e}`))],
    ['Sync now', 'start', 'refresh upload', syncNow],
  ];
  for (const [label, ico, extra, run] of actions) add(2, `${label} ${extra}`, { kind: 'Action', label, art: icon(ico), run });

  // Active hunts.
  for (const h of activeHunts()) {
    const name = speciesName(h.data.speciesId);
    add(3, `${name} hunt shiny`, {
      kind: 'Hunt', label: `${name} hunt`, sub: `${(h.data.encounters || 0).toLocaleString()} encounters`,
      art: spriteImg(h.data.speciesId, true, 'loading="lazy"'),
      run: () => {
        keyHuntId = h.id;
        showTab('hunts');
        document.querySelector(`article.hunt[data-id="${CSS.escape(h.id)}"]`)?.scrollIntoView({ block: 'center' });
      },
    });
  }
  if (!words.length) return found;

  // Games.
  for (const g of GAMES) {
    const names = [g.name, g.shortName, g.id, ...versionsOf(g.id).map((v) => v.label)].join(' ');
    add(4, names, { kind: 'Game', label: g.name, art: `<img src="logos/${g.id}-0.webp" alt="" loading="lazy">`, run: () => {
      prefs.gameId = g.id;
      prefs.playthroughId = '';
      savePrefs();
      showTab('dex');
    } });
  }

  // Pokémon, by name or National Dex number.
  const number = /^#?\d+$/.test(words.join('')) ? Number(words.join('').replace('#', '')) : null;
  const species = [];
  for (const sp of [...SPECIES, ...shownForms()]) {
    const score = number != null ? ((sp.baseSpeciesId ?? sp.id) === number ? 0 : -1) : palScore(sp.name.toLowerCase(), words);
    if (score >= 0) species.push({ score, sp });
  }
  species.sort((a, b) => a.score - b.score);
  for (const { score, sp } of species.slice(0, 20)) {
    found.push({ score, kindRank: 5, order: found.length, kind: 'Pokémon', label: sp.name, sub: dexNum(sp),
      art: spriteImg(sp.id, false, 'loading="lazy"'), run: () => openDetail(sp.id) });
  }

  // Quick add: a Pokémon named together with a game.
  const quick = parseQuickAdd(words);
  if (quick?.words.length) {
    const dex = new Set(quick.game.species);
    const version = quick.version || activeVersion(quick.game.id);
    const where = versionsOf(quick.game.id).find((v) => v.id === version)?.label || quick.game.shortName;
    const word = quick.shiny ? 'shiny' : 'caught';
    const pt = ptFor(quick.game.id) || null;
    const index = catchIndex();
    const matches = [...SPECIES, ...shownForms()].filter((sp) => dex.has(sp.id))
      .map((sp) => ({ sp, score: palScore(sp.name.toLowerCase(), quick.words) })).filter((m) => m.score >= 0)
      .sort((a, b) => a.score - b.score).slice(0, 3);
    for (const { sp, score } of matches) {
      const recs = index.get(catchKey({ speciesId: sp.id, gameId: quick.game.id, isShiny: quick.shiny, playthroughId: pt }));
      const owned = version ? !!recs?.[0]?.data.versions?.includes(version) : !!recs?.length;
      found.push({ score: score - 10, kindRank: 0, order: found.length, kind: owned ? 'Already marked' : 'Quick add',
        label: owned ? `${sp.name} is already ${word} in ${where}` : `Mark ${sp.name} ${word} in ${where}`,
        art: spriteImg(sp.id, quick.shiny, 'loading="lazy"'), keep: !owned,
        run: () => {
          if (owned) { openDetail(sp.id); return; }
          const { writes } = catchToggleWrites(sp.id, quick.game.id, quick.shiny, pt, catchIndex(), version);
          writeWithUndo(writes, `Marked ${sp.name} ${word} in ${where}`);
          render();
          // Stay open, ready for the next one.
          $('#palette-input').value = '';
          renderPalette();
          $('#palette-input').focus();
        } });
    }
  }

  return found.sort((a, b) => a.score - b.score || a.kindRank - b.kindRank || a.order - b.order);
}

function renderPalette() {
  palItems = paletteResults($('#palette-input').value);
  palIndex = 0;
  $('#palette-list').innerHTML = palItems.map((item, i) =>
    `<button type="button" class="pal-row${i === 0 ? ' on' : ''}" data-i="${i}" role="option" aria-selected="${i === 0}">` +
    `<span class="pal-art">${item.art || ''}</span>` +
    `<span class="pal-label">${esc(item.label)}${item.sub ? ` <small>${esc(item.sub)}</small>` : ''}</span>` +
    `<span class="pal-kind">${esc(item.kind)}</span></button>`).join('')
    || '<p class="empty">Nothing matches.</p>';
}

function movePalette(step) {
  if (!palItems.length) return;
  palIndex = (palIndex + step + palItems.length) % palItems.length;
  $('#palette-list').querySelectorAll('.pal-row').forEach((row, i) => {
    row.classList.toggle('on', i === palIndex);
    row.setAttribute('aria-selected', i === palIndex);
    if (i === palIndex) row.scrollIntoView({ block: 'nearest' });
  });
}

function runPalette(i) {
  const item = palItems[i];
  if (!item) return;
  if (!item.keep) $('#palette-dlg').close();
  item.run();
}

function openPalette() {
  if ($('#app').hidden || document.querySelector('dialog[open]')) return;
  $('#palette-input').value = '';
  renderPalette();
  openDialog($('#palette-dlg'));
  $('#palette-input').focus();
}

function wirePalette() {
  $('#palette-btn').addEventListener('click', openPalette);
  $('#palette-input').addEventListener('input', renderPalette);
  $('#palette-input').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); movePalette(e.key === 'ArrowDown' ? 1 : -1); }
    else if (e.key === 'Enter') { e.preventDefault(); runPalette(palIndex); }
  });
  $('#palette-list').addEventListener('click', (e) => {
    const row = e.target.closest('.pal-row');
    if (row) runPalette(Number(row.dataset.i));
  });
  $('#palette-dlg').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
  document.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'k') return;
    e.preventDefault();
    if ($('#palette-dlg').open) $('#palette-dlg').close();
    else openPalette();
  });
}
