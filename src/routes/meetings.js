import { html } from '../html.js';
import { page, redirect, checkForm, allowWrite, allowScoped, tokenLookupAllowed } from '../app.js';
import { HttpError } from '../http.js';
import { guard, powScript, workLabel, errorBox, noticeBox, field, formatLabel, tips } from '../views.js';
import { newToken, hashToken, isTokenShape, randomId } from '../security.js';
import { clean, safeHttpsUrl } from '../text.js';
import { zonedToUtc, utcToZoned, formatInZone, timeZones, isTimeZone } from '../tz.js';
import { loadRequest } from './requests.js';
import { notifyNewMeeting, background } from '../notify.js';

export const MAX_ATTENDEES = 100;
const REASONS = ['unsafe', 'spam', 'participant', 'other'];

// Block keys for "this address in this meeting", in both tiers. A removal
// blocks the /64 and its /48 (usually one household on IPv6).
function kickKeys(ctx, meetingId) {
  const l = ctx.app.limiter;
  return [l.scoped(ctx.ipKey, `kick:${meetingId}`), l.scoped(ctx.ipKey48, `kick48:${meetingId}`)];
}

// Checked with today's and yesterday's address keys, so the block outlives the
// daily key rotation (second review, finding 9).
function isKicked(ctx, meetingId) {
  const l = ctx.app.limiter;
  const keys = [
    ...kickKeys(ctx, meetingId),
    l.scopedPrev(ctx.ipKeyPrev, `kick:${meetingId}`), l.scopedPrev(ctx.ipKey48Prev, `kick48:${meetingId}`),
    // a block written yesterday with yesterday's keys, checked against today's address
    ctx.ipKeyPrev && l.scoped(ctx.ipKeyPrev, `kick:${meetingId}`), ctx.ipKey48Prev && l.scoped(ctx.ipKey48Prev, `kick48:${meetingId}`),
  ];
  return keys.some((k) => k && l.count('kicked', k) > 0);
}

function isMeetingId(id) { return typeof id === 'string' && /^[A-Za-z0-9_-]{12}$/.test(id); }

function validateMeeting(ctx, b, { placeId, needName }) {
  const { app } = ctx;
  const allowed = placeId != null ? ['in_person', 'video', 'both'] : ['video'];
  const format = allowed.includes(b.format) ? b.format : null;
  if (!format) return { error: placeId != null ? 'Please choose a format.' : 'Without a city, the meeting can only be on video.' };
  const tz = isTimeZone(b.tz) ? b.tz : null;
  if (!tz) return { error: 'Please choose a time zone.' };
  const startsUtc = zonedToUtc(b.date, b.time, tz);
  if (startsUtc == null) return { error: 'Please give a date and time.' };
  if (startsUtc < app.now()) return { error: 'That time has already passed.' };
  if (startsUtc > app.now() + 366 * 24 * 3600 * 1000) return { error: 'Please pick a date within the next year.' };
  const inPerson = format !== 'video';
  const video = format !== 'in_person';
  const venue = inPerson ? clean(b.venue, 120) : '';
  if (inPerson && venue.length < 2) return { error: 'Please name the public place where you will meet.' };
  let videoUrl = '';
  if (video) {
    videoUrl = safeHttpsUrl(b.video_url || '');
    if (!videoUrl) return { error: 'Please paste a full https:// video meeting link.' };
  }
  const note = clean(b.note, 280);
  const name = clean(b.name, 40);
  if (needName && name.length < 1) return { error: 'Please choose a name for this meeting.' };
  return { values: { format, tz, startsUtc, venue, videoUrl, note, name, placeId } };
}

