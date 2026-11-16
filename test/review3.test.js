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

// ---- AI moderation and trash (reviewer 1)
import { Store } from '../src/store.js';
import { runModeration, collect, scrubNumbers } from '../src/moderation.js';

function mock(fn) {
  return { messages: { async create(p) {
    const items = JSON.parse(p.messages[0].content.split('<untrusted_items>\n')[1].split('\n</untrusted_items>')[0]);
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ decisions: items.map(fn) }) }] };
  } } };
}
const appOf = (store, client) => ({ store, config: { anthropicApiKey: 'k' }, aiClient: client, now: () => Date.now() });

test('review 3, mod 1: restore refuses to join a look-alike work with a different link', () => {
  const store = new Store(':memory:');
  const w = store.findOrCreateWork({ kind: 'film', title: 'Real Film', creator: 'D', link: null, normKey: 'film:real' });
  store.createMeeting({ id: 'meetReal0001', workId: w.id, placeId: null, format: 'video', startsUtc: Date.now() + 86400000, tz: 'UTC', venue: '', videoUrl: 'https://v.example/x', note: '', organizerTokenHash: 'o', organizerName: 'O' });
  const t = store.trashWork(w.id, { actor: 'admin', reason: 'x' });
  store.findOrCreateWork({ kind: 'film', title: 'Real Film', creator: 'D', link: 'https://phish.example/watch', normKey: 'film:real', held: true });
  assert.equal(store.restoreTrash(t), 'conflict');
  assert.ok(!store.getMeeting('meetReal0001'), 'nothing restored onto the look-alike');
  store.close();
});

test('review 3, mod 1: attendees never see the link of a work still held for review', async () => {
  const t = await startTestServer();
  try {
    const w = t.store.findOrCreateWork({ kind: 'film', title: 'Held Film', creator: 'D', link: 'https://unreviewed.example/x', normKey: 'film:held', held: true });
    const { hashToken } = await import('../src/security.js');
    t.store.createMeeting({ id: 'heldMeeting1', workId: w.id, placeId: null, format: 'video', startsUtc: Date.now() + 86400000, tz: 'UTC', venue: '', videoUrl: 'https://v.example/x', note: '', organizerTokenHash: hashToken('A'.repeat(43)), organizerName: 'O' });
    const page = await new Client(t.base).get(`/a/${'A'.repeat(43)}`);
    assert.equal(page.status, 200);
    assert.ok(!page.text.includes('unreviewed.example'));
  } finally { await t.close(); }
});

test('review 3, mod 2: the AI never removes a held work that carries other people\'s requests', async () => {
  const store = new Store(':memory:');
  const w = store.findOrCreateWork({ kind: 'film', title: 'Squatted', creator: 'X', link: 'https://casino.example', normKey: 'film:sq', held: true });
  store.createRequest({ tokenHash: 'a', workId: w.id, placeId: null, onlineOnly: true, format: 'video', status: 'held' });
  store.createRequest({ tokenHash: 'b', workId: w.id, placeId: null, onlineOnly: true, format: 'video', status: 'held' });
  const r = await runModeration(appOf(store, mock((i) => ({ item_id: i.item_id, action: 'remove', reason: 'Casino link.' }))));
  assert.ok(store.getWork(w.id), 'not removed');
  assert.match(r.flagged[0].reason, /several people/);
  store.close();
});

test('review 3, mod 5: safety reports are reviewed before older junk reports', () => {
  const store = new Store(':memory:');
  const w = store.findOrCreateWork({ kind: 'book', olKey: 'OL1W', title: 'B', creator: 'C', normKey: 'ol:OL1W' });
  for (let i = 0; i < 25; i++) {
    store.createMeeting({ id: `junkMeet${String(i).padStart(4, '0')}`, workId: w.id, placeId: null, format: 'video', startsUtc: Date.now() + 86400000, tz: 'UTC', venue: '', videoUrl: 'https://v.example/x', note: '', organizerTokenHash: `o${i}`, organizerName: 'O' });
    store.addReport(`junkMeet${String(i).padStart(4, '0')}`, 'spam', 'junk');
  }
  store.createMeeting({ id: 'safetyMeet01', workId: w.id, placeId: null, format: 'video', startsUtc: Date.now() + 86400000, tz: 'UTC', venue: '', videoUrl: 'https://v.example/x', note: '', organizerTokenHash: 'os', organizerName: 'O' });
  store.addReport('safetyMeet01', 'unsafe', 'followed me');
  const { map } = collect(store, 10);
  assert.ok([...map.values()].some((v) => v.meetingId === 'safetyMeet01'));
  store.close();
});

