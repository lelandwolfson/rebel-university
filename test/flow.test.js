import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, Client, ADMIN_SECRET, tomorrow, decodeEntities } from './helpers.js';
import { hashToken } from '../src/security.js';

const PORTLAND = '5746545';
const BEAVERTON = '5713376';
const PARIS = '2988507';

let s;
before(async () => { s = await startTestServer(); });
after(async () => { await s.close(); });

// Search, pick a book, find a city, post a request. Returns the private token.
async function postRequest(c, { q = 'deschooling', placeQ = 'portland', place = PORTLAND, format = 'either', email } = {}) {
  const search = await c.get(`/request/new?q=${encodeURIComponent(q)}`);
  assert.equal(search.status, 200);
  const href = decodeEntities(/href="(\/request\/new\/details\?w=[^"]+)"/.exec(search.text)[1]);
  const details = `${href}&place_q=${encodeURIComponent(placeQ)}`;
  const res = await c.submit(details, '/request', { place, format, email });
  assert.equal(res.status, 303, res.text.slice(0, 2000));
  const m = /^\/r\/([A-Za-z0-9_-]{43})\?new=1$/.exec(res.location);
  assert.ok(m, res.location);
  return m[1];
}

const state = {};

test('security headers on every page', async () => {
  const c = new Client(s.base);
  const r = await c.get('/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy'), /default-src 'none'/);
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(r.headers.get('referrer-policy'), 'same-origin');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.match(r.text, /adults \(18\+\)/i);
  assert.ok(!/<script(?![^>]*src="\/static\/)/.test(r.text), 'no inline scripts');
});

test('two people post requests for the same book and match', async () => {
  const a = new Client(s.base);
  const b = new Client(s.base);
  state.a = a; state.b = b;
  state.tokenA = await postRequest(a, { email: 'reader-a@example.org' });
  const pageA0 = await a.get(`/r/${state.tokenA}?new=1`);
  assert.equal(pageA0.status, 200);
  assert.match(pageA0.text, /Save this page/);
  assert.match(pageA0.text, /Nobody else has asked/);

  state.tokenB = await postRequest(b, { placeQ: 'beaverton', place: BEAVERTON, format: 'in_person' });
  const pageA = await a.get(`/r/${state.tokenA}`);
  assert.match(pageA.text, /1 other person wants to discuss this work/);
  const pageB = await b.get(`/r/${state.tokenB}`);
  assert.match(pageB.text, /1 other person/);

  // Only hashes are stored.
  const row = s.store.db.prepare('SELECT * FROM requests').all();
  assert.equal(row.length, 2);
  assert.ok(!JSON.stringify(row).includes(state.tokenA));
  assert.ok(s.store.requestByToken(hashToken(state.tokenA)));
  // Email is encrypted at rest.
  assert.ok(!JSON.stringify(row).includes('reader-a@example.org'));
});

test('email: confirmation with the link, then one match notice', async () => {
  await new Promise((r) => setTimeout(r, 50));
  const toA = s.mailer.sent.filter((m) => m.to === 'reader-a@example.org');
  assert.equal(toA.length, 2);
  assert.ok(toA[0].text.includes(`/r/${state.tokenA}`));
  assert.match(toA[1].text, /Someone else wants to discuss "Deschooling Society"/);
  assert.ok(!toA[1].text.includes(state.tokenB));
  assert.match(toA[1].text, /public place/);
});

test('open board shows unmatched works by region only', async () => {
  const c = new Client(s.base);
  state.tokenC = await postRequest(c, { q: 'pedagogy', placeQ: 'paris', place: PARIS, format: 'in_person' });
  const board = await c.get('/board');
  assert.match(board.text, /Pedagogy of the Oppressed/);
  assert.match(board.text, /Île-de-France, France/);
  assert.ok(!board.text.includes('Deschooling Society'), 'matched works are not on the board');
  assert.ok(!/Paris, France/.test(board.text), 'city not shown on board');
});

test('duplicate request from the same connection is rejected', async () => {
  const c = new Client(s.base);
  const search = await c.get('/request/new?q=pedagogy');
  const href = decodeEntities(/href="(\/request\/new\/details\?w=[^"]+)"/.exec(search.text)[1]);
  const res = await c.submit(`${href}&place_q=paris`, '/request', { place: PARIS, format: 'in_person' });
  assert.equal(res.status, 429);
  assert.match(res.text, /just posted this same request/);
});