function meetingFields(ctx, v, { placeId, defaultTz, needName }) {
  const { t } = ctx;
  const formats = placeId != null ? ['in_person', 'video', 'both'] : ['video'];
  const tz = v.tz || defaultTz || 'UTC';
  return html`
  <div class="row">
    ${field(t('meeting.date'), html`<input type="date" name="date" value="${v.date || ''}" required>`)}
    ${field(t('meeting.time'), html`<input type="time" name="time" value="${v.time || ''}" required>`)}
  </div>
  ${field(t('meeting.tz'), html`<select name="tz" required${!v.tz && !defaultTz ? html` data-guess` : ''}>${[...timeZones()].map((z) => html`<option${z === tz ? ' selected' : ''}>${z}</option>`)}</select>`)}
  <fieldset>
    <legend>${t('meeting.format')}</legend>
    ${formats.map((f) => html`<label class="radio"><input type="radio" name="format" value="${f}"${(v.format || formats[0]) === f ? ' checked' : ''}> ${formatLabel(ctx, f)}</label>`)}
  </fieldset>
  ${placeId != null ? field(t('meeting.venue'), html`<input name="venue" value="${v.venue || ''}" maxlength="120">`, t('meeting.venue.hint')) : ''}
  ${field(t('meeting.video'), html`<input type="url" name="video_url" value="${v.video_url ?? v.videoUrl ?? ''}" maxlength="300" placeholder="https://">`, t('meeting.video.hint'))}
  ${field(t('meeting.note'), html`<textarea name="note" maxlength="280" rows="3">${v.note || ''}</textarea>`, t('meeting.note.hint'))}
  ${needName ? field(t('meeting.name'), html`<input name="name" value="${v.name || ''}" maxlength="40" required autocomplete="off">`, t('meeting.name.hint')) : ''}`;
}

async function loadAttendee(ctx) {
  const { token } = ctx.params;
  if (!tokenLookupAllowed(ctx)) throw new HttpError(429);
  if (!isTokenShape(token)) throw new HttpError(404);
  const a = ctx.app.store.attendeeByToken(hashToken(token));
  if (!a) throw new HttpError(404, 'meeting.removed');
  const m = ctx.app.store.getMeeting(a.meetingId);
  if (!m) throw new HttpError(404);
  return { a, m, work: ctx.app.store.getWork(m.workId), token };
}

function whereLabel(ctx, m) {
  const city = m.placeId ? ctx.app.places.cityLabel(m.placeId) : null;
  if (m.format === 'video' || !city) return ctx.t('place.online');
  return m.format === 'both' ? `${city} + ${ctx.t('format.video').toLowerCase()}` : city;
}

