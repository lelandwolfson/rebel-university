import crypto from 'node:crypto';
import { html } from '../html.js';
import { page, redirect, checkForm } from '../app.js';
import { HttpError, cookieString } from '../http.js';
import { guard, errorBox, noticeBox } from '../views.js';
import { safeEqual, hashToken } from '../security.js';

const SESSION_MS = 2 * 3600 * 1000;

const hourLabel = (h) => new Date(h * 3600 * 1000).toISOString().slice(0, 13).replace('T', ' ') + 'h';

export default function register(app) {
  const { router, store, config, places } = app;
  const cookieName = config.secureCookies ? '__Host-admin' : 'admin';

  function enabled() { if (!config.adminSecret) throw new HttpError(404); }

  function session(ctx) {
    const v = ctx.cookies[cookieName];
    if (!v || !/^[A-Za-z0-9_-]{43}$/.test(v)) return false;
    const exp = app.adminSessions.get(hashToken(v));
    if (!exp || exp < app.now()) { app.adminSessions.delete(hashToken(v)); return false; }
    return true;
  }

  function loginPage(ctx, error = null, status = 200) {
    page(ctx, {
      title: 'Admin', noindex: true, status,
      body: html`<h1>Admin</h1>${errorBox(error)}
<form method="post" action="/admin/login">
  <label>Admin secret <input type="password" name="secret" required autocomplete="current-password"></label>
  ${guard(ctx)}
  <button type="submit">Sign in</button>
</form>`,
    });
  }

  router.get('/admin', (ctx) => {
    enabled();
    if (!session(ctx)) return loginPage(ctx);
    dashboard(ctx);
  });

  router.post('/admin/login', (ctx) => {
    enabled();
    const okIp = app.limiter.hit('admin-login', ctx.ipKey, 5, 15 * 60 * 1000);
    const okAll = app.limiter.hit('admin-login', '*', 30, 15 * 60 * 1000);
    if (!okIp || !okAll) return loginPage(ctx, ctx.t('err.rate'), 429);
    if (checkForm(ctx)) return loginPage(ctx, ctx.t('err.form'), 400);
    if (!safeEqual(ctx.body.secret || '', config.adminSecret)) {
      store.audit('login failed');
      return loginPage(ctx, 'Wrong secret.', 403);
    }
    const token = crypto.randomBytes(32).toString('base64url');
    for (const [k, exp] of app.adminSessions) if (exp < app.now()) app.adminSessions.delete(k);
    app.adminSessions.set(hashToken(token), app.now() + SESSION_MS);
    store.audit('login');
    ctx.res.setHeader('Set-Cookie', cookieString(cookieName, token, { secure: config.secureCookies, maxAge: SESSION_MS / 1000, sameSite: 'Strict' }));
    redirect(ctx, '/admin');
  });

  router.post('/admin/logout', (ctx) => {
    enabled();
    if (checkForm(ctx)) throw new HttpError(400, 'err.form');
    const v = ctx.cookies[cookieName];
    if (v) app.adminSessions.delete(hashToken(v));
    ctx.res.setHeader('Set-Cookie', cookieString(cookieName, '', { secure: config.secureCookies, maxAge: 0, sameSite: 'Strict' }));
    redirect(ctx, '/admin');
  });

  router.post('/admin/action', (ctx) => {
    enabled();
    if (!session(ctx)) throw new HttpError(404);
    if (checkForm(ctx)) throw new HttpError(400, 'err.form');
    const b = ctx.body;
    const ids = ctx.form.getAll('id').slice(0, 500);
    let n = 0;
    switch (b.action) {
      case 'hold_on': store.setSetting('hold_manual', '1'); store.audit('hold manual works on'); break;
      case 'hold_off': store.setSetting('hold_manual', '0'); store.audit('hold manual works off'); break;
      case 'approve_work':
        for (const id of ids) { store.approveWork(Number(id)); store.audit('approve work', id); n++; }
        break;
      case 'remove_work':
        for (const id of ids) { n += store.deleteWork(Number(id)); store.audit('remove work', id); }
        break;
      case 'remove_request':
        for (const id of ids) { n += store.deleteRequest(Number(id)); store.audit('remove request', id); }
        break;
      case 'remove_meeting':
        for (const id of ids) { n += store.deleteMeeting(String(id)); store.audit('remove meeting', id); }
        break;
      case 'dismiss_report':
        for (const id of ids) { store.deleteReport(Number(id)); store.audit('dismiss report', id); n++; }
        break;
      case 'bulk_recent': {
        const hours = Math.min(168, Math.max(1, Number.parseInt(b.hours, 10) || 0));
        if (b.confirm !== 'yes') return dashboard(ctx, 'Tick the confirmation box to bulk remove.');
        if (b.what === 'requests' || b.what === 'both') n += store.deleteRequestsSince(hours);
        if (b.what === 'meetings' || b.what === 'both') n += store.deleteMeetingsSince(hours);
        store.audit(`bulk remove ${b.what} from last ${hours}h`, `${n} rows`);
        break;
      }
      default: throw new HttpError(400);
    }
    redirect(ctx, `/admin?done=${encodeURIComponent(`${b.action}: ${n}`)}`);
  });

  function dashboard(ctx, error = null) {
    const hold = store.holdManual();
    const reports = store.reports();
    const held = store.heldWorks();
    const reqs = store.recentRequests(200);
    const meetings = store.recentMeetings(200);
    const log = store.auditLog(50);
    const done = ctx.query.get('done');
    const area = (r) => (r.onlineOnly ? 'Online' : places.regionLabel(r.placeId) || '?');
    const action = (name, label, cls = '') => html`<button type="submit" name="action" value="${name}" class="${cls}">${label}</button>`;

    page(ctx, {
      title: 'Admin', noindex: true,
      body: html`<h1>Admin</h1>
${noticeBox(done ? `Done (${done})` : null)}${errorBox(error)}
<form method="post" action="/admin/logout" class="inline">${guard(ctx)}<button class="link" type="submit">Sign out</button></form>

<section class="admin">
<h2>Hand-entered works</h2>
<form method="post" action="/admin/action">${guard(ctx)}
  <p>New hand-entered works are <strong>${hold ? 'held for review' : 'published immediately'}</strong>. Open Library books always flow.</p>
  ${hold ? action('hold_off', 'Stop holding') : action('hold_on', 'Hold new hand-entered works', 'danger')}
</form>
${held.length ? html`<form method="post" action="/admin/action">${guard(ctx)}
  <table><thead><tr><th></th><th>Kind</th><th>Title</th><th>Creator</th><th>Link</th></tr></thead><tbody>
  ${held.map((w) => html`<tr><td><input type="checkbox" name="id" value="${w.id}" aria-label="select"></td><td>${w.kind}</td><td>${w.title}</td><td>${w.creator}</td><td>${w.link ? html`<code>${w.link}</code>` : ''}</td></tr>`)}
  </tbody></table>
  ${action('approve_work', 'Approve selected')} ${action('remove_work', 'Remove selected', 'danger')}
</form>` : html`<p>No held works.</p>`}
</section>

<section class="admin">
<h2>Reports (${reports.length})</h2>
${reports.length ? html`<form method="post" action="/admin/action">${guard(ctx)}
  <table><thead><tr><th></th><th>When</th><th>Meeting</th><th>Reason</th><th>Text</th></tr></thead><tbody>
  ${reports.map((r) => html`<tr><td><input type="checkbox" name="id" value="${r.id}" aria-label="select"></td><td>${hourLabel(r.created_hour)}</td>
    <td><a href="/m/${r.meeting_id}">${r.title}</a> (${r.status}) <code>${r.meeting_id}</code></td><td>${r.reason}</td><td>${r.text}</td></tr>`)}
  </tbody></table>
  ${action('dismiss_report', 'Dismiss selected reports')}
</form>` : html`<p>No reports.</p>`}
<p class="hint">To remove a reported meeting, select it in the meetings table below (its id is shown above).</p>
</section>

<section class="admin">
<h2>Meetings (latest ${meetings.length})</h2>
<form method="post" action="/admin/action">${guard(ctx)}
  <table><thead><tr><th></th><th>Id</th><th>Work</th><th>Starts (UTC)</th><th>Format</th><th>Status</th></tr></thead><tbody>
  ${meetings.map((m) => html`<tr><td><input type="checkbox" name="id" value="${m.id}" aria-label="select"></td><td><a href="/m/${m.id}"><code>${m.id}</code></a></td><td>${m.title}</td>
    <td>${new Date(m.startsUtc).toISOString().slice(0, 16).replace('T', ' ')}</td><td>${m.format}</td><td>${m.status}</td></tr>`)}
  </tbody></table>
  ${action('remove_meeting', 'Remove selected meetings', 'danger')}
</form>
</section>

<section class="admin">
<h2>Requests (latest ${reqs.length})</h2>
<form method="post" action="/admin/action">${guard(ctx)}
  <table><thead><tr><th></th><th>Posted</th><th>Work</th><th>Area</th><th>Format</th><th>Status</th></tr></thead><tbody>
  ${reqs.map((r) => html`<tr><td><input type="checkbox" name="id" value="${r.id}" aria-label="select"></td><td>${hourLabel(r.createdHour)}</td><td>${r.title} <span class="hint">${r.kind}</span></td>
    <td>${area(r)}</td><td>${r.format}</td><td>${r.status}</td></tr>`)}
  </tbody></table>
  ${action('remove_request', 'Remove selected requests', 'danger')}
</form>
</section>

<section class="admin">
<h2>Flood: bulk remove</h2>
<form method="post" action="/admin/action">${guard(ctx)}
  <label>Remove <select name="what"><option value="requests">requests</option><option value="meetings">meetings</option><option value="both">requests and meetings</option></select></label>
  <label>posted in the last <input type="number" name="hours" min="1" max="168" value="1"> hours</label>
  <label><input type="checkbox" name="confirm" value="yes"> I understand this cannot be undone</label>
  ${action('bulk_recent', 'Bulk remove', 'danger')}
</form>
</section>

<section class="admin">
<h2>Audit log</h2>
<table><thead><tr><th>When</th><th>Action</th><th>Target</th></tr></thead><tbody>
${log.map((l) => html`<tr><td>${hourLabel(l.at_hour)}</td><td>${l.action}</td><td>${l.target}</td></tr>`)}
</tbody></table>
</section>`,
    });
  }
}