test('start a meeting, venue private until joined', async () => {
  const { a, b } = state;
  const res = await a.submit(`/r/${state.tokenA}/meet`, `/r/${state.tokenA}/meet`, {
    date: tomorrow(), time: '10:30', tz: 'America/Los_Angeles', format: 'in_person',
    venue: "Powell's Books café, Burnside St", note: 'I will have a red copy. http://spam.example', name: 'Ana',
  });
  assert.equal(res.status, 303, res.text.slice(0, 3000));
  state.orgToken = /^\/a\/([A-Za-z0-9_-]{43})\?new=1$/.exec(res.location)[1];

  const pageB = await b.get(`/r/${state.tokenB}`);
  const mid = /href="\/m\/([A-Za-z0-9_-]{12})"/.exec(pageB.text);
  assert.ok(mid, 'meeting shows on matched request page');
  state.meetingId = mid[1];

  const pub = await new Client(s.base).get(`/m/${state.meetingId}`);
  assert.equal(pub.status, 200);
  assert.match(pub.text, /Deschooling Society/);
  assert.match(pub.text, /Portland, United States/);
  assert.ok(!pub.text.includes('Powell'), 'venue hidden on public page');
  assert.ok(!pub.text.includes('red copy'), 'note hidden on public page');
  assert.ok(!pub.text.includes('Ana'), 'names hidden on public page');

  const listing = await new Client(s.base).get('/meetings');
  assert.match(listing.text, new RegExp(`/m/${state.meetingId}`));
  assert.ok(!listing.text.includes('Powell'));
});

test('join a meeting and see the details', async () => {
  const { b } = state;
  const res = await b.submit(`/m/${state.meetingId}`, `/m/${state.meetingId}/join`, { name: 'Ben' });
  assert.equal(res.status, 303);
  state.benToken = /^\/a\/([A-Za-z0-9_-]{43})/.exec(res.location)[1];
  const p = await b.get(`/a/${state.benToken}`);
  assert.equal(p.status, 200);
  assert.match(p.text, /Powell&#39;s Books café, Burnside St/);
  assert.match(p.text, /I will have a red copy\./);
  assert.ok(!p.text.includes('spam.example'), 'URLs stripped from note');
  assert.match(p.text, /Ana/);
  assert.match(p.text, /Bring the work and set it on the table/);
  assert.ok(!p.text.includes('Organizer tools'), 'no organizer tools for attendees');

  const ics = await b.get(`/a/${state.benToken}/ics`);
  assert.equal(ics.status, 200);
  assert.match(ics.headers.get('content-type'), /text\/calendar/);
  assert.match(ics.text, /BEGIN:VCALENDAR\r\n/);
  assert.match(ics.text, /DTSTART:\d{8}T\d{6}Z/);
  assert.match(ics.text, /LOCATION:Powell's Books café\\, Burnside St/);
});

test('an attendee can leave, and their link stops working', async () => {
  const { b } = state;
  const r = await b.submit(`/a/${state.benToken}`, `/a/${state.benToken}/leave`);
  assert.equal(r.status, 200);
  assert.match(r.text, /You have left the meeting/);
  assert.equal((await b.get(`/a/${state.benToken}`)).status, 404);
});

test('organizer edits, removes an attendee, closes, and cancels', async () => {
  const { a } = state;
  const d = new Client(s.base);
  const join = await d.submit(`/m/${state.meetingId}`, `/m/${state.meetingId}/join`, { name: 'Dee' });
  assert.equal(join.status, 303);
  const deeToken = /^\/a\/([A-Za-z0-9_-]{43})/.exec(join.location)[1];

  // Dee (attendee) tries organizer endpoints with a valid form token: refused.
  const deePage = await d.get(`/a/${deeToken}`);
  for (const action of ['cancel', 'close', 'remove', 'edit']) {
    const csrf = /name="_csrf" value="([^"]+)"/.exec(deePage.text)[1];
    const r = await d.request('POST', `/a/${deeToken}/${action}`, { _csrf: csrf, attendee: '1' });
    assert.equal(r.status, 404, action);
  }
  assert.notEqual(s.store.getMeeting(state.meetingId).status, 'cancelled');

  const org = await a.get(`/a/${state.orgToken}`);
  assert.match(org.text, /Organizer tools/);
  assert.match(org.text, /Dee/);

  const edit = await a.submit(`/a/${state.orgToken}`, `/a/${state.orgToken}/edit`, {
    date: tomorrow(), time: '11:00', tz: 'America/Los_Angeles', format: 'in_person', venue: 'Central Library, 801 SW 10th Ave', note: '',
  });
  assert.equal(edit.status, 303);
  assert.match((await d.get(`/a/${deeToken}`)).text, /Central Library/);

  const attendeeId = /name="attendee" value="(\d+)"/.exec(org.text)[1];
  const rm = await a.submit(`/a/${state.orgToken}`, `/a/${state.orgToken}/remove`, { attendee: attendeeId });
  assert.equal(rm.status, 303);
  assert.equal((await d.get(`/a/${deeToken}`)).status, 404);

  const close = await a.submit(`/a/${state.orgToken}`, `/a/${state.orgToken}/close`);
  assert.equal(close.status, 303);
  const pub = await new Client(s.base).get(`/m/${state.meetingId}`);
  assert.match(pub.text, /closed to new people/);
  assert.ok(!pub.text.includes(`/m/${state.meetingId}/join`));

  const cancel = await a.submit(`/a/${state.orgToken}`, `/a/${state.orgToken}/cancel`);
  assert.equal(cancel.status, 303);
  assert.match((await new Client(s.base).get(`/m/${state.meetingId}`)).text, /This meeting was cancelled/);
  assert.ok(!(await new Client(s.base).get('/meetings')).text.includes(state.meetingId));
});