export default function register(app) {
  const { router, store } = app;

  // ---- start a meeting (from a request)
  function newMeetingPage(ctx, r, v = {}, error = null, status = 200) {
    const { t } = ctx;
    const work = store.getWork(r.workId);
    const placeId = r.onlineOnly ? null : r.placeId;
    const defaultTz = placeId ? app.places.get(placeId)?.tz : null;
    page(ctx, {
      title: t('meeting.new.title'),
      noindex: true,
      status,
      body: html`<h1>${t('meeting.new.title')}</h1>
<p class="work">${workLabel(ctx, work)}</p>
${errorBox(error)}
<div class="split">
<form method="post" action="/r/${ctx.params.token}/meet" data-pow>
  ${meetingFields(ctx, v, { placeId, defaultTz, needName: true })}
  ${guard(ctx, { pow: true })}
  <button type="submit">${t('meeting.create')}</button>
  <p class="pow-status" aria-live="polite"></p>
</form>
${tips(ctx, { bring: true, compact: true })}
</div>
${powScript(ctx)}`,
    });
  }

  router.get('/r/:token/meet', async (ctx) => {
    const r = await loadRequest(ctx);
    if (r.status !== 'open') throw new HttpError(404);
    newMeetingPage(ctx, r);
  });

  router.post('/r/:token/meet', async (ctx) => {
    const r = await loadRequest(ctx);
    if (r.status !== 'open') throw new HttpError(404);
    const err = checkForm(ctx, { pow: true });
    if (err) return newMeetingPage(ctx, r, ctx.body, err, 400);
    if (!allowWrite(ctx, 'meeting', 6) || !app.limiter.hit('meet-per-link', r.id, 5, 24 * 3600 * 1000)) {
      return newMeetingPage(ctx, r, ctx.body, ctx.t('err.rate'), 429);
    }
    const res = validateMeeting(ctx, ctx.body, { placeId: r.onlineOnly ? null : r.placeId, needName: true });
    if (res.error) return newMeetingPage(ctx, r, ctx.body, res.error, 400);
    const v = res.values;
    const token = newToken();
    const meeting = store.createMeeting({
      id: randomId(9), workId: r.workId, placeId: v.placeId, format: v.format, startsUtc: v.startsUtc, tz: v.tz,
      venue: v.venue, videoUrl: v.videoUrl, note: v.note, organizerTokenHash: hashToken(token), organizerName: v.name,
    });
    app.recordWrite(ctx.ipKey, ctx.ipKey48);
    background(app, notifyNewMeeting(app, meeting, store.getWork(r.workId), r.id));
    redirect(ctx, `/a/${token}?new=1`);
  });

  // ---- public meeting page
  function publicMeetingPage(ctx, m, { error = null, name = '', status = 200 } = {}) {
    const { t } = ctx;
    const work = store.getWork(m.workId);
    if (!work || work.held) throw new HttpError(404);
    const past = m.startsUtc < app.now() - 3600 * 1000;
    const full = store.attendeeCount(m.id) >= MAX_ATTENDEES;
    let state = null;
    if (m.status === 'cancelled') state = t('meeting.cancelled');
    else if (past) state = t('meeting.past');
    else if (m.status === 'closed') state = t('meeting.closedToNew');
    else if (full) state = t('meeting.full');
    page(ctx, {
      title: work.title,
      status,
      body: html`<h1>${workLabel(ctx, work)}</h1>
<section class="card">
  <p><strong>${formatInZone(m.startsUtc, m.tz)}</strong></p>
  <p>${whereLabel(ctx, m)} · ${formatLabel(ctx, m.format)}</p>
</section>
${state ? html`<p class="notice">${state}</p>` : html`
<div class="split">
<form method="post" action="/m/${m.id}/join" data-pow>
  <h2>${t('meeting.join')}</h2>
  ${errorBox(error)}
  <p>${t('meetings.intro')}</p>
  ${field(t('meeting.name'), html`<input name="name" value="${name}" maxlength="40" required autocomplete="off">`, t('meeting.name.hint'))}
  ${guard(ctx, { pow: true })}
  <button type="submit">${t('meeting.join.button')}</button>
  <p class="pow-status" aria-live="polite"></p>
</form>
${tips(ctx, { bring: m.format !== 'video', compact: true })}
</div>
${powScript(ctx)}`}
<p class="quiet"><a href="/m/${m.id}/report">${t('meeting.report')}</a></p>`,
    });
  }

  router.get('/m/:id', (ctx) => {
    if (!isMeetingId(ctx.params.id)) throw new HttpError(404);
    const m = store.getMeeting(ctx.params.id);
    if (!m) throw new HttpError(404);
    publicMeetingPage(ctx, m);
  });

  router.post('/m/:id/join', (ctx) => {
    if (!isMeetingId(ctx.params.id)) throw new HttpError(404);
    const m = store.getMeeting(ctx.params.id);
    if (!m) throw new HttpError(404);
    const name = ctx.body.name || '';
    const err = checkForm(ctx, { pow: true });
    if (err) return publicMeetingPage(ctx, m, { error: err, name, status: 400 });
    if (!allowWrite(ctx, 'join', 30)) return publicMeetingPage(ctx, m, { error: ctx.t('err.rate'), name, status: 429 });
    if (isKicked(ctx, m.id) || !allowScoped(ctx, 'join-meeting', `meet:${m.id}`, 3, 24 * 3600 * 1000)) {
      return publicMeetingPage(ctx, m, { error: 'You cannot join this meeting again from here.', name, status: 429 });
    }
    if (m.status !== 'open' || m.startsUtc < app.now() - 3600 * 1000 || store.attendeeCount(m.id) >= MAX_ATTENDEES) {
      return publicMeetingPage(ctx, m, { status: 409 });
    }
    const display = clean(name, 40);
    if (!display) return publicMeetingPage(ctx, m, { error: 'Please choose a name for this meeting.', name, status: 400 });
    const token = newToken();
    const attendeeId = store.addAttendee(m.id, hashToken(token), display);
    // Memory only, for 24 hours: lets an organizer's removal stick.
    // Memory only, for 24 hours, so an organizer's removal sticks. Stores only the
    // per-meeting block keys, which can't be linked to anything else.
    app.joinedFrom.set(attendeeId, { keys: kickKeys(ctx, m.id), until: app.now() + 24 * 3600 * 1000 });
    if (app.joinedFrom.size > 100_000) app.joinedFrom.delete(app.joinedFrom.keys().next().value);
    app.recordWrite(ctx.ipKey, ctx.ipKey48);
    redirect(ctx, `/a/${token}?new=1`);
  });

  // ---- report
  function reportPage(ctx, m, { error = null, status = 200, done = false } = {}) {
    const { t } = ctx;
    const reasons = t('report.reasons');
    page(ctx, {
      title: t('report.title'),
      status,
      noindex: true,
      body: done ? html`<h1>${t('report.title')}</h1><p>${t('report.thanks')}</p><p><a href="/m/${m.id}">Back to the meeting</a></p>` : html`<h1>${t('report.title')}</h1>
${errorBox(error)}
<form method="post" action="/m/${m.id}/report" data-pow>
  <fieldset><legend>${t('report.reason')}</legend>
  ${REASONS.map((r, i) => html`<label class="radio"><input type="radio" name="reason" value="${r}"${i === 0 ? ' checked' : ''}> ${reasons[r]}</label>`)}
  </fieldset>
  ${field(t('report.text'), html`<textarea name="text" maxlength="500" rows="4"></textarea>`)}
  ${guard(ctx, { pow: true })}
  <button type="submit">${t('report.submit')}</button>
  <p class="pow-status" aria-live="polite"></p>
</form>
${powScript(ctx)}`,
    });
  }

  router.get('/m/:id/report', (ctx) => {
    if (!isMeetingId(ctx.params.id)) throw new HttpError(404);
    const m = store.getMeeting(ctx.params.id);
    if (!m) throw new HttpError(404);
    reportPage(ctx, m);
  });

  router.post('/m/:id/report', (ctx) => {
    if (!isMeetingId(ctx.params.id)) throw new HttpError(404);
    const m = store.getMeeting(ctx.params.id);
    if (!m) throw new HttpError(404);
    const err = checkForm(ctx, { pow: true });
    if (err) return reportPage(ctx, m, { error: err, status: 400 });
    if (!allowWrite(ctx, 'report', 10)) return reportPage(ctx, m, { error: ctx.t('err.rate'), status: 429 });
    const reason = REASONS.includes(ctx.body.reason) ? ctx.body.reason : 'other';
    if (store.reportCountForMeeting(m.id) < 50) store.addReport(m.id, reason, clean(ctx.body.text, 500));
    app.recordWrite(ctx.ipKey, ctx.ipKey48);
    reportPage(ctx, m, { done: true });
  });

  // ---- attendee page (private)
  function attendeePage(ctx, { a, m, work, token }, { error = null, notice = null, status = 200, edit = null } = {}) {
    const { t } = ctx;
    const people = store.attendees(m.id);
    const inPerson = m.format !== 'video';
    const video = m.format !== 'in_person';
    const cancelled = m.status === 'cancelled';
    const z = utcToZoned(m.startsUtc, m.tz);
    const editValues = edit || { date: z.date, time: z.time, tz: m.tz, format: m.format, venue: m.venue, videoUrl: m.videoUrl, note: m.note };
    const fresh = ctx.query.get('new');

    page(ctx, {
      title: work.title,
      noindex: true,
      status,
      body: html`<h1>${workLabel(ctx, work)}</h1>
${noticeBox(fresh ? t('meeting.privateLink') : notice)}
${errorBox(error)}
${cancelled ? html`<p class="notice">${t('meeting.cancelled')}</p>` : ''}
<section class="card">
  <p><strong>${formatInZone(m.startsUtc, m.tz)}</strong></p>
  <p>${whereLabel(ctx, m)} · ${formatLabel(ctx, m.format)}${m.status === 'closed' ? html` · <em>${t('meeting.closedToNew')}</em>` : ''}</p>
  ${!cancelled && inPerson ? html`<p><strong>${t('meeting.venue')}:</strong> ${m.venue}</p><p>${t('meet.bring')}</p>` : ''}
  ${!cancelled && video ? html`<p><strong>${t('meeting.video')}:</strong> <a href="${m.videoUrl}" rel="noopener noreferrer nofollow">${m.videoUrl}</a></p><p class="hint">${t('meeting.leavingSite')}</p>` : ''}
  ${work.link ? html`<p><strong>${t('meeting.workLink')}:</strong> <a href="${work.link}" rel="noopener noreferrer nofollow">${work.link}</a></p><p class="hint">${t('meeting.leavingSite')}</p>` : ''}
  ${m.note ? html`<blockquote class="note">${m.note}</blockquote>` : ''}
  ${!cancelled ? html`<p><a href="/a/${token}/ics">${t('meeting.ics')}</a></p>` : ''}
</section>

<section>
  <h2>${t('meeting.people')}</h2>
  <ul class="people">${people.map((p) => html`<li>${p.displayName}${p.isOrganizer ? html` <span class="tag">${t('meeting.organizer')}</span>` : ''}${p.id === a.id ? ' (you)' : ''}
    ${a.isOrganizer && !p.isOrganizer && !cancelled ? html`<form method="post" action="/a/${token}/remove" class="inline">${guard(ctx)}<input type="hidden" name="attendee" value="${p.id}"><button class="link" type="submit">${t('meeting.remove')}</button></form>` : ''}</li>`)}</ul>
</section>

${a.isOrganizer && !cancelled ? html`<section class="tools">
  <h2>${t('meeting.tools')}</h2>
  <p class="hint">${t('meeting.toolsHint')}</p>
  <details${edit ? ' open' : ''}><summary>${t('meeting.editSummary')}</summary>
  <form method="post" action="/a/${token}/edit">
    ${meetingFields(ctx, editValues, { placeId: m.placeId, defaultTz: m.tz, needName: false })}
    ${guard(ctx)}
    <button type="submit">${t('meeting.edit')}</button>
  </form>
  </details>
  <form method="post" action="/a/${token}/close" class="inline">${guard(ctx)}<button class="secondary" type="submit">${m.status === 'closed' ? t('meeting.reopen') : t('meeting.closeToNew')}</button></form>
  <form method="post" action="/a/${token}/cancel" class="inline">${guard(ctx)}<button class="danger" type="submit">${t('meeting.cancel')}</button></form>
</section>` : ''}

${!a.isOrganizer ? html`<form method="post" action="/a/${token}/leave">${guard(ctx)}<button class="secondary" type="submit">${t('meeting.leave')}</button></form>` : ''}
${tips(ctx, { bring: inPerson })}
<p class="quiet"><a href="/m/${m.id}/report">${t('meeting.report')}</a></p>`,
    });
  }

  router.get('/a/:token', async (ctx) => attendeePage(ctx, await loadAttendee(ctx)));

  router.get('/a/:token/ics', async (ctx) => {
    const { m, work } = await loadAttendee(ctx);
    if (m.status === 'cancelled') throw new HttpError(404);
    const body = ics(app, m, work);
    ctx.res.writeHead(200, {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="rebel-university-meeting.ics"',
      'Cache-Control': 'no-store',
    });
    ctx.res.end(body);
  });

  router.post('/a/:token/leave', async (ctx) => {
    const { a, m } = await loadAttendee(ctx);
    if (checkForm(ctx)) throw new HttpError(400, 'err.form');
    if (a.isOrganizer) throw new HttpError(400);
    store.removeAttendee(m.id, a.id);
    page(ctx, { title: ctx.t('meeting.left'), noindex: true, body: html`<h1>${ctx.t('meeting.left')}</h1><p><a href="/">Home</a></p>` });
  });

  const organizerOnly = async (ctx) => {
    const d = await loadAttendee(ctx);
    if (!d.a.isOrganizer) throw new HttpError(404);
    if (checkForm(ctx)) throw new HttpError(400, 'err.form');
    if (d.m.status === 'cancelled') throw new HttpError(400);
    return d;
  };

  router.post('/a/:token/edit', async (ctx) => {
    const d = await organizerOnly(ctx);
    if (!allowWrite(ctx, 'edit', 30)) return attendeePage(ctx, d, { error: ctx.t('err.rate'), status: 429, edit: ctx.body });
    const res = validateMeeting(ctx, ctx.body, { placeId: d.m.placeId, needName: false });
    if (res.error) return attendeePage(ctx, d, { error: res.error, status: 400, edit: ctx.body });
    store.updateMeeting(d.m.id, res.values);
    redirect(ctx, `/a/${d.token}`);
  });

  router.post('/a/:token/close', async (ctx) => {
    const d = await organizerOnly(ctx);
    store.setMeetingStatus(d.m.id, d.m.status === 'closed' ? 'open' : 'closed');
    redirect(ctx, `/a/${d.token}`);
  });

  router.post('/a/:token/cancel', async (ctx) => {
    const d = await organizerOnly(ctx);
    store.setMeetingStatus(d.m.id, 'cancelled');
    redirect(ctx, `/a/${d.token}`);
  });

  router.post('/a/:token/remove', async (ctx) => {
    const d = await organizerOnly(ctx);
    const id = Number(ctx.body.attendee);
    if (Number.isInteger(id) && store.removeAttendee(d.m.id, id)) {
      const from = app.joinedFrom.get(id);
      if (from) for (const k of from.keys) app.limiter.seen('kicked', k, 24 * 3600 * 1000);
      app.joinedFrom.delete(id);
    }
    redirect(ctx, `/a/${d.token}`);
  });
}

