import { html } from '../html.js';
import { page, redirect, checkForm, allowWrite, tokenLookupAllowed } from '../app.js';
import { HttpError } from '../http.js';
import { guard, powScript, workLabel, errorBox, noticeBox, field, formatLabel } from '../views.js';
import { newToken, hashToken, isTokenShape, signValue, verifyValue, encrypt } from '../security.js';
import { clean, safeHttpsUrl, emailShape } from '../text.js';
import { KINDS, bookNormKey, manualNormKey, isOlWorkKey } from '../works.js';
import { matchesFor, meetingFitsRequest } from '../matching.js';
import { sendConfirmation, notifyNewRequest, background } from '../notify.js';

const FORMATS = ['either', 'in_person', 'video'];

// A signed reference to a chosen work travels through the URL and forms.
export function workRef(app, value) { return signValue(app.config.keys.sign, value); }

function resolveRef(app, signed) {
  const v = verifyValue(app.config.keys.sign, signed);
  if (!v) return null;
  if (v.k === 'ol' && isOlWorkKey(v.ol) && typeof v.t === 'string') {
    return { kind: 'book', olKey: v.ol, title: clean(v.t, 300, { keepUrls: true }), creator: clean(v.c || '', 200, { keepUrls: true }) };
  }
  if (v.k === 'id' && Number.isInteger(v.id)) {
    const w = app.store.getWork(v.id);
    return w && !w.held ? w : null;
  }
  return null;
}

export async function loadRequest(ctx) {
  const { token } = ctx.params;
  if (!tokenLookupAllowed(ctx)) throw new HttpError(429);
  if (!isTokenShape(token)) throw new HttpError(404);
  const r = ctx.app.store.requestByToken(hashToken(token));
  if (!r) throw new HttpError(404);
  return r;
}

