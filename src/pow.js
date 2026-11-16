import crypto from 'node:crypto';
import { hmac, safeEqual } from './security.js';

// Self-hosted proof-of-work, same scheme as ALTCHA:
//   server picks secret number n in [0, max], salt includes expiry and issue time,
//   challenge = sha256(salt + n), signature = HMAC(challenge).
// The browser brute-forces n. Changing the salt would require a new preimage,
// so issue time and expiry are tamper-proof.

const TTL_MS = 2 * 60 * 60 * 1000;

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export class ProofOfWork {
  constructor(key, { now = () => Date.now() } = {}) {
    this.key = key;
    this.now = now;
    this.used = new Map(); // challenge -> expiry; prevents replay
  }

  create(max) {
    const issued = this.now();
    const salt = `${crypto.randomBytes(12).toString('hex')}?i=${issued}&e=${issued + TTL_MS}`;
    const number = crypto.randomInt(0, max + 1);
    const challenge = sha256(salt + number);
    return { algorithm: 'SHA-256', salt, challenge, maxnumber: max, signature: hmac(this.key, challenge) };
  }

  // Returns { ok, issued } or { ok: false, reason }.
  verify(encoded) {
    if (typeof encoded !== 'string' || encoded.length > 1000) return { ok: false, reason: 'missing' };
    let p;
    try { p = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')); } catch { return { ok: false, reason: 'malformed' }; }
    if (!p || typeof p.salt !== 'string' || typeof p.challenge !== 'string' || typeof p.signature !== 'string'
      || !Number.isSafeInteger(p.number) || p.number < 0) return { ok: false, reason: 'malformed' };
    if (!safeEqual(hmac(this.key, p.challenge), p.signature)) return { ok: false, reason: 'signature' };
    if (sha256(p.salt + p.number) !== p.challenge) return { ok: false, reason: 'solution' };
    const m = /\?i=(\d+)&e=(\d+)$/.exec(p.salt);
    if (!m) return { ok: false, reason: 'malformed' };
    const issued = Number(m[1]);
    const expires = Number(m[2]);
    if (this.now() > expires) return { ok: false, reason: 'expired' };
    if (this.used.has(p.challenge)) return { ok: false, reason: 'replay' };
    this.used.set(p.challenge, expires);
    return { ok: true, issued };
  }

  sweep() {
    const t = this.now();
    for (const [c, e] of this.used) if (e < t) this.used.delete(c);
  }
}