test('review 3, mod 6: a work the owner approved during the call is not removed', async () => {
  const store = new Store(':memory:');
  const w = store.findOrCreateWork({ kind: 'film', title: 'Race', creator: 'X', normKey: 'film:race', held: true });
  const client = mock((i) => { store.approveWork(w.id); return { item_id: i.item_id, action: 'remove', reason: 'Spam.' }; });
  await runModeration(appOf(store, client));
  assert.ok(store.getWork(w.id), 'still there');
  assert.equal(store.getWork(w.id).held, false);
  store.close();
});

test('review 3, mod 7: restore refuses expired data and a removed parent work', () => {
  let now = Date.UTC(2026, 0, 1);
  const store = new Store(':memory:', { now: () => now });
  const w = store.findOrCreateWork({ kind: 'film', title: 'Spam', creator: 'S', normKey: 'film:spam' });
  store.createRequest({ tokenHash: 'r1', workId: w.id, placeId: null, onlineOnly: true, format: 'video', status: 'open', emailEnc: 'v1.secret' });
  const reqTrash = store.trashRequest(store.requestByToken('r1').id, { actor: 'admin', reason: 'x' });
  store.trashWork(w.id, { actor: 'admin', reason: 'spam' });
  assert.equal(store.restoreTrash(reqTrash), 'work_removed');
  const w2 = store.findOrCreateWork({ kind: 'film', title: 'Old', creator: 'O', normKey: 'film:old' });
  store.createRequest({ tokenHash: 'r2', workId: w2.id, placeId: null, onlineOnly: true, format: 'video', status: 'open', emailEnc: 'v1.secret2' });
  const t2 = store.trashRequest(store.requestByToken('r2').id, { actor: 'admin', reason: 'x' });
  now += 91 * 86400000;
  assert.equal(store.restoreTrash(t2), 'expired');
  store.close();
});

test('review 3, mod 8/9: approvals are capped per run; phone numbers with any separator are scrubbed', async () => {
  for (const s of ['555/010/0123', '555_010_0123', '555,010,0123', '555–010–0123', '555 · 010 · 0123', '+1 (555) 010-0123']) {
    assert.equal(scrubNumbers(`call ${s} now`), 'call [number] now', s);
  }
  assert.equal(scrubNumbers('Catch-22, 1984, 2001'), 'Catch-22, 1984, 2001', 'short numbers survive');
  const store = new Store(':memory:');
  for (let i = 0; i < 15; i++) store.findOrCreateWork({ kind: 'film', title: `Film ${i}`, creator: 'C', normKey: `film:${i}`, held: true });
  const r = await runModeration(appOf(store, mock((i) => ({ item_id: i.item_id, action: 'approve', reason: 'Real.' }))));
  assert.equal(r.counts.approved, 10);
  assert.equal(r.flagged.filter((f) => /Approval limit/.test(f.reason)).length, 5);
  store.close();
});

test('review 3, privacy 7: review records are redacted once the item is gone', async () => {
  let now = Date.UTC(2026, 0, 1);
  const store = new Store(':memory:', { now: () => now });
  const w = store.findOrCreateWork({ kind: 'book', olKey: 'OL2W', title: 'B', creator: 'C', normKey: 'ol:OL2W' });
  store.createMeeting({ id: 'goneMeeting1', workId: w.id, placeId: null, format: 'video', startsUtc: now + 86400000, tz: 'UTC', venue: '', videoUrl: 'https://v.example/x', note: '', organizerTokenHash: 'o', organizerName: 'O' });
  store.addReport('goneMeeting1', 'participant', 'Jane Roe was rude.');
  await runModeration({ store, config: { anthropicApiKey: 'k' }, aiClient: mock((i) => ({ item_id: i.item_id, action: 'flag_for_owner', reason: 'A participant says Jane Roe was rude.' })), now: () => now });
  now += 32 * 86400000; // meeting deleted 30 days after its date
  store.cleanup();
  const [run] = store.runs(1);
  assert.ok(!JSON.stringify(run.summary).includes('Jane Roe'));
  assert.ok(!JSON.stringify(run.summary).includes('goneMeeting1'));
  store.close();
});