test('forms without CSRF token, proof-of-work, or with honeypot are refused', async () => {
  const c = new Client(s.base);
  const search = await c.get('/request/new?q=pedagogy');
  const href = decodeEntities(/href="(\/request\/new\/details\?w=[^"]+)"/.exec(search.text)[1]);
  const details = `${href}&place_q=paris`;

  const noPow = await c.submit(details, '/request', { place: PARIS, format: 'video' }, { solvePow: false });
  assert.equal(noPow.status, 400);
  const honeypot = await c.submit(details, '/request', { place: PARIS, format: 'video', website: 'http://x' });
  assert.equal(honeypot.status, 400);
  const badCsrf = await c.submit(details, '/request', { place: PARIS, format: 'video', _csrf: 'x'.repeat(24) });
  assert.equal(badCsrf.status, 400);
  const badOrigin = await c.submit(details, '/request', { place: PARIS, format: 'video' }, {});
  assert.ok(badOrigin.status === 303 || badOrigin.status === 429);
  const p = await c.get(details);
  const hidden = Object.fromEntries([...p.text.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/g)].map((m) => [m[1], decodeEntities(m[2])]));
  const cross = await c.request('POST', '/request', { ...hidden, place: PARIS, format: 'video' }, { Origin: 'https://evil.example' });
  assert.equal(cross.status, 400);
  const nullOrigin = await c.request('POST', '/request', { ...hidden, place: PARIS, format: 'video' }, { Origin: 'null' });
  assert.equal(nullOrigin.status, 400, 'sandboxed frames send Origin: null');
});

test('hand-entered works are escaped, matched by normalized title, and links stay private', async () => {
  const c = new Client(s.base);
  const res = await c.submit('/request/new/details?manual=1&place_q=paris', '/request', {
    kind: 'film', title: '<script>alert(1)</script> The Battle of Algiers', creator: 'Gillo Pontecorvo',
    link: 'https://example.org/battle', place: 'online', format: 'video',
  });
  assert.equal(res.status, 303, res.text.slice(0, 1500));
  const board = await c.get('/board');
  assert.ok(!board.text.includes('<script>alert(1)'));
  assert.match(board.text, /&lt;script&gt;alert\(1\)&lt;\/script&gt; The Battle of Algiers/);
  assert.ok(!board.text.includes('example.org/battle'), 'manual link not public');

  const d = new Client(s.base);
  const res2 = await d.submit('/request/new/details?manual=1&place_q=paris', '/request', {
    kind: 'film', title: '<SCRIPT>alert(1)</SCRIPT> the battle of algiers!', creator: 'gillo pontecorvo', place: PARIS, format: 'video',
  });
  assert.equal(res2.status, 303);
  const page = await d.get(res2.location.replace('?new=1', ''));
  assert.match(page.text, /1 other person/);
});

