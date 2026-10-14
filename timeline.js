'use strict';

// Timeline tab: "this day in previous years", year in review, and a day-by-day
// activity feed built from every synced record. Port of the Mac app's
// TimelineEvent / TimelineView. Loaded before app.js.

const TIMELINE_PAGE = 100;
let timelineShown = TIMELINE_PAGE;

function timelineEvents() {
  const gameName = (id) => GAMES.find((g) => g.id === id)?.shortName || id;
  const out = [];
  const add = (date, icon, tint, label) => { if (date) out.push({ date: new Date(date), icon, tint, label }); };

  for (const r of live('catch')) {
    const c = r.data;
    add(c.caughtAt, c.isShiny ? '✨' : '✓', c.isShiny ? 'yellow' : 'green',
      `Caught ${c.isShiny ? 'shiny ' : ''}${speciesName(c.speciesId)} in ${gameName(c.gameId)}`);
  }
  const hunts = new Map(live('hunt').map((r) => [r.id, r.data]));
  for (const h of hunts.values()) {
    add(h.startedAt, '◎', 'blue', `Started ${speciesName(h.speciesId)} hunt (${h.method})`);
    if (h.completedAt) add(h.completedAt, '🏅', 'pink', `Caught shiny ${speciesName(h.speciesId)} after ${(h.encounters || 0).toLocaleString()} encounters`);
    if (h.abandonedAt) add(h.abandonedAt, '⊘', 'orange', `Abandoned ${speciesName(h.speciesId)} hunt at ${(h.encounters || 0).toLocaleString()} encounters`);
  }
  for (const r of live('phase')) {
    const p = r.data;
    const target = hunts.get(p.huntId);
    add(p.endedAt, '✨', 'yellow', `Phased into shiny ${speciesName(p.speciesId)} at #${(p.encountersAtPhase || 0).toLocaleString()}` +
      ` while hunting ${target ? speciesName(target.speciesId) : 'another target'}`);
  }
  for (const r of live('playthrough')) {
    add(r.data.createdAt, '＋', 'purple', `Started new playthrough "${r.data.name}" in ${gameName(r.data.gameId)}`);
  }
  for (const r of live('badge')) {
    const b = r.data;
    const name = (BADGES[b.gameId] || []).find((x) => x.id === b.badgeId)?.name || b.badgeId;
    add(b.earnedAt, '🎖', 'red', `Earned ${name} in ${gameName(b.gameId)}`);
  }
  return out.filter((e) => !Number.isNaN(e.date.getTime())).sort((a, b) => b.date - a.date);
}

function yearReview(events, year) {
  const inYear = events.filter((e) => e.date.getFullYear() === year);
  const byMonth = new Map();
  const typeCounts = new Map();
  let catches = 0, shinies = 0, started = 0, completed = 0, best = null;
  // Re-derive from records (labels aren't structured) for catches/types/hunts.
  for (const r of live('catch')) {
    const d = new Date(r.data.caughtAt);
    if (d.getFullYear() !== year) continue;
    if (r.data.isShiny) shinies++;
    else {
      catches++;
      for (const t of SPECIES_BY_ID.get(r.data.speciesId)?.types || []) typeCounts.set(t, (typeCounts.get(t) || 0) + 1);
    }
  }
  for (const r of live('hunt')) {
    const h = r.data;
    if (new Date(h.startedAt).getFullYear() === year) started++;
    if (h.completedAt && new Date(h.completedAt).getFullYear() === year) {
      completed++;
      if (!best || (h.encounters || 0) > best.encounters) best = { name: speciesName(h.speciesId), encounters: h.encounters || 0 };
    }
  }
  for (const e of inYear) byMonth.set(e.date.getMonth(), (byMonth.get(e.date.getMonth()) || 0) + 1);
  const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])[0];
  return { catches, shinies, started, completed, best, month: top(byMonth), type: top(typeCounts) };
}

function renderTimeline() {
  const events = timelineEvents();
  const el = $('#timeline');
  if (!events.length) {
    el.innerHTML = '<p class="empty">Nothing here yet. Catches, hunts, playthroughs and badges show up as you log them.</p>';
    return;
  }
  const now = new Date();
  const fmtDay = (d) => d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const row = (e, withDate) => `<div class="tl-row tint-${e.tint}"><span class="tl-icon">${e.icon}</span>` +
    `<span class="tl-label">${esc(e.label)}</span><span class="tl-time">${withDate ? e.date.getFullYear()
      : e.date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></div>`;

  // This day in previous years
  const onThisDay = events.filter((e) => e.date.getMonth() === now.getMonth() && e.date.getDate() === now.getDate()
    && e.date.getFullYear() < now.getFullYear());
  const thisDay = onThisDay.length ? `<div class="card memory"><h2>📅 This day in previous years</h2>
    ${onThisDay.slice(0, 6).map((e) => row(e, true)).join('')}
    ${onThisDay.length > 6 ? `<p class="muted">+ ${onThisDay.length - 6} more</p>` : ''}</div>` : '';

  // Year in review
  const years = [...new Set(events.map((e) => e.date.getFullYear()))].sort((a, b) => b - a);
  if (!years.includes(prefs.reviewYear)) prefs.reviewYear = years.includes(now.getFullYear()) ? now.getFullYear() : years[0];
  const r = yearReview(events, prefs.reviewYear);
  const monthName = (m) => new Date(2000, m, 1).toLocaleDateString([], { month: 'long' });
  const stat = (n, label) => `<div class="tile"><b>${n.toLocaleString()}</b><span>${label}</span></div>`;
  const review = `<div class="card"><div class="card-head"><h2>🏆 Year in review</h2>
      <select id="review-year" aria-label="Year">${years.map((y) => `<option ${y === prefs.reviewYear ? 'selected' : ''}>${y}</option>`).join('')}</select></div>
    <div class="tiles">${stat(r.catches, 'catches')}${stat(r.shinies, 'shinies')}${stat(r.started, 'hunts started')}${stat(r.completed, 'hunts completed')}</div>
    <ul class="review-facts">
      ${r.month ? `<li>Most active month: <b>${monthName(r.month[0])}</b> (${r.month[1]} events)</li>` : ''}
      ${r.best ? `<li>Longest hunt: <b>${esc(r.best.name)}</b> at ${r.best.encounters.toLocaleString()} encounters</li>` : ''}
      ${r.type ? `<li>Top type caught: ${typeBadge(r.type[0])} ×${r.type[1]}</li>` : ''}
    </ul></div>`;

  // Activity, grouped by day
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const label = (d) => {
    const day = new Date(d); day.setHours(0, 0, 0, 0);
    const diff = Math.round((today - day) / 86400000);
    return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : fmtDay(d);
  };
  let feed = '';
  let lastLabel = null;
  for (const e of events.slice(0, timelineShown)) {
    const l = label(e.date);
    if (l !== lastLabel) { feed += `${lastLabel ? '</div>' : ''}<h3 class="tl-day">${l}</h3><div class="card tl-group">`; lastLabel = l; }
    feed += row(e, false);
  }
  feed += '</div>';
  const more = events.length > timelineShown
    ? `<button id="timeline-more" class="wide">Show more (${(events.length - timelineShown).toLocaleString()} older)</button>` : '';

  el.innerHTML = `${thisDay}${review}<h2 class="section-title">Activity</h2>${feed}${more}`;
}
