import crypto from 'node:crypto';
import net from 'node:net';

// Rate limits and abuse budgets, held only in memory.
//
// Three adversarial reviews found the same class of bug in this file: per-
// address limits that could be reset or exhausted for everyone. The design
// below removes the causes rather than patching instances:
//
// 1. One random key per process. Budgets and blocks no longer reset at a daily
//    rotation that clients could observe. The key never leaves memory, and every
//    counter still expires within its own window (at most a day, or until a
//    meeting's date for removal blocks).
// 2. Two maps. Traffic counters (page views, lookups) are cheap and evictable.
//    Guard counters (posting budgets, probe budgets, blocks, difficulty) are
//    never evicted. Callers create guard counters only after an action has
//    passed proof-of-work and is known to be valid.
// 3. Each source (an IPv6 /48 or an IPv4 /24) may own at most OWNER_MAX guard
//    counters, and when the guard map is full, space is still reserved for light
//    users. One source can no longer fill the map and block everyone.

const TRAFFIC_MAX = 200_000;
const GUARD_MAX = 300_000;
const GUARD_RESERVE = 30_000;  // extra room for sources with few counters
const OWNER_MAX = 1_000;       // guard counters any one source may hold
const LIGHT_OWNER = 20;        // sources below this may use the reserve
export const POW_CAP = 20_000_000;

// Created by unauthenticated requests, so they must be evictable (never fill the guard map).
const TRAFFIC_BUCKETS = new Set(['req', 'token', 'olsearch', 'admin-login', 'digest-fail', 'digest-ok']);

export const isGuardBucket = (bucket) => !TRAFFIC_BUCKETS.has(bucket);

function ipv6Groups(s) {
  if (!net.isIPv6(s)) return null;
  s = s.split('%')[0];
  const [head, tail] = s.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined && tail ? tail.split(':') : [];
  const v4 = (arr) => {
    if (arr.length && arr[arr.length - 1].includes('.')) {
      const [a, b, c, d] = arr.pop().split('.').map(Number);
      arr.push(((a << 8) | b).toString(16), ((c << 8) | d).toString(16));
    }
  };
  v4(h); v4(t);
  const groups = tail === undefined ? h : [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
  return groups.map((g) => parseInt(g || '0', 16));
}

// A canonical address string, or null if it isn't an IP address. IPv4-mapped
// IPv6 in any spelling becomes plain IPv4.
export function normalizeIp(ip) {
  const s = String(ip || '').trim();
  if (net.isIPv4(s)) return s;
  const g = ipv6Groups(s);
  if (!g) return null;
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    return [g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255].join('.');
  }
  return g.map((x) => x.toString(16)).join(':');
}

// Fine tier: IPv4 address, or IPv6 /64.
export function ipBucket(ip) {
  const n = normalizeIp(ip);
  if (!n) return 'invalid';
  if (net.isIPv4(n)) return n;
  return `${n.split(':').slice(0, 4).join(':')}::/64`;
}

// Coarse tier for budgets: IPv4 address (scarce), or IPv6 /48 (one tunnel account).
export function ipBucket48(ip) {
  const n = normalizeIp(ip);
  if (!n) return 'invalid';
  if (net.isIPv4(n)) return n;
  return `${n.split(':').slice(0, 3).join(':')}::/48`;
}

// Owner of guard counters: IPv4 /24, or IPv6 /48.
export function ownerBucket(ip) {
  const n = normalizeIp(ip);
  if (!n) return 'invalid';
  if (net.isIPv4(n)) return `${n.split('.').slice(0, 3).join('.')}.0/24`;
  return `${n.split(':').slice(0, 3).join(':')}::/48`;
}