test('bad meeting input is rejected', async () => {
  const c = new Client(s.base);
  const tok = await postRequest(c, { q: 'pedagogy', placeQ: 'portland', place: PORTLAND, format: 'either' });
  const path = `/r/${tok}/meet`;
  const cases = [
    [{ date: '2001-01-01', time: '10:00', tz: 'UTC', format: 'in_person', venue: 'Library', name: 'X' }, /already passed/],
    [{ date: tomorrow(), time: '10:00', tz: 'UTC', format: 'video', video_url: 'javascript:alert(1)', name: 'X' }, /https:\/\//],
    [{ date: tomorrow(), time: '10:00', tz: 'UTC', format: 'video', video_url: 'http://zoom.us/j/1', name: 'X' }, /https:\/\//],
    [{ date: tomorrow(), time: '10:00', tz: 'UTC', format: 'in_person', venue: '', name: 'X' }, /public place/],
    [{ date: tomorrow(), time: '10:00', tz: 'Not/AZone', format: 'in_person', venue: 'Library', name: 'X' }, /time zone/],
  ];
  for (const [fields, re] of cases) {
    const r = await c.submit(path, path, fields);
    assert.equal(r.status, 400, JSON.stringify(fields));
    assert.match(r.text, re);
  }
});

test('private links: unknown tokens 404, closing deletes the request and its email', async () => {
  const c = new Client(s.base);
  assert.equal((await c.get(`/r/${'A'.repeat(43)}`)).status, 404);
  assert.equal((await c.get('/r/short')).status, 404);
  assert.equal((await c.get(`/a/${'B'.repeat(43)}`)).status, 404);
  const p = await c.get(`/r/${state.tokenA}`);
  assert.match(p.text, /An email address is set/);
  assert.ok(!p.text.includes('reader-a@example.org'), 'email never displayed');
  assert.match(p.headers.get('cache-control'), /no-store/);
  const r = await c.submit(`/r/${state.tokenA}`, `/r/${state.tokenA}/close`);
  assert.equal(r.status, 200);
  assert.equal((await c.get(`/r/${state.tokenA}`)).status, 404);
  assert.equal(s.store.db.prepare("SELECT COUNT(*) n FROM requests WHERE email_enc IS NOT NULL").get().n, 0);
});

test('report a meeting, admin sees it and can remove the meeting', async () => {
  const c = new Client(s.base);
  const r = await c.submit(`/m/${state.meetingId}/report`, `/m/${state.meetingId}/report`, { reason: 'minor', text: 'see http://x.example' });
  assert.equal(r.status, 200);
  assert.match(r.text, /Thank you/);

  const admin = new Client(s.base);
  const login0 = await admin.submit('/admin', '/admin/login', { secret: 'wrong' });
  assert.equal(login0.status, 403);
  const login = await admin.submit('/admin', '/admin/login', { secret: ADMIN_SECRET });
  assert.equal(login.status, 303);
  const dash = await admin.get('/admin');
  assert.match(dash.text, /Someone may be under 18|minor/);
  assert.ok(!dash.text.includes('x.example'));
  assert.ok(!dash.text.includes('@example.org'), 'no emails on admin page');

  const rm = await admin.submit('/admin', '/admin/action', { action: 'remove_meeting', id: state.meetingId }, { page: dash });
  assert.equal(rm.status, 303);
  assert.ok(!s.store.getMeeting(state.meetingId));
  assert.equal((await c.get(`/m/${state.meetingId}`)).status, 404);
  assert.match((await admin.get('/admin')).text, /remove meeting/);
});

test('admin hold switch holds new hand-entered works until approved', async () => {
  const admin = new Client(s.base);
  await admin.submit('/admin', '/admin/login', { secret: ADMIN_SECRET });
  let dash = await admin.get('/admin');
  await admin.submit('/admin', '/admin/action', { action: 'hold_on' }, { page: dash });
  assert.equal(s.store.holdManual(), true);

  const c = new Client(s.base);
  const res = await c.submit('/request/new/details?manual=1', '/request', {
    kind: 'article', title: 'Totally Unique Spam Title', creator: 'Someone', place: 'online', format: 'video',
  });
  assert.equal(res.status, 303);
  const mine = await c.get(res.location);
  assert.match(mine.text, /being reviewed/);
  assert.ok(!(await c.get('/board')).text.includes('Totally Unique Spam Title'));

  // Books keep flowing.
  const b = new Client(s.base);
  const tok = await postRequest(b, { q: 'deschooling', placeQ: 'paris', place: PARIS, format: 'in_person' });
  assert.doesNotMatch((await b.get(`/r/${tok}`)).text, /being reviewed/);

  dash = await admin.get('/admin');
  const workId = /name="id" value="(\d+)"/.exec(dash.text.slice(dash.text.indexOf('Hand-entered works')))[1];
  await admin.submit('/admin', '/admin/action', { action: 'approve_work', id: workId }, { page: dash });
  assert.match((await c.get('/board')).text, /Totally Unique Spam Title/);
  await admin.submit('/admin', '/admin/action', { action: 'hold_off' }, { page: await admin.get('/admin') });
});

test('admin is unreachable without a session', async () => {
  const c = new Client(s.base);
  const p = await c.get('/admin');
  const csrf = /name="_csrf" value="([^"]+)"/.exec(p.text)[1];
  const r = await c.request('POST', '/admin/action', { _csrf: csrf, action: 'hold_on' });
  assert.equal(r.status, 404);
  const forged = new Client(s.base);
  forged.cookies.set('ru_admin', 'x'.repeat(43));
  assert.doesNotMatch((await forged.get('/admin')).text, /Audit log/);
});

test('static pages exist and security.txt is valid', async () => {
  const c = new Client(s.base);
  for (const p of ['/why', '/how-to-meet', '/privacy', '/terms']) assert.equal((await c.get(p)).status, 200, p);
  const st = await c.get('/.well-known/security.txt');
  assert.match(st.text, /^Contact: /m);
  assert.match(st.text, /^Expires: \d{4}-\d{2}-\d{2}T/m);
  assert.equal((await c.get('/static/../src/config.js')).status, 404);
  assert.equal((await c.get('/static/%2e%2e%2fpackage.json')).status, 404);
});
