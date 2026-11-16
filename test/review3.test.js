// Regression tests for the third adversarial review (SECURITY-REVIEW.md, third pass).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RateLimiter, normalizeIp, ipBucket, ownerBucket } from '../src/ratelimit.js';
import { ProofOfWork } from '../src/pow.js';
import { startTestServer, Client, solve, decodeEntities, tomorrow } from './helpers.js';

test('review 3, core 1: one source cannot fill the guard map; others are unaffected', () => {
  const lim = new RateLimiter();
  let refused = 0;
  for (let i = 0; i < 5000; i++) if (!lim.hit('join-meeting', `k${i}`, 3, 86400000, 'attacker-48')) refused++;
  assert.ok(refused >= 4000, `owner capped (refused ${refused})`);
  assert.ok(lim.guards.size <= 1001);
  assert.equal(lim.hit('w:request', 'someone', 12, 3600000, 'honest'), true);
});

test('review 3, core 1: refused joins (closed meeting) create no counters', async () => {
  const t = await startTestServer();
  try {
    const org = new Client(t.base);
    const posted = await org.submit('/request/new/details?manual=1', '/request', { kind: 'book', title: 'Closed Book', creator: 'C', place: 'online', format: 'video' });
    const tok = /^\/r\/([A-Za-z0-9_-]{43})/.exec(posted.location)[1];
    const res = await org.submit(`/r/${tok}/meet`, `/r/${tok}/meet`, { date: tomorrow(), time: '18:00', tz: 'UTC', format: 'video', video_url: 'https://meet.jit.si/x', name: 'O' });
    const orgToken = /^\/a\/([A-Za-z0-9_-]{43})/.exec(res.location)[1];
    const page = await org.get(`/a/${orgToken}`);
    await org.submit(`/a/${orgToken}`, `/a/${orgToken}/close`, {}, { page });
    const mid = /href="\/m\/([A-Za-z0-9_-]{12})\/report"/.exec(page.text)[1];
    const before = t.app.limiter.guards.size;
    // The closed meeting has no join form; post directly with a valid challenge for 'join'.
    const c = new Client(t.base);
    const reportPage = await c.get(`/m/${mid}/report`);
    const csrf = /name="_csrf" value="([^"]+)"/.exec(reportPage.text)[1];
    const ch = t.app.pow.create(t.app.powDifficulty(t.app.limiter.ipHash('127.0.0.1')), t.app.limiter.ipHash('127.0.0.1'), 1, 'join');
    const r = await c.request('POST', `/m/${mid}/join`, { _csrf: csrf, pow: solve(ch), name: 'Spam' });
    assert.equal(r.status, 409);
    assert.equal(t.app.limiter.guards.size, before, 'no counters created for a refused join');
  } finally { await t.close(); }
});

test('review 3, core 6/9: proof-of-work is bound to its form and no longer reveals key rotation', () => {
  const pow = new ProofOfWork();
  const ch = pow.create(100, 'abcdefgh', 1, 'report');
  assert.equal(pow.verify(solve(ch), { ipKey: 'abcdefgh', action: 'join' }).reason, 'action');
  assert.equal(pow.verify(solve(pow.create(100, 'abcdefgh', 1, 'join')), { ipKey: 'abcdefgh', action: 'join' }).ok, true);
  let now = 0;
  const lim = new RateLimiter({ now: () => now });
  const k1 = lim.ipKeys('203.0.113.9').k64;
  now += 3 * 86400000;
  assert.equal(lim.ipKeys('203.0.113.9').k64, k1, 'stable for the life of the process: budgets do not reset daily');
});

test('review 3, core 6: a per-work probe budget does not reset after a day', () => {
  let now = 0;
  const lim = new RateLimiter({ now: () => now });
  const k = lim.scoped(lim.ipHash('198.51.100.7'), 'work:1');
  for (let i = 0; i < 3; i++) assert.equal(lim.hit('work-per-ip', k, 3, 86400000, 'o'), true);
  assert.equal(lim.hit('work-per-ip', k, 3, 86400000, 'o'), false);
  now += 86400000 - 60000; // just before the window ends
  assert.equal(lim.hit('work-per-ip', lim.scoped(lim.ipHash('198.51.100.7'), 'work:1'), 3, 86400000, 'o'), false);
});

test('review 3, core 10: odd address spellings normalize; non-addresses are not used as keys', () => {
  assert.equal(normalizeIp('::ffff:0102:0304'), '1.2.3.4');
  assert.equal(normalizeIp('0:0:0:0:0:ffff:1.2.3.4'), '1.2.3.4');
  assert.equal(normalizeIp('::ffff:1.2.3.4'), '1.2.3.4');
  assert.equal(normalizeIp('1.2.3.4, 5.6.7.8'), null);
  assert.equal(ipBucket('1.2.3.4, 5.6.7.8'), 'invalid');
  assert.equal(ownerBucket('203.0.113.77'), '203.0.113.0/24');
  assert.equal(ownerBucket('2001:db8:1:2::1'), '2001:db8:1::/48');
});

test('review 3, core 10: an invalid Fly-Client-IP header falls back to the socket address', async () => {
  const { clientIp } = await import('../src/http.js');
  const req = (h) => ({ headers: h, socket: { remoteAddress: '10.0.0.1' } });
  assert.equal(clientIp(req({ 'fly-client-ip': '1.2.3.4, 5.6.7.8' }), true), '10.0.0.1');
  assert.equal(clientIp(req({ 'fly-client-ip': '2001:db8::1' }), true), '2001:db8::1');
});

test('review 3, core 3: a removal block holds for days, until after the meeting', async () => {
  let now = Date.now();
  const t = await startTestServer({ now: () => now });
  try {
    const org = new Client(t.base);
    const posted = await org.submit('/request/new/details?manual=1', '/request', { kind: 'book', title: 'Long Block', creator: 'C', place: 'online', format: 'video' });
    const tok = /^\/r\/([A-Za-z0-9_-]{43})/.exec(posted.location)[1];
    const date = new Date(now + 6 * 86400000).toISOString().slice(0, 10);
    const res = await org.submit(`/r/${tok}/meet`, `/r/${tok}/meet`, { date, time: '18:00', tz: 'UTC', format: 'video', video_url: 'https://meet.jit.si/y', name: 'O' });
    const orgToken = /^\/a\/([A-Za-z0-9_-]{43})/.exec(res.location)[1];
    const mid = /href="\/m\/([A-Za-z0-9_-]{12})\/report"/.exec((await org.get(`/a/${orgToken}`)).text)[1];
    const troll = new Client(t.base);
    assert.equal((await troll.submit(`/m/${mid}`, `/m/${mid}/join`, { name: 'T' })).status, 303);
    now += 26 * 3600 * 1000; // removed more than a day after joining
    const page = await org.get(`/a/${orgToken}`);
    await org.submit(`/a/${orgToken}`, `/a/${orgToken}/remove`, { attendee: /name="attendee" value="(\d+)"/.exec(page.text)[1] }, { page });
    now += 3 * 86400000;
    assert.equal((await troll.submit(`/m/${mid}`, `/m/${mid}/join`, { name: 'T2' })).status, 429);
  } finally { await t.close(); }
});
