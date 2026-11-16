import http from 'node:http';
import crypto from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { Store } from '../src/store.js';
import { memoryMailer } from '../src/mail.js';

export const ADMIN_SECRET = 'test-admin-secret-0123456789-abcdefghijkl';

export const BOOKS = [
  { olKey: 'OL1168083W', title: 'Deschooling Society', creator: 'Ivan Illich', year: 1971 },
  { olKey: 'OL45883W', title: 'Pedagogy of the Oppressed', creator: 'Paulo Freire', year: 1968 },
];

export async function startTestServer({ overrides = {}, now } = {}) {
  const config = loadConfig({ NODE_ENV: 'test' }, {
    adminSecret: ADMIN_SECRET, minFormMs: 0, powBase: 200, jobs: false, boardMinMs: 0, ...overrides,
  });
  const clock = now || (() => Date.now());
  const store = new Store(':memory:', { now: clock });
  const mailer = memoryMailer();
  const openLibrary = { async search(q) { return BOOKS.filter((b) => b.title.toLowerCase().includes(q.toLowerCase())); } };
  const quiet = { info() {}, error() {}, log() {} };
  const app = createApp(config, { store, mailer, openLibrary, now: clock, log: quiet });
  const server = http.createServer(app.handle);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { app, store, mailer, base, close: () => new Promise((r) => { server.close(r); store.close(); }) };
}

export function decodeEntities(s) {
  return s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#96;/g, '`').replace(/&amp;/g, '&');
}

export function solve(ch) {
  for (let n = 0; n <= ch.maxnumber; n++) {
    if (crypto.createHash('sha256').update(ch.salt + n).digest('hex') === ch.challenge) {
      return Buffer.from(JSON.stringify({ algorithm: ch.algorithm, challenge: ch.challenge, number: n, salt: ch.salt, signature: ch.signature })).toString('base64');
    }
  }
  throw new Error('unsolvable');
}

// A browser-ish client with its own cookie jar.
export class Client {
  constructor(base) { this.base = base; this.cookies = new Map(); }

  async request(method, path, form, headers = {}) {
    const h = { ...headers };
    if (this.cookies.size) h.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    let body;
    if (method === 'POST' && !('Origin' in h)) h.Origin = this.base; // as browsers do
    if (form) {
      h['Content-Type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(form).toString();
    }
    const res = await fetch(this.base + path, { method, headers: h, body, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const i = kv.indexOf('=');
      const v = kv.slice(i + 1);
      if (v) this.cookies.set(kv.slice(0, i), v); else this.cookies.delete(kv.slice(0, i));
    }
    const text = await res.text();
    return { status: res.status, headers: res.headers, text, location: res.headers.get('location') };
  }

  get(path) { return this.request('GET', path); }

  // Fill a form found on the page at `path` (the first form whose action matches) and submit it.
  async submit(path, action, fields = {}, { solvePow = true, page = null, powFor = null } = {}) {
    const p = page || await this.get(path);
    const forms = [...p.text.matchAll(/<form[^>]*action="([^"]*)"[^>]*>([\s\S]*?)<\/form>/g)];
    const f = forms.find((m) => decodeEntities(m[1]) === action);
    if (!f) throw new Error(`no form ${action} on ${path}: ${p.status}`);
    const inner = f[2];
    const data = {};
    for (const m of inner.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/g)) data[m[1]] = decodeEntities(m[2]);
    const ch = /data-challenge="([^"]+)"/.exec(inner);
    const by = /data-challenges="([^"]+)"/.exec(inner);
    const checked = /<input type="radio" name="radius" value="(\d+)" checked/.exec(inner);
    const radius = fields.radius ?? (checked && checked[1]);
    // Like the browser: use the challenge for the chosen distance, unless told to use the base one.
    if (ch && solvePow) {
      const pick = by && radius && powFor !== 'base' ? JSON.parse(decodeEntities(by[1]))[powFor || radius] : JSON.parse(decodeEntities(ch[1]));
      data.pow = solve(pick);
    }
    Object.assign(data, fields);
    for (const k of Object.keys(data)) if (data[k] === undefined) delete data[k];
    return this.request('POST', action, data);
  }
}

export function tomorrow() {
  return new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
}
