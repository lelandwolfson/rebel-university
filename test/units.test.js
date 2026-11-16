import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { html, raw, esc } from '../src/html.js';
import { clean, stripUrls, safeHttpsUrl, emailShape, normalizeForKey } from '../src/text.js';
import { newToken, hashToken, isTokenShape, signValue, verifyValue, encrypt, decrypt } from '../src/security.js';
import { ProofOfWork } from '../src/pow.js';
import { RateLimiter, powDifficulty, recordWrite } from '../src/ratelimit.js';
import { zonedToUtc, utcToZoned, isTimeZone } from '../src/tz.js';
import { Places } from '../src/geo.js';
import { manualNormKey } from '../src/works.js';
import { Store } from '../src/store.js';

const key = crypto.randomBytes(32);

test('html escapes interpolations by default', () => {
  const evil = '<script>alert("x")</script>\'`&';
  assert.equal(String(html`<p>${evil}</p>`), `<p>${esc(evil)}</p>`);
  assert.ok(!String(html`<a href="${'" onmouseover="x'}">`).includes('" onmouseover'));
  assert.equal(String(html`${raw('<b>')}`), '<b>');
  assert.equal(String(html`${[html`<i>${'<'}</i>`, '<']}`), '<i>&lt;</i>&lt;');
  assert.equal(String(html`${null}${undefined}${false}`), '');
});

test('clean strips control characters, URLs, and caps length', () => {
  assert.equal(clean('a\u0000b\u202ec', 10), 'a b c');
  assert.equal(clean('see https://spam.example/x now', 100), 'see now');
  assert.equal(clean('visit www.spam.biz today', 100), 'visit today');
  assert.equal(clean('buy at spam.com/pills', 100), 'buy at');
  assert.equal(clean('mail me@example.org', 100), 'mail');
  assert.equal(clean('javascript:alert(1)', 100), '');
  assert.equal(clean('Café Luna, 12 Main St.', 100), 'Café Luna, 12 Main St.');
  assert.equal(clean('J.R.R. Tolkien', 100), 'J.R.R. Tolkien');
  assert.equal(clean('x'.repeat(50), 10), 'x'.repeat(10));
  assert.equal(clean(123, 10), '');
  assert.equal(stripUrls('ftp://a.b'), '');
});

test('safeHttpsUrl accepts only plain https links', () => {
  assert.equal(safeHttpsUrl('https://meet.jit.si/MyRoom'), 'https://meet.jit.si/MyRoom');
  for (const bad of ['http://x.com', 'javascript:alert(1)', 'https://user:pw@x.com', 'https://localhost/', 'https://x.com/"onx',
    'data:text/html,hi', 'https://x.com:8443/', ' ', 'https://' + 'a'.repeat(400) + '.com', '//x.com']) {
    assert.equal(safeHttpsUrl(bad), null, bad);
  }
});

test('emailShape', () => {
  assert.equal(emailShape(' a@b.org '), 'a@b.org');
  for (const bad of ['a', 'a@b', 'a b@c.org', 'a@b.org\r\nBcc: x@y.org', 'a@b.org,c@d.org']) assert.equal(emailShape(bad), null, bad);
});

test('manual works match across case, accents, punctuation, and leading articles', () => {
  assert.equal(manualNormKey('film', 'The Battle of Algiers', 'Gillo Pontecorvo'), manualNormKey('film', 'battle of algiers!', 'GILLO  PONTECORVO'));
  assert.equal(normalizeForKey('Amélie'), 'amelie');
  assert.notEqual(manualNormKey('film', 'X', 'Y'), manualNormKey('article', 'X', 'Y'));
});

test('tokens are long, random, and stored as hashes', () => {
  const t = newToken();
  assert.ok(isTokenShape(t));
  assert.equal(t.length, 43);
  assert.notEqual(newToken(), t);
  assert.equal(hashToken(t).length, 64);
  assert.ok(!isTokenShape('short'));
  assert.ok(!isTokenShape(t + '/'));
});