export default function register(app) {
  const { router } = app;

  // Step 1: choose a work.
  router.get('/request/new', async (ctx) => {
    const { t } = ctx;
    const q = clean(ctx.query.get('q') || '', 120, { keepUrls: true });
    let results = null;
    let error = null;
    if (q.length >= 2) {
      if (!app.limiter.hit('olsearch', ctx.ipKey, 40, 10 * 60 * 1000)) throw new HttpError(429);
      try { results = await app.openLibrary.search(q); } catch { error = t('err.lookup'); }
    }
    page(ctx, {
      title: t('request.title'),
      body: html`<h1>${t('request.title')}</h1>
<p>${t('site.tagline')} ${t('site.adults')}</p>
<form method="get" action="/request/new" class="search" role="search">
  ${field(t('request.search.label'), html`<input type="search" name="q" value="${q}" maxlength="120" required autofocus>`)}
  <button type="submit">${t('request.search.button')}</button>
</form>
${errorBox(error)}
${results ? (results.length ? html`<ul class="results">${results.map((r) => html`<li>
  <a class="choose" href="/request/new/details?w=${encodeURIComponent(workRef(app, { k: 'ol', ol: r.olKey, t: r.title, c: r.creator }))}">
    ${workLabel(ctx, { title: r.title, creator: r.creator, kind: 'book' })}${r.year ? html` <span class="year">(${r.year})</span>` : ''}
  </a></li>`)}</ul>` : html`<p>${t('request.search.none')}</p>`) : ''}
<p><a href="/request/new/details?manual=1">${t('request.manual.link')}</a></p>`,
    });
  });

  // Step 2: place, format, optional email.
  router.get('/request/new/details', (ctx) => detailsPage(ctx, {
    w: ctx.query.get('w') || '',
    manual: ctx.query.get('manual') === '1' || !ctx.query.get('w'),
    placeQ: ctx.query.get('place_q') || '',
  }));

  router.post('/request', async (ctx) => {
    const { t, store, places, config } = { ...app, t: ctx.t };
    const b = ctx.body;
    const values = {
      w: b.w || '', manual: !b.w, placeQ: b.place_q || '', place: b.place || '', format: b.format || 'either',
      email: b.email || '', kind: b.kind || '', title: b.title || '', creator: b.creator || '', link: b.link || '',
    };
    const fail = (msg, status = 400) => detailsPage(ctx, { ...values, error: msg, status });

    const formErr = checkForm(ctx, { pow: true });
    if (formErr) return fail(formErr);
    if (!allowWrite(ctx, 'request', 12)) return fail(t('err.rate'), 429);

    // The work.
    let work;
    if (b.w) {
      const ref = resolveRef(app, b.w);
      if (!ref) return fail(t('err.form'));
      work = ref.id ? ref : store.findOrCreateWork({ ...ref, normKey: bookNormKey(ref.olKey) });
    } else {
      const kind = KINDS.includes(b.kind) ? b.kind : null;
      const title = clean(b.title, 200);
      const creator = clean(b.creator, 120);
      let link = null;
      if (b.link && b.link.trim()) {
        link = safeHttpsUrl(b.link);
        if (!link) return fail('The link must be a full https:// address.');
      }
      if (!kind || title.length < 1 || creator.length < 1) return fail('Please give the kind of work, its title, and its author or creator.');
      work = store.findOrCreateWork({ kind, title, creator, link, normKey: manualNormKey(kind, title, creator), held: store.holdManual() });
    }

    // Place and format.
    let placeId = null;
    let onlineOnly = false;
    let format = FORMATS.includes(b.format) ? b.format : null;
    if (b.place === 'online') {
      onlineOnly = true;
      format = 'video';
    } else {
      const p = places.get(b.place);
      if (!p) return fail(t('request.place.searchFirst'));
      placeId = p.id;
    }
    if (!format) return fail('Please choose how you want to meet.');

    let emailEnc = null;
    let email = null;
    if (b.email && b.email.trim()) {
      email = emailShape(b.email);
      if (!email) return fail('That email address does not look right. You can also leave it empty.');
      emailEnc = encrypt(config.keys.email, email);
    }

    if (app.limiter.seen('dup', `${ctx.ipKey}|${work.id}|${placeId ?? 'online'}`, 60 * 60 * 1000)) return fail(t('err.duplicate'), 429);

    const token = newToken();
    const request = store.createRequest({
      tokenHash: hashToken(token), workId: work.id, placeId, onlineOnly, format, emailEnc,
      status: work.held ? 'held' : 'open',
    });
    app.recordWrite(ctx.ipKey);

    const matchCount = request.status === 'open'
      ? matchesFor(request, store.openRequestsForWork(work.id), app.distanceKm).length : 0;
    if (email) background(app, sendConfirmation(app, { email, token, work, matchCount }));
    background(app, notifyNewRequest(app, request, work));
    redirect(ctx, `/r/${token}?new=1`);
  });

  // The private request page.
  router.get('/r/:token', async (ctx) => {
    const r = await loadRequest(ctx);
    const { t } = ctx;
    const { store, places } = app;
    const work = store.getWork(r.workId);
    const token = ctx.params.token;
    const others = r.status === 'open' ? matchesFor(r, store.openRequestsForWork(r.workId), app.distanceKm) : [];
    const meetings = r.status === 'open'
      ? store.upcomingMeetings({ sinceMs: app.now() - 3 * 3600 * 1000, workId: r.workId }).filter((m) => meetingFitsRequest(r, m, app.distanceKm))
      : [];
    const area = r.onlineOnly ? t('place.online') : places.label(r.placeId) || '';
    const expires = new Date(r.expiresHour * 3600 * 1000).toISOString().slice(0, 10);
    const notice = ctx.query.get('new') ? t('manage.saveLink') : ctx.query.get('email') === 'removed' ? t('manage.email.removed') : null;

    page(ctx, {
      title: t('manage.title'),
      noindex: true,
      body: html`<h1>${t('manage.title')}</h1>
${noticeBox(notice)}
<section class="card">
  <p class="work">${workLabel(ctx, work)}</p>
  <p>${area} · ${formatLabel(ctx, r.format)}</p>
  <p class="hint">${t('manage.expires', { date: expires })}</p>
</section>
${r.status === 'held' ? html`<p class="notice">${t('manage.held')}</p>` : html`
<section>
  <h2>${others.length === 1 ? t('manage.matches.one') : others.length ? t('manage.matches.some', { n: others.length }) : t('manage.matches.none')}</h2>
  <h3>${t('manage.meetings')}</h3>
  ${meetings.length ? html`<ul class="meetings">${meetings.map((m) => html`<li><a href="/m/${m.id}">${meetingLine(ctx, m)}</a></li>`)}</ul>` : html`<p>${t('manage.meetings.none')}</p>`}
  <p><a class="button" href="/r/${token}/meet">${t('manage.start')}</a></p>
</section>`}
<section class="quiet">
  ${r.emailEnc ? html`<form method="post" action="/r/${token}/email">${guard(ctx)}<p>${t('manage.email.set')} <button class="link" type="submit">${t('manage.email.remove')}</button></p></form>` : ''}
  <form method="post" action="/r/${token}/close">${guard(ctx)}<button class="secondary" type="submit">${t('manage.close')}</button></form>
  <p><a href="/request/new">Post another request</a></p>
</section>`,
    });
  });

  router.post('/r/:token/close', async (ctx) => {
    const r = await loadRequest(ctx);
    if (checkForm(ctx)) throw new HttpError(400, 'err.form');
    app.store.deleteRequest(r.id);
    page(ctx, { title: ctx.t('manage.closed'), noindex: true, body: html`<h1>${ctx.t('manage.closed')}</h1><p><a href="/request/new">Post another request</a></p>` });
  });

  router.post('/r/:token/email', async (ctx) => {
    const r = await loadRequest(ctx);
    if (checkForm(ctx)) throw new HttpError(400, 'err.form');
    app.store.clearRequestEmail(r.id);
    redirect(ctx, `/r/${ctx.params.token}?email=removed`);
  });
}

