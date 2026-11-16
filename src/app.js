import { Store } from './store.js';
import { Places } from './geo.js';
import { ProofOfWork } from './pow.js';
import { RateLimiter, powDifficulty, recordWrite } from './ratelimit.js';
import { OpenLibrary } from './works.js';
import { createMailer } from './mail.js';
import { translator } from './i18n/index.js';
import {
  Router, HttpError, securityHeaders, parseCookies, cookieString, readBody, clientIp,
  csrfCookieName, newCsrf, originOk, csrfOk,
} from './http.js';
import { layout } from './views.js';
import { html } from './html.js';
import pages from './routes/pages.js';
import requests from './routes/requests.js';
import meetings from './routes/meetings.js';
import listings from './routes/listings.js';
import admin from './routes/admin.js';

let placesCache;

export function createApp(config, { store, places, mailer, openLibrary, now = () => Date.now(), log = console } = {}) {
  const app = {
    config,
    now,
    log,
    store: store || new Store(config.dbPath, { now }),
    places: places || (placesCache ||= Places.load()),
    pow: new ProofOfWork(undefined, { now }), // random key per process: no replay across restarts
    limiter: new RateLimiter({ now }),
    mailer: mailer || createMailer(config.smtp, { log }),
    openLibrary: openLibrary || new OpenLibrary(config.openLibraryUrl),
    t: translator('en'),
    router: new Router(),
    adminSessions: new Map(),
    joinedFrom: new Map(), // attendee id -> { ipKey, until }; memory only
  };
  app.distanceKm = (a, b) => app.places.distanceKm(a, b);
  app.powDifficulty = (ipKey) => powDifficulty(app.limiter, ipKey, config.powBase);
  app.recordWrite = (ipKey) => recordWrite(app.limiter, ipKey);

  for (const register of [pages, requests, meetings, listings, admin]) register(app);

  app.handle = (req, res) => handle(app, req, res);
  return app;
}

const CSRF_TTL = 60 * 60 * 24;

async function handle(app, req, res) {
  const { config, t } = app;
  const secure = config.secureCookies;
  const headers = securityHeaders(secure);
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);

  const ctx = { app, req, res, t, params: {}, body: {}, form: new URLSearchParams() };
  try {
    if (config.production && String(req.headers.host || '').startsWith('www.')) {
      res.writeHead(301, { Location: config.baseUrl + (req.url.startsWith('/') ? req.url : '/') });
      return res.end();
    }
    if (config.trustProxy && req.headers['x-forwarded-proto'] === 'http') {
      res.writeHead(301, { Location: config.baseUrl + (req.url.startsWith('/') ? req.url : '/') });
      return res.end();
    }
    let url;
    try { url = new URL(req.url, 'http://local'); } catch { throw new HttpError(400); }
    ctx.url = url;
    ctx.query = url.searchParams;
    ctx.ip = clientIp(req, config.trustProxy);
    ctx.ipKey = app.limiter.ipHash(ctx.ip);
    ctx.cookies = parseCookies(req.headers.cookie);

    const cname = csrfCookieName(secure);
    ctx.csrf = ctx.cookies[cname];
    if (!ctx.csrf || !/^[A-Za-z0-9_-]{24}$/.test(ctx.csrf)) {
      ctx.csrf = newCsrf();
      res.setHeader('Set-Cookie', cookieString(cname, ctx.csrf, { secure, maxAge: CSRF_TTL }));
      ctx.csrfFresh = true;
    }

    if (!app.limiter.hit('req', ctx.ipKey, 600, 10 * 60 * 1000)) throw new HttpError(429);

    const m = app.router.match(req.method, url.pathname);
    if (!m) throw new HttpError(404);
    if (m.methodNotAllowed) throw new HttpError(405);
    ctx.params = m.params;

    if (req.method === 'POST') {
      ctx.form = await readBody(req);
      ctx.body = {};
      for (const [k, v] of ctx.form) if (!(k in ctx.body)) ctx.body[k] = v;
      ctx.csrfValid = !ctx.csrfFresh && csrfOk(ctx.cookies[cname], ctx.body._csrf) && originOk(req, config.baseUrl, secure);
    }

    await m.handler(ctx);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) log500(app, err);
    if (status === 413 || status === 415) res.setHeader('Connection', 'close'); // don't drain an unwanted body
    if (!res.headersSent) sendError(ctx, status, err.key);
    else res.end();
  }
}

function log500(app, err) {
  // No paths, bodies, or IPs: paths contain private tokens.
  app.log.error(`error: ${err && err.stack ? err.stack.split('\n').slice(0, 4).join(' | ') : err}`);
}

const STATUS_TEXT = { 400: 'Bad request', 404: 'Not found', 405: 'Method not allowed', 413: 'Too large', 415: 'Unsupported', 429: 'Too many requests', 500: 'Server error' };

function sendError(ctx, status, key) {
  const { t } = ctx;
  const msg = key ? t(key) : status === 404 ? t('err.notFound') : status === 429 ? t('err.rate') : t('err.generic');
  const body = html`<h1>${STATUS_TEXT[status] || 'Error'}</h1><p>${msg}</p><p><a href="/">Home</a></p>`;
  sendHtml(ctx, status, layout(ctx.url ? ctx : { ...ctx, app: ctx.app }, { title: STATUS_TEXT[status], body, noindex: true }));
}

export function sendHtml(ctx, status, page, { cache = 'no-store' } = {}) {
  const buf = Buffer.from(String(page));
  ctx.res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': buf.length, 'Cache-Control': cache });
  ctx.res.end(ctx.req.method === 'HEAD' ? undefined : buf);
}

export function page(ctx, { title, body, status = 200, noindex = false }) {
  sendHtml(ctx, status, layout(ctx, { title, body, noindex }));
}

export function redirect(ctx, location) {
  ctx.res.writeHead(303, { Location: location, 'Cache-Control': 'no-store' });
  ctx.res.end();
}

// Checks for every form submission. Returns an error message or null.
// factor: extra proof-of-work the action needs (wider travel distances; THREAT-MODEL.md T1a).
export function checkForm(ctx, { pow = false, factor = 1 } = {}) {
  const { app, t } = ctx;
  const why = (reason) => { if (app.config.formDebug) app.log.info(`form rejected: ${reason}`); return t('err.form'); };
  if (!ctx.csrfValid) return why(`csrf (fresh=${!!ctx.csrfFresh} origin=${ctx.req.headers.origin || '-'})`);
  if (!pow) return null;
  if (ctx.body.website) return why('honeypot');
  // Difficulty may rise between page load and submit; allow 4x slack, no more.
  const r = app.pow.verify(ctx.body.pow, { ipKey: ctx.ipKey, minMax: Math.floor(app.powDifficulty(ctx.ipKey) / 4), minFactor: factor });
  if (!r.ok) return why(`pow ${r.reason}`);
  if (app.now() - r.issued < app.config.minFormMs) return t('err.tooFast');
  return null;
}

// Rate limit for a write action. Returns true if allowed.
export function allowWrite(ctx, bucket, limit, windowMs = 60 * 60 * 1000) {
  return ctx.app.limiter.hit(`w:${bucket}`, ctx.ipKey, limit, windowMs);
}

// Slow down anyone trying lots of private links.
export function tokenLookupAllowed(ctx) {
  return ctx.app.limiter.hit('token', ctx.ipKey, 200, 10 * 60 * 1000);
}