test('signed values reject tampering', () => {
  const s = signValue(key, { k: 'ol', ol: 'OL1W' });
  assert.deepEqual(verifyValue(key, s), { k: 'ol', ol: 'OL1W' });
  const [p, sig] = s.split('.');
  const forged = Buffer.from(JSON.stringify({ k: 'ol', ol: 'OL2W' })).toString('base64url');
  assert.equal(verifyValue(key, `${forged}.${sig}`), null);
  assert.equal(verifyValue(crypto.randomBytes(32), s), null);
  assert.equal(verifyValue(key, p), null);
});

test('email encryption round-trips and detects tampering', () => {
  const box = encrypt(key, 'a@b.org');
  assert.ok(!box.includes('a@b.org'));
  assert.equal(decrypt(key, box), 'a@b.org');
  assert.equal(decrypt(crypto.randomBytes(32), box), null);
  const parts = box.split('.');
  parts[2] = Buffer.from('zzzzzzz').toString('base64url');
  assert.equal(decrypt(key, parts.join('.')), null);
});

export function solvePow(ch) {
  for (let n = 0; n <= ch.maxnumber; n++) {
    if (crypto.createHash('sha256').update(ch.salt + n).digest('hex') === ch.challenge) {
      return Buffer.from(JSON.stringify({ algorithm: ch.algorithm, challenge: ch.challenge, number: n, salt: ch.salt, signature: ch.signature })).toString('base64');
    }
  }
  throw new Error('unsolvable');
}

test('proof of work verifies, rejects replay, forgery, and expiry', () => {
  let now = 1_000_000;
  const pow = new ProofOfWork(key, { now: () => now });
  const ch = pow.create(500, 'ipA');
  const sol = solvePow(ch);
  assert.equal(pow.verify(sol, { ipKey: 'ipA' }).ok, true);
  assert.equal(pow.verify(sol, { ipKey: 'ipA' }).reason, 'replay');

  const ch2 = pow.create(500, 'ipA');
  const p = JSON.parse(Buffer.from(solvePow(ch2), 'base64').toString());
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64');
  assert.equal(pow.verify(enc({ ...p, salt: p.salt.replace(/i=\d+/, 'i=0') }), { ipKey: 'ipA' }).ok, false);
  assert.equal(pow.verify(enc({ ...p, number: p.number + 1 }), { ipKey: 'ipA' }).ok, false);
  const otherKey = new ProofOfWork(crypto.randomBytes(32), { now: () => now });
  assert.equal(otherKey.verify(solvePow(ch2), { ipKey: 'ipA' }).reason, 'signature', 'a restart (new key) invalidates old solutions');

  const ch3 = pow.create(10, 'ipA');
  now += 2 * 3600 * 1000;
  assert.equal(pow.verify(solvePow(ch3), { ipKey: 'ipA' }).reason, 'expired');
  assert.equal(pow.verify('garbage').ok, false);
  assert.equal(pow.verify(undefined).ok, false);
});

test('proof of work: review finding 3, digits moved from number into the expiry are rejected', () => {
  const pow = new ProofOfWork(key);
  // Find a challenge whose answer has 2+ digits, then shift its first digits into the salt.
  let ch, p;
  do { ch = pow.create(5000, 'ip'); p = JSON.parse(Buffer.from(solvePow(ch), 'base64').toString()); } while (p.number < 100);
  const s = String(p.number);
  // Move all but the last digit to the end of the salt (after &k=..., or for the old format after &e=).
  const forged = { ...p, salt: p.salt + s.slice(0, -1), number: Number(s.slice(-1)) };
  assert.equal(crypto.createHash('sha256').update(forged.salt + forged.number).digest('hex'), p.challenge, 'hash still matches');
  assert.equal(pow.verify(Buffer.from(JSON.stringify(forged)).toString('base64'), { ipKey: 'ip' }).ok, false);
});