export class RateLimiter {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.windows = new Map();   // traffic
    this.guards = new Map();    // k -> { count, reset, owner }
    this.owners = new Map();    // owner -> number of guard counters
    this.key = crypto.randomBytes(32); // per process, memory only
  }

  hash(value) {
    return crypto.createHmac('sha256', this.key).update(value).digest('base64url').slice(0, 22);
  }

  // { k64, k48, owner } for an address. Same values for the life of the process.
  ipKeys(ip) {
    return { k64: this.hash(`64|${ipBucket(ip)}`), k48: this.hash(`48|${ipBucket48(ip)}`), owner: this.hash(`o|${ownerBucket(ip)}`) };
  }

  ipHash(ip) { return this.ipKeys(ip).k64; }

  // A counter key for "this address, about this thing" that shares no prefix
  // with any other counter, so counters don't visibly link a person's actions.
  scoped(ipKey, scope) { return this.hash(`s|${ipKey}|${scope}`); }

  isGuard(bucket, key) { return isGuardBucket(bucket) || key === '*'; }

  // Count one hit. Returns true if still within the limit (false also when a
  // guard counter can't be created: that source is over its share).
  hit(bucket, key, limit, windowMs, owner = '_') {
    const guard = this.isGuard(bucket, key);
    const map = guard ? this.guards : this.windows;
    const k = `${bucket}:${key}`;
    const t = this.now();
    let w = map.get(k);
    if (!w || w.reset <= t) {
      if (w) this.drop(map, k, w);
      if (guard ? !this.roomForGuard(owner) : !this.roomForTraffic()) return false;
      w = { count: 0, reset: t + windowMs, owner };
      map.set(k, w);
      if (guard) this.owners.set(owner, (this.owners.get(owner) || 0) + 1);
    }
    w.count++;
    return w.count <= limit;
  }

  count(bucket, key) {
    if (key == null) return 0;
    const w = (this.isGuard(bucket, key) ? this.guards : this.windows).get(`${bucket}:${key}`);
    return w && w.reset > this.now() ? w.count : 0;
  }

  // Mark something once in a window. Returns true if already marked, or if it
  // can't be recorded (treated as "already seen": fail closed for that source).
  seen(bucket, key, windowMs, owner = '_') {
    if (this.count(bucket, key) > 0) return true;
    return !this.hit(bucket, key, Infinity, windowMs, owner);
  }

  drop(map, k, w) {
    map.delete(k);
    if (map === this.guards) {
      const n = (this.owners.get(w.owner) || 1) - 1;
      if (n > 0) this.owners.set(w.owner, n); else this.owners.delete(w.owner);
    }
  }

  roomForGuard(owner) {
    if (owner !== '_' && (this.owners.get(owner) || 0) >= OWNER_MAX) {
      this.sweepMap(this.guards);
      if ((this.owners.get(owner) || 0) >= OWNER_MAX) return false;
    }
    if (this.guards.size < GUARD_MAX) return true;
    this.sweepMap(this.guards);
    if (this.guards.size < GUARD_MAX) return true;
    // Full of live counters: only light sources (and the site itself) may use the reserve.
    return this.guards.size < GUARD_MAX + GUARD_RESERVE && (owner === '_' || (this.owners.get(owner) || 0) < LIGHT_OWNER);
  }

  roomForTraffic() {
    if (this.windows.size < TRAFFIC_MAX) return true;
    this.sweepMap(this.windows);
    if (this.windows.size < TRAFFIC_MAX) return true;
    let n = Math.ceil(TRAFFIC_MAX / 10);
    for (const k of this.windows.keys()) { if (n-- <= 0) break; this.windows.delete(k); }
    return true;
  }

  sweepMap(map) {
    const t = this.now();
    for (const [k, w] of map) if (w.reset <= t) this.drop(map, k, w);
  }

  sweep() {
    this.sweepMap(this.windows);
    this.sweepMap(this.guards);
  }
}

// Proof-of-work difficulty: low by default, rising for an address that keeps
// posting and site-wide when total posting volume spikes. A speed bump only;
// the binding limits are the per-address and per-/48 budgets.
export function powDifficulty(limiter, ipKey, base, ipKey48 = null) {
  const mine = Math.max(limiter.count('writes', ipKey), Math.floor(limiter.count('writes48', ipKey48) / 8));
  const all = limiter.count('writes', '*');
  let factor = mine <= 2 ? 1 : Math.min(64, 2 ** (mine - 2));
  if (all > 600) factor *= 16;
  else if (all > 200) factor *= 4;
  else if (all > 80) factor *= 2;
  return Math.min(base * factor, POW_CAP);
}

export function recordWrite(limiter, ipKey, ipKey48 = null, owner = '_') {
  const window = 10 * 60 * 1000;
  limiter.hit('writes', ipKey, Infinity, window, owner);
  if (ipKey48) limiter.hit('writes48', ipKey48, Infinity, window, owner);
  limiter.hit('writes', '*', Infinity, window);
}
