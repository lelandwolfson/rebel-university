import crypto from 'node:crypto';
import { html } from '../html.js';
import { page, redirect, checkForm } from '../app.js';
import { HttpError, cookieString } from '../http.js';
import { guard, errorBox, noticeBox } from '../views.js';
import { safeEqual, hashToken } from '../security.js';
import { clean } from '../text.js';
import { runModeration, AI_MODEL } from '../moderation.js';
import { TRASH_HOURS } from '../store.js';

const SESSION_MS = 2 * 3600 * 1000;

// Only known action names are echoed back, never arbitrary text from the URL.
const DONE = { hold_on: 'Holding hand-entered works', hold_off: 'Stopped holding', approve_work: 'Approved', remove_work: 'Moved works to the trash',
  remove_request: 'Moved requests to the trash', remove_meeting: 'Moved meetings to the trash', dismiss_report: 'Dismissed reports', bulk_recent: 'Bulk removed',
  restore: 'Restored', ack_run: 'Marked handled', ai_pause: 'Paused AI moderation', ai_resume: 'Resumed AI moderation', ai_run_now: 'Ran AI moderation; items reviewed' };

// Restore errors from the store, shown by code so no free text travels in the URL.
const RESTORE_ERRORS = {
  gone: 'it is no longer in the trash',
  expired: 'it has passed its deletion date',
  work_removed: 'the work it belonged to was removed; restore that work first',
  conflict: 'a different work with the same title now exists',
  failed: 'it could not be restored',
};

const hourLabel = (h) => new Date(h * 3600 * 1000).toISOString().slice(0, 13).replace('T', ' ') + 'h';

