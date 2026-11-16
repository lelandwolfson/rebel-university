import { html } from '../html.js';
import { page } from '../app.js';
import { workLabel } from '../views.js';
import { clean, normalizeForKey } from '../text.js';
import { boardUnmatched } from '../matching.js';
import { workRef, meetingLine } from './requests.js';

const PAGE = 100;

export default function register(app) {
  const { router, store, places } = app;

  // The board is recomputed only when open requests changed, and at most once
  // per boardMinMs (an hour by default). That bounds the CPU spent on it, and it
  // matches the hour-rounded timestamps: watching the board can't time a post
  // more precisely than the database could (second review, findings 3 and 4).
  let cache = { version: -1, at: -Infinity, lonely: [] };
  const locate = (id) => places.get(id);
  function lonelyRequests() {
    const stale = cache.version !== store.version;
    if (stale && app.now() - cache.at >= (app.config.boardMinMs ?? 3600_000)) {
      cache = { version: store.version, at: app.now(), lonely: boardUnmatched(store.openRequests(), app.distanceKm, locate) };
    }
    return cache.lonely;
  }

  // Illich's bulletin board: works with no match yet, rough area, no names.
  router.get('/board', (ctx) => {
    const { t } = ctx;
    const lonely = lonelyRequests();
    const byWork = new Map();
    for (const r of lonely) {
      if (!byWork.has(r.workId)) byWork.set(r.workId, { areas: new Set(), formats: new Set() });
      const g = byWork.get(r.workId);
      g.areas.add(r.onlineOnly ? t('place.online') : places.regionLabel(r.placeId) || t('place.online'));
      if (r.format !== 'in_person') g.areas.add(t('place.online'));
    }
    const entries = [...byWork.entries()]
      .map(([id, g]) => ({ work: store.getWork(id), areas: [...g.areas].sort() }))
      .filter((e) => e.work && !e.work.held)
      .sort((a, b) => a.work.title.localeCompare(b.work.title)); // alphabetical: no ranking
    const p = Math.max(0, Number.parseInt(ctx.query.get('page') || '0', 10) || 0);
    const shown = entries.slice(p * PAGE, (p + 1) * PAGE);

    page(ctx, {
      title: t('board.title'),
      body: html`<h1>${t('board.title')}</h1>
<p>${t('board.intro')}</p>
${shown.length ? html`<ul class="board">${shown.map((e) => html`<li>
  <p class="work">${workLabel(ctx, e.work)}</p>
  <p class="areas">${e.areas.join(' · ')}</p>
  <p><a href="/request/new/details?w=${encodeURIComponent(workRef(app, { k: 'id', id: e.work.id }))}">${t('board.join')}</a></p>
</li>`)}</ul>` : html`<p>${t('board.empty')}</p>`}
${pager('/board', p, entries.length)}`,
    });
  });

  router.get('/meetings', (ctx) => {
    const { t } = ctx;
    const q = clean(ctx.query.get('q') || '', 100, { keepUrls: true });
    const nq = normalizeForKey(q);
    const p = Math.max(0, Number.parseInt(ctx.query.get('page') || '0', 10) || 0);
    let list = store.upcomingMeetings({ sinceMs: app.now() - 3600 * 1000, limit: 2000 });
    if (nq) list = list.filter((m) => normalizeForKey(`${m.title} ${m.creator}`).includes(nq));
    const shown = list.slice(p * PAGE, (p + 1) * PAGE);
    page(ctx, {
      title: t('meetings.title'),
      body: html`<h1>${t('meetings.title')}</h1>
<p>${t('meetings.intro')}</p>
<form method="get" action="/meetings" class="search" role="search">
  <label>${t('meetings.filter')} <input type="search" name="q" value="${q}" maxlength="100"></label>
  <button type="submit">Filter</button>
</form>
${shown.length ? html`<ul class="meetings">${shown.map((m) => html`<li>
  <a href="/m/${m.id}"><span class="work">${workLabel(ctx, m)}</span><br>${meetingLine(ctx, m)}</a>
</li>`)}</ul>` : html`<p>${t('meetings.empty')}</p>`}
${pager('/meetings', p, list.length, q ? `&q=${encodeURIComponent(q)}` : '')}`,
    });
  });
}

function pager(base, p, total, extra = '') {
  const prev = p > 0 ? html`<a href="${base}?page=${p - 1}${extra}">Previous</a>` : '';
  const next = (p + 1) * PAGE < total ? html`<a href="${base}?page=${p + 1}${extra}">Next</a>` : '';
  return prev || next ? html`<nav class="pager">${prev} ${next}</nav>` : '';
}