export function meetingLine(ctx, m) {
  const { t, app } = ctx;
  const where = m.placeId ? app.places.cityLabel(m.placeId) : t('place.online');
  const when = new Intl.DateTimeFormat('en-GB', { timeZone: m.tz, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(m.startsUtc));
  return html`${when} (${m.tz.replace(/_/g, ' ')}) · ${where} · ${formatLabel(ctx, m.format)}${m.status === 'closed' ? html` · <em>closed to new people</em>` : ''}`;
}

function detailsPage(ctx, v) {
  const { app, t } = ctx;
  const ref = v.w ? resolveRef(app, v.w) : null;
  if (v.w && !ref) throw new HttpError(404);
  const manual = !ref;
  const placeQ = clean(v.placeQ || '', 100);
  let found = placeQ ? app.places.search(placeQ) : [];
  const chosen = v.place && v.place !== 'online' ? app.places.get(v.place) : null;
  if (chosen && !found.some((p) => p.id === chosen.id)) found = [chosen, ...found];
  const placeVal = v.place || (found.length === 1 ? String(found[0].id) : '');
  const format = v.format || 'either';

  page(ctx, {
    title: t('request.title'),
    status: v.status || 200,
    body: html`<h1>${t('request.title')}</h1>
${errorBox(v.error)}
${ref ? html`<section class="card"><h2>${t('request.work.chosen')}</h2><p class="work">${workLabel(ctx, ref)}</p><p><a href="/request/new">Choose a different work</a></p></section>` : ''}

<section>
  <h2>${t('request.place.title')}</h2>
  <form method="get" action="/request/new/details" class="search">
    ${ref ? html`<input type="hidden" name="w" value="${v.w}">` : html`<input type="hidden" name="manual" value="1">`}
    ${field(t('request.place.label'), html`<input type="search" name="place_q" value="${placeQ}" maxlength="100" autocomplete="address-level2">`, t('request.place.hint'))}
    <button type="submit">${t('request.place.button')}</button>
  </form>
  ${placeQ && !found.length ? html`<p>${t('request.place.none')}</p>` : ''}
</section>

<form method="post" action="/request" data-pow>
  ${ref ? html`<input type="hidden" name="w" value="${v.w}">` : ''}
  <input type="hidden" name="place_q" value="${placeQ}">
  ${manual ? html`<fieldset>
    <legend>${t('request.work.chosen')}</legend>
    ${field(t('request.manual.kind'), html`<select name="kind" required>
      ${['article', 'film', 'recording', 'book'].map((k) => html`<option value="${k}"${v.kind === k ? ' selected' : ''}>${t(`kind.${k}`)}</option>`)}
    </select>`)}
    ${field(t('request.manual.title'), html`<input name="title" value="${v.title || ''}" maxlength="200" required>`)}
    ${field(t('request.manual.creator'), html`<input name="creator" value="${v.creator || ''}" maxlength="120" required>`)}
    ${field(t('request.manual.link'), html`<input type="url" name="link" value="${v.link || ''}" maxlength="300" inputmode="url" placeholder="https://">`, t('request.manual.linkHint'))}
  </fieldset>` : ''}

  <fieldset>
    <legend>${t('request.place.title')}</legend>
    ${found.map((p) => html`<label class="radio"><input type="radio" name="place" value="${p.id}"${placeVal === String(p.id) ? ' checked' : ''} required> ${app.places.label(p.id)}</label>`)}
    ${!found.length ? html`<p class="hint">${t('request.place.searchFirst')}</p>` : ''}
    <label class="radio"><input type="radio" name="place" value="online"${placeVal === 'online' ? ' checked' : ''} required> ${t('request.place.online')}</label>
  </fieldset>

  <fieldset>
    <legend>${t('request.format')}</legend>
    ${FORMATS.map((f) => html`<label class="radio"><input type="radio" name="format" value="${f}"${format === f ? ' checked' : ''}> ${t(`format.${f}`)}</label>`)}
    <p class="hint">If you chose online only, the meeting will be on video.</p>
  </fieldset>

  ${field(t('request.email.label'), html`<input type="email" name="email" value="${v.email || ''}" maxlength="254" autocomplete="email">`, t('request.email.hint'))}
  <p class="adults">${t('request.adults')}</p>
  ${guard(ctx, { pow: true })}
  <button type="submit">${t('request.submit')}</button>
  <p class="pow-status" aria-live="polite"></p>
</form>
${powScript()}`,
  });
}
