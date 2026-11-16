// Regression tests for the second adversarial review (SECURITY-REVIEW.md, second pass).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RateLimiter, ipBucket, ipBucket48, isGuardBucket, POW_CAP } from '../src/ratelimit.js';
import { allowScoped } from '../src/app.js';
import { boardUnmatched, BOARD_NEARBY_KM } from '../src/matching.js';
import { Places } from '../src/geo.js';
import { OpenLibrary } from '../src/works.js';
import { Store } from '../src/store.js';
import { hashToken } from '../src/security.js';
import { startTestServer, Client, decodeEntities, tomorrow } from './helpers.js';

const places = Places.load();
const dist = (a, b) => places.distanceKm(a, b);
const locate = (id) => places.get(id);

test('finding 1: a traffic flood never evicts security counters; a full guard map fails closed', () => {
  const lim = new RateLimiter();
  for (const b of ['radius-change', 'kicked', 'work-per-ip', 'dup', 'join-meeting', 'writes', 'w:request', 'mail-to']) assert.ok(isGuardBucket(b), b);
  for (const b of ['req', 'token', 'olsearch']) assert.ok(!isGuardBucket(b), b);
  assert.equal(lim.hit('radius-change', 'r1', 3, 86400000), true);
  lim.hit('radius-change', 'r1', 3, 86400000);
  lim.hit('radius-change', 'r1', 3, 86400000);
  assert.equal(lim.hit('radius-change', 'r1', 3, 86400000), false);
  lim.seen('kicked', 'k1', 86400000);
  for (let i = 0; i < 260_000; i++) { lim.hit('req', `a${i}`, 600, 600000); lim.hit('token', `a${i}`, 200, 600000); }
  assert.ok(lim.windows.size <= 200_000, 'traffic map bounded');
  assert.equal(lim.hit('radius-change', 'r1', 3, 86400000), false, 'still limited after the flood');
  assert.equal(lim.count('kicked', 'k1'), 1, 'block survives the flood');
  // Fill the guard map from many sources: it is never evicted. Heavy sources
  // are refused when full; light sources still have reserved room (third review).
  for (let i = 0; i < 300_000; i++) lim.hit('w:x', `g${i}`, 10, 600000, `owner${i % 400}`);
  assert.equal(lim.hit('w:request', 'heavy-new', 10, 600000, 'owner1'), false, 'a heavy source is refused');
  assert.equal(lim.seen('dup', 'heavy-dup', 600000, 'owner1'), true, 'fails closed for that source');
  assert.equal(lim.hit('w:request', 'light-new', 10, 600000, 'honest-newcomer'), true, 'a light source still gets in');
  assert.equal(lim.count('kicked', 'k1'), 1);
});

test('finding 2: budgets also apply per /48, so one tunnel can\'t multiply them', () => {
  assert.equal(ipBucket48('2001:470:1f0b:1::1'), ipBucket48('2001:470:1f0b:ffff::9'));
  assert.notEqual(ipBucket('2001:470:1f0b:1::1'), ipBucket('2001:470:1f0b:2::1'));
  const limiter = new RateLimiter();
  const ctxFor = (ip) => { const k = limiter.ipKeys(ip); return { app: { limiter }, ipKey: k.k64, ipKey48: k.k48 }; };
  let ok = 0;
  for (let i = 0; i < 50; i++) if (allowScoped(ctxFor(`2001:470:1f0b:${i.toString(16)}::1`), 'work-per-ip', 'work:7', 3, 86400000)) ok++;
  assert.equal(ok, 12, '3 per /64 but 12 per /48');
  assert.equal(allowScoped(ctxFor('2001:db8:1:1::1'), 'work-per-ip', 'work:7', 3, 86400000), true, 'another /48 unaffected');
});

test('finding 3: the board stays fast with 10,000 requests for one work', () => {
  const ids = places.list.slice(0, 10_000).map((p) => p.id);
  const reqs = ids.map((placeId, i) => ({ id: i + 1, workId: 1, placeId, onlineOnly: false, format: 'in_person', radiusKm: 25 }));
  const t0 = performance.now();
  boardUnmatched(reqs, dist, locate);
  const ms = performance.now() - t0;
  assert.ok(ms < 1500, `took ${ms.toFixed(0)} ms`);
});

