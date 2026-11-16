import crypto from 'node:crypto';

// Fixed-window counters held only in memory. Keys are HMACs of the IP with a
// random key that lives in memory and rotates every 24 hours, so nothing here
// can be tied back to an address after a restart or a day.
export class RateLimiter {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.windows = new Map();
    this.rotate();
  }

  rotate() {
    this.ipKey = crypto.randomBytes(32);
    this.rotatedAt = this.now();
  }

  ipHash(ip) {
    if (this.now() - this.rotatedAt > 24 * 3600 * 1000) this.rotate();
    return crypto.createHmac('sha256', this.ipKey).update(String(ip)).digest('base64url').slice(0, 22);
  }

  // Count one hit. Returns true if still within the limit.
  hit(bucket, key, limit, windowMs) {
    const k = `${bucket}:${key}`;
    const t = this.now();
    let w = this.windows.get(k);
    if (!w || w.reset <= t) {
      w = { count: 0, reset: t + windowMs };
      this.windows.set(k, w);
    }
    w.count++;
    return w.count <= limit;
  }

  count(bucket, key) {
    const w = this.windows.get(`${bucket}:${key}`);
    return w && w.reset > this.now() ? w.count : 0;
  }

  // Mark something once in a window (used for duplicate detection).
  seen(bucket, key, windowMs) {
    const k = `${bucket}:${key}`;
    const t = this.now();
    const w = this.windows.get(k);
    if (w && w.reset > t) return true;
    this.windows.set(k, { count: 1, reset: t + windowMs });
    return false;
  }

  sweep() {
    const t = this.now();
    for (const [k, w] of this.windows) if (w.reset <= t) this.windows.delete(k);
  }
}

// Proof-of-work difficulty: low by default, rising for an IP that keeps posting
// and site-wide when total posting volume spikes. Uses only the counters above.
export function powDifficulty(limiter, ipKey, base) {
  const mine = limiter.count('writes', ipKey);
  const all = limiter.count('writes', '*');
  let factor = mine <= 2 ? 1 : Math.min(64, 2 ** (mine - 2));
  if (all > 600) factor *= 16;
  else if (all > 200) factor *= 4;
  else if (all > 80) factor *= 2;
  return Math.min(base * factor, 20_000_000);
}

export function recordWrite(limiter, ipKey) {
  const window = 10 * 60 * 1000;
  limiter.hit('writes', ipKey, Infinity, window);
  limiter.hit('writes', '*', Infinity, window);
}
