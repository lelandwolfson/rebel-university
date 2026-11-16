import crypto from 'node:crypto';
import { safeEqual } from './security.js';

export class HttpError extends Error {
  constructor(status, key = null) { super(`HTTP ${status}`); this.status = status; this.key = key; }
}

export class Router {
  constructor() { this.routes = []; }
  add(method, pattern, handler) {
    this.routes.push({ method, parts: pattern.split('/').filter(Boolean), handler });
    return this;
  }
  get(p, h) { return this.add('GET', p, h); }
  post(p, h) { return this.add('POST', p, h); }

  match(method, pathname) {
    const segs = pathname.split('/').filter(Boolean);
    let pathMatched = false;
    for (const r of this.routes) {
      if (r.parts.length !== segs.length) continue;
      const params = {};
      let ok = true;
      for (let i = 0; i < segs.length && ok; i++) {
        const p = r.parts[i];
        if (p.startsWith(':')) {
          try { params[p.slice(1)] = decodeURIComponent(segs[i]); } catch { ok = false; }
        } else if (p !== segs[i]) ok = false;
      }
      if (!ok) continue;
      pathMatched = true;
      if (r.method === method || (method === 'HEAD' && r.method === 'GET')) return { handler: r.handler, params };
    }
    return pathMatched ? { methodNotAllowed: true } : null;
  }
}

export function securityHeaders(secure) {
  const h = {
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; manifest-src 'self'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=(), browsing-topics=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Robots-Tag': 'noarchive',
  };
  if (secure) h['Strict-Transport-Security'] = 'max-age=63072000; includeSubDomains';
  return h;
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const k = part.slice(0, i).trim();
    if (!(k in out)) out[k] = part.slice(i + 1).trim();
  }
  return out;
}

export function cookieString(name, value, { secure, maxAge, sameSite = 'Lax' } = {}) {
  let s = `${name}=${value}; Path=/; HttpOnly; SameSite=${sameSite}`;
  if (secure) s += '; Secure';
  if (maxAge !== undefined) s += `; Max-Age=${maxAge}`;
  return s;
}

export function readBody(req, limit = 16 * 1024) {
  return new Promise((resolve, reject) => {
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/x-www-form-urlencoded') { req.resume(); return reject(new HttpError(415)); }
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > limit) { req.resume(); return reject(new HttpError(413)); }
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413)); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(new URLSearchParams(Buffer.concat(chunks).toString('utf8'))));
    req.on('error', reject);
  });
}

export function clientIp(req, trustProxy) {
  if (trustProxy) {
    const fly = req.headers['fly-client-ip'];
    if (typeof fly === 'string' && fly) return fly.trim();
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff) return xff.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

export function csrfCookieName(secure) { return secure ? '__Host-csrf' : 'csrf'; }

export function newCsrf() { return crypto.randomBytes(18).toString('base64url'); }

export function originOk(req, baseUrl, secure) {
  const origin = req.headers.origin;
  if (!origin) return true; // older browsers; the token check still applies
  if (origin === new URL(baseUrl).origin) return true;
  const host = req.headers.host;
  return !!host && origin === `${secure ? 'https' : 'http'}://${host}`;
}

export function csrfOk(cookieValue, formValue) {
  return typeof cookieValue === 'string' && cookieValue.length >= 20 && typeof formValue === 'string' && safeEqual(cookieValue, formValue);
}
