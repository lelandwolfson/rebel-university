import crypto from 'node:crypto';
import net from 'node:net';

// Two kinds of counters, held only in memory:
//
// - traffic counters (page views, link lookups, searches): cheap to create, so
//   their map is bounded by evicting the oldest entries under a flood.
// - guard counters (posting limits, probe budgets, duplicate checks, rejoin
//   blocks, PoW difficulty): never evicted, because evicting them would erase
//   the protections (second review, finding 1). They are only created by
//   actions that already passed proof-of-work or need a private link, and if
//   their map is ever full the limiter fails closed (refuses) until it drains.

const TRAFFIC_MAX = 200_000;
const GUARD_MAX = 300_000;
export const POW_CAP = 20_000_000;

const TRAFFIC_BUCKETS = new Set(['req', 'token', 'olsearch', 'admin-login']);

export const isGuardBucket = (bucket) => !TRAFFIC_BUCKETS.has(bucket);

// Expand an IPv6 address to its 8 groups (numbers), or null.
function ipv6Groups(s) {
  if (!net.isIPv6(s)) return null;
  s = s.split('%')[0];
  const [head, tail] = s.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined && tail ? tail.split(':') : [];
  if (t.length && t[t.length - 1].includes('.')) t.splice(-1, 1, '0', '0');
  if (h.length && h[h.length - 1].includes('.')) h.splice(-1, 1, '0', '0');
  const groups = tail === undefined ? h : [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
  return groups.map((g) => parseInt(g || '0', 16));
}

function unmap(ip) {
  const s = String(ip || '').trim();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(s);
  return mapped ? mapped[1] : s;
}

// IPv6 users (and attackers) control at least a /64, so the fine tier is the /64.
export function ipBucket(ip) {
  const s = unmap(ip);
  const g = ipv6Groups(s);
  return g ? `${g.slice(0, 4).map((x) => x.toString(16)).join(':')}::/64` : s;
}

// A coarser tier: one free tunnel account gets a whole /48 (65,536 /64s).
// IPv4 addresses are scarce enough to stay per address.
export function ipBucket48(ip) {
  const s = unmap(ip);
  const g = ipv6Groups(s);
  return g ? `${g.slice(0, 3).map((x) => x.toString(16)).join(':')}::/48` : s;
}

export class RateLimiter {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.windows = new Map(); // traffic
    this.guards = new Map();
    this.ipKey = null;
    this.scopeKey = null;
    this.rotate();
  }

  // The keys that scramble addresses are random, live only in memory, and change
  // daily. The previous day's key is kept so blocks don't lapse at the rotation
  // (second review, finding 9).
  rotate() {
    this.prevKey = this.ipKey;
    this.prevScopeKey = this.scopeKey;
    this.ipKey = crypto.randomBytes(32);
    this.scopeKey = crypto.randomBytes(32);
    this.rotatedAt = this.now();
  }

  maybeRotate() {
    if (this.now() - this.rotatedAt > 24 * 3600 * 1000) this.rotate();
  }

  hash(key, value) {
    return crypto.createHmac('sha256', key).update(value).digest('base64url').slice(0, 22);
  }

  // { k64, k48, prev64, prev48 } for an address.
  ipKeys(ip) {
    this.maybeRotate();
    const b64 = ipBucket(ip);
    const b48 = ipBucket48(ip);
    const keys = { k64: this.hash(this.ipKey, b64), k48: this.hash(this.ipKey, `48|${b48}`), prev64: null, prev48: null };
    if (this.prevKey) {
      keys.prev64 = this.hash(this.prevKey, b64);
      keys.prev48 = this.hash(this.prevKey, `48|${b48}`);
    }
    return keys;
  }

  ipHash(ip) { return this.ipKeys(ip).k64; }

  // A counter key for "this address, about this thing" that shares no prefix
  // with any other counter, so memory doesn't hold a reusable per-person id
  // linking a person's works or meetings together (second review, finding 10).
  scoped(ipKey, scope) {
    return this.hash(this.scopeKey, `${ipKey}|${scope}`);
  }

  scopedPrev(ipKey, scope) {
    return this.prevScopeKey && ipKey ? this.hash(this.prevScopeKey, `${ipKey}|${scope}`) : null;
  }

  mapFor(bucket) { return isGuardBucket(bucket) ? this.guards : this.windows; }

  // Count one hit. Returns true if still within the limit.
  hit(bucket, key, limit, windowMs) {
    const map = this.mapFor(bucket);
    const k = `${bucket}:${key}`;
    const t = this.now();
    let w = map.get(k);
    if (!w || w.reset <= t) {
      if (!this.makeRoom(map)) return false; // guard map full: fail closed
      w = { count: 0, reset: t + windowMs };
      map.set(k, w);
    }
    w.count++;
    return w.count <= limit;
  }

  count(bucket, key) {
    if (key == null) return 0;
    const w = this.mapFor(bucket).get(`${bucket}:${key}`);
    return w && w.reset > this.now() ? w.count : 0;
  }

  // Mark something once in a window. Returns true if already marked (or if the
  // guard map is full, which is treated as "already seen": fail closed).
  seen(bucket, key, windowMs) {
    const map = this.mapFor(bucket);
    const k = `${bucket}:${key}`;
    const t = this.now();
    const w = map.get(k);
    if (w && w.reset > t) return true;
    if (!this.makeRoom(map)) return true;
    map.set(k, { count: 1, reset: t + windowMs });
    return false;
  }

  // Returns false if there is no room (guard map only).
  makeRoom(map) {
    const max = map === this.guards ? GUARD_MAX : TRAFFIC_MAX;
    if (map.size < max) return true;
    this.sweepMap(map);
    if (map.size < max) return true;
    if (map === this.guards) return false;
    let drop = Math.ceil(max / 10);
    for (const k of map.keys()) { if (drop-- <= 0) break; map.delete(k); }
    return true;
  }

  sweepMap(map) {
    const t = this.now();
    for (const [k, w] of map) if (w.reset <= t) map.delete(k);
  }

  sweep() {
    this.maybeRotate();
    this.sweepMap(this.windows);
    this.sweepMap(this.guards);
  }
}

// Proof-of-work difficulty: low by default, rising for an address that keeps
// posting and site-wide when total posting volume spikes. It is a speed bump,
// not the main defense (second review, finding 5): limits per /64 and per /48 are.
export function powDifficulty(limiter, ipKey, base, ipKey48 = null) {
  const mine = Math.max(limiter.count('writes', ipKey), Math.floor(limiter.count('writes48', ipKey48) / 8));
  const all = limiter.count('writes', '*');
  let factor = mine <= 2 ? 1 : Math.min(64, 2 ** (mine - 2));
  if (all > 600) factor *= 16;
  else if (all > 200) factor *= 4;
  else if (all > 80) factor *= 2;
  return Math.min(base * factor, POW_CAP);
}

export function recordWrite(limiter, ipKey, ipKey48 = null) {
  const window = 10 * 60 * 1000;
  limiter.hit('writes', ipKey, Infinity, window);
  if (ipKey48) limiter.hit('writes48', ipKey48, Infinity, window);
  limiter.hit('writes', '*', Infinity, window);
}