test('proof of work: review finding 2, challenges are bound to the IP and to the current difficulty', () => {
  const pow = new ProofOfWork(key);
  assert.equal(pow.verify(solvePow(pow.create(100, 'ipA')), { ipKey: 'ipB' }).reason, 'ip');
  assert.equal(pow.verify(solvePow(pow.create(100, 'ipA')), { ipKey: 'ipA', minMax: 400 }).reason, 'difficulty');
  assert.equal(pow.verify(solvePow(pow.create(400, 'ipA')), { ipKey: 'ipA', minMax: 400 }).ok, true);
});

test('proof of work difficulty rises per IP and site-wide', () => {
  const lim = new RateLimiter();
  const base = 1000;
  assert.equal(powDifficulty(lim, 'ip1', base), base);
  for (let i = 0; i < 5; i++) recordWrite(lim, 'ip1');
  assert.ok(powDifficulty(lim, 'ip1', base) > base);
  assert.equal(powDifficulty(lim, 'ip2', base), base);
  for (let i = 0; i < 300; i++) recordWrite(lim, `ip-${i}`);
  assert.ok(powDifficulty(lim, 'ip2', base) > base);
});

test('rate limiter windows expire', () => {
  let now = 0;
  const lim = new RateLimiter({ now: () => now });
  assert.equal(lim.hit('b', 'k', 2, 1000), true);
  assert.equal(lim.hit('b', 'k', 2, 1000), true);
  assert.equal(lim.hit('b', 'k', 2, 1000), false);
  now = 1001;
  assert.equal(lim.hit('b', 'k', 2, 1000), true);
  assert.equal(lim.seen('d', 'x', 1000), false);
  assert.equal(lim.seen('d', 'x', 1000), true);
  assert.notEqual(lim.ipHash('1.2.3.4'), '1.2.3.4');
});

test('time zones convert wall time to UTC, including DST', () => {
  assert.equal(zonedToUtc('2026-07-01', '10:00', 'Europe/Paris'), Date.UTC(2026, 6, 1, 8, 0));
  assert.equal(zonedToUtc('2026-01-15', '10:00', 'Europe/Paris'), Date.UTC(2026, 0, 15, 9, 0));
  assert.equal(zonedToUtc('2026-01-15', '10:00', 'America/Los_Angeles'), Date.UTC(2026, 0, 15, 18, 0));
  assert.equal(zonedToUtc('2026-03-14', '23:30', 'Asia/Kolkata'), Date.UTC(2026, 2, 14, 18, 0));
  assert.equal(zonedToUtc('2026-02-30', '10:00', 'UTC'), null);
  assert.equal(zonedToUtc('2026-01-01', '25:00', 'UTC'), null);
  assert.equal(zonedToUtc('2026-01-01', '10:00', 'Mars/Base'), null);
  const ms = zonedToUtc('2026-11-01', '09:15', 'America/New_York');
  assert.deepEqual(utcToZoned(ms, 'America/New_York'), { date: '2026-11-01', time: '09:15' });
  assert.ok(isTimeZone('UTC'));
});

test('city search finds places and ranks bigger cities first', () => {
  const places = Places.load();
  const r = places.search('portland');
  assert.equal(r[0].name, 'Portland');
  assert.equal(r[0].region, 'Oregon');
  assert.equal(places.search('portland, maine')[0].region, 'Maine');
  assert.ok(places.search('zurich').some((p) => p.cc === 'CH'));
  assert.ok(places.search('são paulo').length > 0);
  assert.deepEqual(places.search('x'), []);
  assert.equal(places.regionLabel(5746545), 'Oregon, United States');
});

test('store cleanup deletes expired requests, old meetings, and orphan works', () => {
  let now = Date.UTC(2026, 0, 1);
  const store = new Store(':memory:', { now: () => now });
  const w = store.findOrCreateWork({ kind: 'book', olKey: 'OL1W', title: 'T', normKey: 'ol:OL1W' });
  store.createRequest({ tokenHash: 'a', workId: w.id, placeId: null, onlineOnly: true, format: 'video', status: 'open', emailEnc: 'v1.x' });
  store.createMeeting({ id: 'm1', workId: w.id, placeId: null, format: 'video', startsUtc: now + 86400000, tz: 'UTC', venue: '', videoUrl: 'https://x.org', note: '', organizerTokenHash: 'o', organizerName: 'O' });
  now += 32 * 86400000; // meeting was day 1; deleted 30 days later
  let r = store.cleanup();
  assert.equal(r.meetings, 1);
  assert.equal(r.requests, 0);
  assert.equal(store.attendeeByToken('o'), undefined);
  now += 57 * 86400000; // day 89: request still open
  assert.equal(store.cleanup().requests, 0);
  now += 2 * 86400000; // day 91: request expired
  r = store.cleanup();
  assert.equal(r.requests, 1);
  assert.equal(r.works, 1);
  assert.equal(store.getWork(w.id), undefined);
  store.close();
});