// ---- iCalendar
function icsEscape(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}
function fold(line) {
  const out = [];
  let cur = '';
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > 73) { out.push(cur); cur = ' '; }
    cur += ch;
  }
  out.push(cur);
  return out.join('\r\n');
}
const icsTime = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

export function ics(app, m, work) {
  const { t } = app;
  const host = new URL(app.config.baseUrl).hostname;
  const desc = [
    `Discuss "${work.title}"${work.creator ? ` by ${work.creator}` : ''}.`,
    m.format !== 'in_person' ? `Video link: ${m.videoUrl}` : '',
    m.format !== 'video' ? t('meet.bring') : '',
    m.note ? `Note from the organizer: ${m.note}` : '',
    t('meet.tips').join(' '),
  ].filter(Boolean).join('\n');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Rebel University//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${m.id}@${host}`,
    `DTSTAMP:${icsTime(app.now())}`,
    `DTSTART:${icsTime(m.startsUtc)}`,
    'DURATION:PT1H',
    `SUMMARY:${icsEscape(`Rebel University: ${work.title}`)}`,
    m.format !== 'video' ? `LOCATION:${icsEscape(m.venue)}` : (m.videoUrl ? `LOCATION:${icsEscape(m.videoUrl)}` : ''),
    `DESCRIPTION:${icsEscape(desc)}`,
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean);
  return lines.map(fold).join('\r\n') + '\r\n';
}