test('finding 3: the grid gives the same answer as checking every pair', () => {
  let seed = 11;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed % n; };
  const pool = [5746545, 5713376, 4975802, 2988507, 5750162, 2950159, 3117735, 1850147, 2147714, 2643743, 3435910, 6167865];
  const fmts = ['in_person', 'video', 'either'];
  for (let round = 0; round < 60; round++) {
    const reqs = Array.from({ length: 14 }, (_, i) => {
      const online = rnd(6) === 0;
      return { id: i + 1, workId: rnd(2), placeId: online ? null : pool[rnd(pool.length)], onlineOnly: online, format: online ? 'video' : fmts[rnd(3)], radiusKm: [25, 50, 100, 200][rnd(4)] };
    });
    const fixed = (a, b) => a.workId === b.workId && a.id !== b.id && (
      ((a.format !== 'in_person') && (b.format !== 'in_person'))
      || (a.format !== 'video' && b.format !== 'video' && a.placeId && b.placeId && dist(a.placeId, b.placeId) <= BOARD_NEARBY_KM));
    const brute = reqs.filter((r) => !reqs.some((o) => fixed(r, o))).map((r) => r.id).sort();
    assert.deepEqual(boardUnmatched(reqs, dist, locate).map((r) => r.id).sort(), brute);
  }
});

test('finding 4: whether a request is on the board does not depend on anyone\'s chosen distance', () => {
  const BOSTON = 4930956; const HARTFORD = 4835797; const SALEM = 5750162; const PORTLAND = 5746545;
  for (const [a, b] of [[BOSTON, HARTFORD], [PORTLAND, SALEM]]) {
    const results = new Set();
    for (const r1 of [25, 50, 100, 200]) for (const r2 of [25, 50, 100, 200]) {
      const reqs = [
        { id: 1, workId: 1, placeId: a, onlineOnly: false, format: 'in_person', radiusKm: r1 },
        { id: 2, workId: 1, placeId: b, onlineOnly: false, format: 'in_person', radiusKm: r2 },
      ];
      results.add(JSON.stringify(boardUnmatched(reqs, dist, locate).map((r) => r.id)));
    }
    assert.equal(results.size, 1, 'same board for every combination of distances');
  }
});

test('finding 4: over HTTP, the board is the same however far people said they would travel', async () => {
  const boards = [];
  for (const radius of ['50', '200']) {
    const t = await startTestServer();
    try {
      for (const [q, place] of [['portland', '5746545'], ['salem', '5750162']]) {
        const r = await new Client(t.base).submit(`/request/new/details?manual=1&place_q=${q}`, '/request', {
          kind: 'book', title: 'The Overstory', creator: 'Richard Powers', place, format: 'in_person', radius,
        });
        assert.equal(r.status, 303);
      }
      boards.push((await new Client(t.base).get('/board')).text.includes('The Overstory'));
    } finally { await t.close(); }
  }
  assert.deepEqual(boards, [true, true]);
});

test('finding 5: required proof-of-work is capped however multipliers stack', async () => {
  const t = await startTestServer({ overrides: { powBase: POW_CAP } });
  try {
    const p = await new Client(t.base).get('/request/new/details?manual=1');
    const all = JSON.parse(decodeEntities(/data-challenges="([^"]+)"/.exec(p.text)[1]));
    for (const ch of Object.values(all)) assert.ok(ch.maxnumber <= POW_CAP, `${ch.maxnumber}`);
  } finally { await t.close(); }
});

test('finding 6: catalogue titles are cleaned, and work references expire', async () => {
  const ol = new OpenLibrary('https://x.invalid', {
    fetchImpl: async () => new Response(JSON.stringify({ docs: [{ key: '/works/OL1W', title: 'Deschooling Society free PDF at https://evil.example/dl', author_name: ['Ivan Illich', 'evil.example'] }] })),
  });
  const [r] = await ol.search('deschooling');
  assert.ok(!r.title.includes('evil'), r.title);
  assert.ok(!r.creator.includes('evil'), r.creator);

  let now = Date.now();
  const t = await startTestServer({ now: () => now });
  try {
    const c = new Client(t.base);
    const href = decodeEntities(/href="(\/request\/new\/details\?w=[^"]+)"/.exec((await c.get('/request/new?q=deschooling')).text)[1]);
    assert.equal((await c.get(href)).status, 200);
    now += 25 * 3600 * 1000;
    assert.equal((await c.get(href)).status, 404, 'expired reference');
  } finally { await t.close(); }
});

