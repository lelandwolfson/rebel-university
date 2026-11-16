import crypto from 'node:crypto';
import { hmac, safeEqual } from './security.js';

// Self-hosted proof-of-work, ALTCHA-style:
//   server picks secret number n in [0, max]; challenge = sha256(salt + n).
//   The browser brute-forces n.
// The salt carries issue time, expiry, difficulty, and a short hash of the
// client's (rotating) IP key. The signature covers salt AND challenge, so
// none of those can be altered (including by moving digits between the
// number and the salt). The key is random per process, so solutions can't
// be replayed after a restart.

const TTL_MS = 60 * 60 * 1000;

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export class ProofOfWork {
  constructor(key = crypto.randomBytes(32), { now = () => Date.now() } = {}) {
    this.key = key;
    this.now = now;
    this.used = new Map(); // challenge -> expiry; prevents replay
  }

  // factor: the work multiplier this challenge was issued for (e.g. a wider travel distance).
  create(max, ipKey = '', factor = 1) {
    const issued = this.now();
    const salt = `${crypto.randomBytes(12).toString('hex')}?i=${issued}&e=${issued + TTL_MS}&m=${max}&f=${factor}&k=${String(ipKey).slice(0, 8)}`;
    const number = crypto.randomInt(0, max + 1);
    const challenge = sha256(salt + number);
    return { algorithm: 'SHA-256', salt, challenge, maxnumber: max, signature: hmac(this.key, `${salt}|${challenge}`) };
  }

  // Returns { ok, issued } or { ok: false, reason }.
  // ipKey: the submitting client's key; minMax: the lowest difficulty accepted, already
  // including any factor; minFactor: the work multiplier the action requires (checked
  // against the factor the challenge was issued for, so a cheaper challenge can't stand in).
  verify(encoded, { ipKey = '', minMax = 0, minFactor = 1 } = {}) {
    if (typeof encoded !== 'string' || encoded.length > 1000) return { ok: false, reason: 'missing' };
    let p;
    try { p = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')); } catch { return { ok: false, reason: 'malformed' }; }
    if (!p || typeof p.salt !== 'string' || typeof p.challenge !== 'string' || typeof p.signature !== 'string'
      || !Number.isSafeInteger(p.number) || p.number < 0) return { ok: false, reason: 'malformed' };
    if (!safeEqual(hmac(this.key, `${p.salt}|${p.challenge}`), p.signature)) return { ok: false, reason: 'signature' };
    if (sha256(p.salt + p.number) !== p.challenge) return { ok: false, reason: 'solution' };
    const m = /\?i=(\d{1,15})&e=(\d{1,15})&m=(\d{1,10})&f=(\d{1,3})&k=([A-Za-z0-9_-]{0,8})$/.exec(p.salt);
    if (!m) return { ok: false, reason: 'malformed' };
    const [issued, expires, max, factor] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
    if (p.number > max) return { ok: false, reason: 'solution' };
    if (this.now() > expires) return { ok: false, reason: 'expired' };
    if (m[5] !== String(ipKey).slice(0, 8)) return { ok: false, reason: 'ip' };
    if (factor < minFactor) return { ok: false, reason: 'factor' };
    if (max < minMax) return { ok: false, reason: 'difficulty' };
    if (this.used.has(p.challenge)) return { ok: false, reason: 'replay' };
    this.used.set(p.challenge, expires);
    return { ok: true, issued };
  }

  sweep() {
    const t = this.now();
    for (const [c, e] of this.used) if (e < t) this.used.delete(c);
  }
}