export default function register(app) {
  const { router, store, config, places } = app;
  const cookieName = config.secureCookies ? '__Host-ru_admin' : 'ru_admin';

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
    // Form check first, then a per-IP limit. No site-wide cap: one IP could
    // otherwise lock the admin out. The 32+ character secret makes guessing futile.
    if (checkForm(ctx)) return loginPage(ctx, ctx.t('err.form'), 400);
    if (!app.limiter.hit('admin-login', ctx.ipKey, 5, 15 * 60 * 1000) || !app.limiter.hit('admin-login', `48|${ctx.ipKey48}`, 20, 15 * 60 * 1000)) {
      return loginPage(ctx, ctx.t('err.rate'), 429);
    }
    if (!safeEqual(ctx.body.secret || '', config.adminSecret)) {
      // At most one audit row per 15 minutes, so failed logins can't flood the log.
      if (!app.limiter.seen('admin-login', 'audit-failed', 15 * 60 * 1000)) store.audit('login failed (one or more)');
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

  router.post('/admin/action', async (ctx) => {
    enabled();
    if (!session(ctx)) throw new HttpError(404);
    if (checkForm(ctx)) throw new HttpError(400, 'err.form');
    const b = ctx.body;
    const ids = ctx.form.getAll('id').slice(0, 500);
    const reason = clean(b.reason || '', 300);
    const by = { actor: 'admin', reason };
    let n = 0;
    let back = '/admin';
    let failed = null;
    switch (b.action) {
      case 'restore': {
        back = '/admin/moderation';
        for (const id of ids) {
          const err = store.restoreTrash(Number(id));
          if (!err) { n++; store.audit('restore', id, by); } else failed = err;
        }
        break;
      }
      case 'ack_run':
        for (const id of ids) { store.ackRun(Number(id)); n++; }
        back = '/admin/moderation';
        break;
      case 'ai_pause': store.setSetting('ai_paused', '1'); store.audit('AI moderation paused', '', by); back = '/admin/moderation'; break;
      case 'ai_resume': store.setSetting('ai_paused', '0'); store.audit('AI moderation resumed', '', by); back = '/admin/moderation'; break;
      case 'ai_run_now': {
        const r = await runModeration(app);
        store.audit('AI moderation run now', r.status, by);
        back = '/admin/moderation';
        n = r.counts ? r.counts.reviewed : 0;
        break;
      }
      case 'hold_on': store.setSetting('hold_manual', '1'); store.audit('hold manual works on'); break;
      case 'hold_off': store.setSetting('hold_manual', '0'); store.audit('hold manual works off'); break;
      case 'approve_work':
        for (const id of ids) { store.approveWork(Number(id)); store.audit('approve work', id); n++; }
        break;
      // Removals are soft: kept in the trash for 7 days, restorable from the Moderation page.
      case 'remove_work':
        for (const id of ids) if (store.trashWork(Number(id), by)) { n++; store.audit('remove work', id, by); }
        break;
      case 'remove_request':
        for (const id of ids) if (store.trashRequest(Number(id), by)) { n++; store.audit('remove request', id, by); }
        break;
      case 'remove_meeting':
        for (const id of ids) if (store.trashMeeting(String(id), by)) { n++; store.audit('remove meeting', id, by); }
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
    const errCode = failed ? (RESTORE_ERRORS[failed] ? failed : 'failed') : '';
    redirect(ctx, `${back}?done=${encodeURIComponent(b.action)}&n=${n}${errCode ? `&err=${errCode}` : ''}`);
  });

  // ---- Moderation page: AI runs, removals with restore buttons, items flagged for the owner.
  router.get('/admin/moderation', (ctx) => {
    enabled();
    if (!session(ctx)) return loginPage(ctx);
    const unacked = store.unackedRuns();
    const recent = store.runs(10).filter((r) => r.acked);
    const runs = [...unacked, ...recent];
    const errKey = ctx.query.get('err');
    const restoreError = RESTORE_ERRORS[errKey] ? `Could not restore: ${RESTORE_ERRORS[errKey]}.` : null;
    const trash = store.trashList(200);
    const inTrash = new Set(trash.map((t) => t.id));
    const paused = store.getSetting('ai_paused', '0') === '1';
    const done = DONE[ctx.query.get('done')] ? `${DONE[ctx.query.get('done')]}: ${Number.parseInt(ctx.query.get('n') || '0', 10) || 0}` : null;
    const itemLabel = (x) => (x.type === 'reported_meeting'
      ? html`reported meeting <a href="/m/${x.meetingId}"><cite>${x.adminTitle || x.title}</cite></a> (${x.reportCount} ${x.reportCount === 1 ? 'report' : 'reports'})`
      : html`held work <cite>${x.adminTitle || x.title || ''}</cite>`);
    const when = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
    const restoreBtn = (trashId) => (trashId && inTrash.has(trashId) ? html`<form method="post" action="/admin/action" class="inline">${guard(ctx)}
      <input type="hidden" name="action" value="restore"><input type="hidden" name="id" value="${trashId}"><button type="submit" class="secondary">Restore</button></form>` : html`<span class="hint">(restored or purged)</span>`);
    page(ctx, {
      title: 'Moderation', noindex: true,
      body: html`<h1>Moderation</h1>
${noticeBox(done)}${errorBox(restoreError)}
<p><a href="/admin">Back to admin</a></p>
<section class="admin">
<h2>AI moderation</h2>
<p>${config.anthropicApiKey ? html`Runs once a day with <code>${config.aiModel || AI_MODEL}</code>. It is <strong>${paused ? 'paused' : 'on'}</strong>.` : 'Off: no ANTHROPIC_API_KEY is set. The site works as usual.'}</p>
<form method="post" action="/admin/action" class="inline">${guard(ctx)}
  <button type="submit" name="action" value="${paused ? 'ai_resume' : 'ai_pause'}" class="secondary">${paused ? 'Resume AI moderation' : 'Pause AI moderation'}</button>
</form>
${config.anthropicApiKey || app.aiClient ? html`<form method="post" action="/admin/action" class="inline">${guard(ctx)}
  <button type="submit" name="action" value="ai_run_now" class="secondary">Run now</button></form>` : ''}
</section>

${runs.length ? runs.map((r) => html`<section class="admin">
<h2>${r.acked ? 'Handled' : 'Waiting for you'}: run of ${when(r.atMs)}</h2>
${!r.acked ? html`<form method="post" action="/admin/action" class="inline">${guard(ctx)}<input type="hidden" name="action" value="ack_run"><input type="hidden" name="id" value="${r.id}"><button type="submit" class="secondary">Mark handled</button></form>` : ''}
<p><strong>${r.status}</strong>. Reviewed ${r.summary.counts?.reviewed ?? 0}, approved ${r.summary.counts?.approved ?? 0}, removed ${r.summary.counts?.removed ?? 0}, flagged ${r.summary.counts?.flagged ?? 0}, discarded ${r.summary.counts?.discarded ?? 0}.</p>
${r.summary.note ? html`<p class="hint">${r.summary.note}</p>` : ''}
${(r.summary.flagged || []).length ? html`<h3>Flagged for you</h3><ul>${r.summary.flagged.map((f) => html`<li>${itemLabel(f)}. ${f.reason}</li>`)}</ul>` : ''}
${(r.summary.actions || []).length ? html`<h3>Actions taken</h3><ul>${r.summary.actions.map((a) => html`<li>${a.action}: ${itemLabel(a)}. ${a.reason} ${a.action === 'remove' ? restoreBtn(a.trashId) : ''}</li>`)}</ul>` : ''}
</section>`) : html`<p>No runs yet.</p>`}

<section class="admin">
<h2>Trash (kept ${TRASH_HOURS / 24} days)</h2>
${trash.length ? html`<table><thead><tr><th>Removed</th><th>What</th><th>By</th><th>Reason</th><th></th></tr></thead><tbody>
${trash.map((t) => html`<tr><td>${hourLabel(t.removed_hour)}</td><td>${t.kind}: ${t.label}</td><td>${t.actor}</td><td>${t.reason}</td><td>${restoreBtn(t.id)}</td></tr>`)}
</tbody></table>` : html`<p>Empty.</p>`}
</section>`,
    });
  });

  // ---- Read-only digest for an outside reader. Its token can read this and nothing else.
  router.get('/admin/digest.json', (ctx) => {
    const fail = (status) => {
      ctx.res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      ctx.res.end(JSON.stringify({ error: status === 429 ? 'rate limited' : 'not found' }));
    };
    if (!config.digestToken) return fail(404);
    // Only failures count toward lockout, so others on a shared address can't
    // lock the reader out; successes have their own generous limit.
    const HOUR = 60 * 60 * 1000;
    if (app.limiter.count('digest-fail', ctx.ipKey) >= 10 || app.limiter.count('digest-fail', `48|${ctx.ipKey48}`) >= 50) return fail(429);
    const m = /^Bearer ([^\s]{1,200})$/.exec(String(ctx.req.headers.authorization || ''));
    if (!m || !safeEqual(m[1], config.digestToken)) {
      app.limiter.hit('digest-fail', ctx.ipKey, Infinity, HOUR);
      app.limiter.hit('digest-fail', `48|${ctx.ipKey48}`, Infinity, HOUR);
      return fail(404);
    }
    if (!app.limiter.hit('digest-ok', ctx.ipKey, 60, HOUR)) return fail(429);
    const [r] = store.runs(1);
    const run = r ? {
      at: new Date(r.atMs).toISOString(),
      status: r.status,
      note: r.summary.note || null,
      counts: r.summary.counts,
      // Public titles only (approved works, meetings); never held-work titles, ids, or report text.
      actions: (r.summary.actions || []).map((a) => ({ type: a.type, action: a.action, title: a.title || null, reason: a.reason })),
      flagged: (r.summary.flagged || []).map((f) => ({ type: f.type, title: f.title || null, reason: f.reason })),
    } : null;
    const body = JSON.stringify({
      site: 'ok',
      uptime_seconds: Math.round(process.uptime()),
      last_backup: app.lastBackupAt ? app.lastBackupAt() : null,
      ai_moderation: !config.anthropicApiKey ? 'off' : store.getSetting('ai_paused', '0') === '1' ? 'paused' : 'on',
      latest_run: run,
    });
    ctx.res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    ctx.res.end(body);
  });

  function dashboard(ctx, error = null) {
    const hold = store.holdManual();
    const reports = store.reports();
    const held = store.heldWorks();
    const reqs = store.recentRequests(200);
    const meetings = store.recentMeetings(200);
    const log = store.auditLog(50);
    const waiting = store.waitingForOwner();
    const doneKey = ctx.query.get('done');
    const done = DONE[doneKey] ? `${DONE[doneKey]}: ${Number.parseInt(ctx.query.get('n') || '0', 10) || 0}` : null;
    const area = (r) => (r.onlineOnly ? 'Online' : places.regionLabel(r.placeId) || '?');
    const action = (name, label, cls = '') => html`<button type="submit" name="action" value="${name}" class="${cls}">${label}</button>`;

    page(ctx, {
      title: 'Admin', noindex: true,
      body: html`<h1>Admin</h1>
${noticeBox(done)}${errorBox(error)}
${waiting ? html`<p class="notice"><a href="/admin/moderation">Moderation: ${waiting} ${waiting === 1 ? 'item is' : 'items are'} waiting for you</a></p>` : html`<p><a href="/admin/moderation">Moderation and trash</a></p>`}
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
  <label>Reason (kept in the audit log) <input name="reason" maxlength="300"></label>
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
  <label>Reason (kept in the audit log) <input name="reason" maxlength="300"></label>
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
  <label>Reason (kept in the audit log) <input name="reason" maxlength="300"></label>
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
<table><thead><tr><th>When</th><th>By</th><th>Action</th><th>Target</th><th>Reason</th></tr></thead><tbody>
${log.map((l) => html`<tr><td>${hourLabel(l.at_hour)}</td><td>${l.actor}</td><td>${l.action}</td><td>${l.target}</td><td>${l.reason}</td></tr>`)}
</tbody></table>
</section>`,
    });
  }
}