test('finding 7: no email for held requests, no typed text in emails, and a cap per address', async () => {
  const t = await startTestServer();
  try {
    t.store.setSetting('hold_manual', '1');
    const post = (title, email) => new Client(t.base).submit('/request/new/details?manual=1', '/request', {
      kind: 'article', title, creator: 'Pharmacy Deals call 555 0100', place: 'online', format: 'video', email,
    });
    assert.equal((await post('CHEAP MEDS CALL 555 0100 NOW', 'victim@example.org')).status, 303);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(t.mailer.sent.length, 0, 'held: nothing sent');
    t.store.setSetting('hold_manual', '0');
    for (let i = 0; i < 5; i++) await post(`Spam title number ${i}`, 'victim@example.org');
    await new Promise((r) => setTimeout(r, 30));
    const toVictim = t.mailer.sent.filter((m) => m.to === 'victim@example.org');
    assert.ok(toVictim.length <= 3, `${toVictim.length} mails`);
    for (const m of toVictim) assert.ok(!/555|Spam title|Pharmacy/.test(m.text), 'no attacker text');
  } finally { await t.close(); }
});

test('finding 8: cached searches are always served; only real catalogue calls count toward the global cap', async () => {
  let fetches = 0;
  const ol = new OpenLibrary('https://x.invalid', { fetchImpl: async () => { fetches++; return new Response(JSON.stringify({ docs: [] })); } });
  await ol.search('cached query');
  assert.deepEqual(await ol.search('cached query', { allowFetch: () => false }), []);
  assert.equal(fetches, 1);
  await assert.rejects(ol.search('new query', { allowFetch: () => false }));
});

test('finding 9: a removal still blocks rejoining after the daily key rotation', async () => {
  let now = Date.now();
  const t = await startTestServer({ now: () => now });
  try {
    const org = new Client(t.base);
    const posted = await org.submit('/request/new/details?manual=1', '/request', { kind: 'book', title: 'Middlemarch', creator: 'George Eliot', place: 'online', format: 'video' });
    const tok = /^\/r\/([A-Za-z0-9_-]{43})/.exec(posted.location)[1];
    const date = new Date(now + 4 * 86400000).toISOString().slice(0, 10);
    const res = await org.submit(`/r/${tok}/meet`, `/r/${tok}/meet`, { date, time: '18:00', tz: 'UTC', format: 'video', video_url: 'https://meet.jit.si/rebel-x', name: 'Org' });
    const orgToken = /^\/a\/([A-Za-z0-9_-]{43})/.exec(res.location)[1];
    const mid = /href="\/m\/([A-Za-z0-9_-]{12})\/report"/.exec((await org.get(`/a/${orgToken}`)).text)[1];
    const troll = new Client(t.base);
    assert.equal((await troll.submit(`/m/${mid}`, `/m/${mid}/join`, { name: 'T' })).status, 303);
    now += 20 * 3600 * 1000;
    const page = await org.get(`/a/${orgToken}`);
    await org.submit(`/a/${orgToken}`, `/a/${orgToken}/remove`, { attendee: /name="attendee" value="(\d+)"/.exec(page.text)[1] }, { page });
    now += 6 * 3600 * 1000; // past the 24 h key rotation
    assert.equal((await troll.submit(`/m/${mid}`, `/m/${mid}/join`, { name: 'T2' })).status, 429);
  } finally { await t.close(); }
});

test('finding 10: memory holds no counter that links one address to several works or meetings', async () => {
  const t = await startTestServer();
  try {
    for (const title of ['Work One', 'Work Two']) {
      const r = await new Client(t.base).submit('/request/new/details?manual=1', '/request', { kind: 'book', title, creator: 'X', place: 'online', format: 'video' });
      assert.equal(r.status, 303);
    }
    const ipKey = t.app.limiter.ipKeys('127.0.0.1').k64;
    const scopedKeys = [...t.app.limiter.guards.keys()].filter((k) => /^(work-per-ip|dup|join-meeting)/.test(k));
    assert.ok(scopedKeys.length >= 4);
    for (const k of scopedKeys) assert.ok(!k.includes(ipKey), k);
  } finally { await t.close(); }
});

test('finding 11: deleted rows are flushed out of the write-ahead log', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ru-wal-'));
  const file = path.join(dir, 'x.db');
  const store = new Store(file);
  const w = store.findOrCreateWork({ kind: 'book', olKey: 'OL1W', title: 'T', normKey: 'ol:OL1W' });
  const tokenHash = hashToken('secret-token-value');
  const r = store.createRequest({ tokenHash, workId: w.id, placeId: null, onlineOnly: true, format: 'video', status: 'open', emailEnc: 'v1.ENCRYPTED-EMAIL' });
  store.deleteRequest(r.id);
  for (const f of fs.readdirSync(dir)) {
    const buf = fs.readFileSync(path.join(dir, f));
    assert.ok(!buf.includes(tokenHash), `${f} still holds the deleted row`);
    assert.ok(!buf.includes('ENCRYPTED-EMAIL'), `${f} still holds the deleted email`);
  }
  store.close();
  fs.rmSync(dir, { recursive: true });
});