test('review finding 4: IPv6 addresses share a limit per /64, IPv4 per address', async () => {
  const { ipBucket } = await import('../src/ratelimit.js');
  assert.equal(ipBucket('2001:db8:1:2:aaaa::1'), ipBucket('2001:db8:1:2:bbbb:cccc:dddd:eeee'));
  assert.notEqual(ipBucket('2001:db8:1:2::1'), ipBucket('2001:db8:1:3::1'));
  assert.equal(ipBucket('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(ipBucket('::ffff:1.2.3.4'), '1.2.3.4');
  assert.notEqual(ipBucket('1.2.3.4'), ipBucket('1.2.3.5'));
  const lim = new RateLimiter();
  assert.equal(lim.ipHash('2001:db8:1:2::1'), lim.ipHash('2001:db8:1:2:ffff::9'));
});

test('review finding 4: X-Forwarded-For is never trusted; Fly-Client-IP only behind the proxy', async () => {
  const { clientIp } = await import('../src/http.js');
  const req = (headers) => ({ headers, socket: { remoteAddress: '10.0.0.1' } });
  assert.equal(clientIp(req({ 'x-forwarded-for': '6.6.6.6' }), true), '10.0.0.1');
  assert.equal(clientIp(req({ 'fly-client-ip': '7.7.7.7' }), true), '7.7.7.7');
  assert.equal(clientIp(req({ 'fly-client-ip': '7.7.7.7' }), false), '10.0.0.1');
});

test('review finding 4: limiter memory stays bounded under address rotation', () => {
  const lim = new RateLimiter();
  for (let i = 0; i < 230_000; i++) lim.hit('req', `k${i}`, 10, 60_000);
  assert.ok(lim.windows.size <= 200_000);
});

test('review finding 7: unmatched() agrees with pairwise compatible() on random data', async () => {
  const { unmatched, compatible } = await import('../src/matching.js');
  const places = Places.load();
  const dist = (a, b) => places.distanceKm(a, b);
  const spots = [5746545, 5713376, 4975802, 2988507, null];
  const fmts = ['in_person', 'video', 'either'];
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed % n; };
  for (let round = 0; round < 50; round++) {
    const reqs = Array.from({ length: 12 }, (_, i) => {
      const p = spots[rnd(spots.length)];
      return { id: i + 1, workId: rnd(3), placeId: p, onlineOnly: p == null, format: p == null ? 'video' : fmts[rnd(3)] };
    });
    const brute = reqs.filter((r) => !reqs.some((o) => compatible(r, o, dist))).map((r) => r.id);
    assert.deepEqual(unmatched(reqs, dist).map((r) => r.id).sort(), brute.sort());
  }
});

test('review finding 11: Open Library responses over 2 MB are refused while streaming', async () => {
  const { OpenLibrary } = await import('../src/works.js');
  const big = new ReadableStream({ start(c) { for (let i = 0; i < 30; i++) c.enqueue(new Uint8Array(100_000)); c.close(); } });
  const ol = new OpenLibrary('https://x.invalid', { fetchImpl: async () => new Response(big) });
  await assert.rejects(ol.search('anything'), /too large/);
});

test('review finding 12: obfuscated and internationalized links are stripped', () => {
  for (const s of ['evil。com', 'evil．com', 'пример.рф', 'evil . com', 'evil[.]com', 'evil(dot)com']) assert.equal(clean(`go ${s} now`, 100), 'go now', s);
});
