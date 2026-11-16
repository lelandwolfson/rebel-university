import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compatible, matchesFor, meetingFitsRequest, unmatched, RADIUS_KM } from '../src/matching.js';
import { Places } from '../src/geo.js';

const places = Places.load();
const dist = (a, b) => places.distanceKm(a, b);

// GeoNames ids
const PORTLAND_OR = 5746545;
const BEAVERTON = 5713376; // ~11 km from Portland, OR
const PORTLAND_ME = 4975802;
const PARIS = 2988507;

let id = 0;
const req = (o) => ({ id: ++id, workId: 1, placeId: null, onlineOnly: false, format: 'either', ...o });

test('fixture cities exist', () => {
  for (const p of [PORTLAND_OR, BEAVERTON, PORTLAND_ME, PARIS]) assert.ok(places.get(p), `place ${p}`);
  assert.ok(dist(PORTLAND_OR, BEAVERTON) < RADIUS_KM);
  assert.ok(dist(PORTLAND_OR, PORTLAND_ME) > 4000);
});

test('the work is required to match', () => {
  const a = req({ placeId: PORTLAND_OR });
  const b = req({ placeId: PORTLAND_OR, workId: 2 });
  assert.equal(compatible(a, b, dist), false);
});

test('a request never matches itself', () => {
  const a = req({ placeId: PORTLAND_OR });
  assert.equal(compatible(a, a, dist), false);
});

test('in person matches nearby cities only', () => {
  const a = req({ placeId: PORTLAND_OR, format: 'in_person' });
  assert.equal(compatible(a, req({ placeId: BEAVERTON, format: 'in_person' }), dist), true);
  assert.equal(compatible(a, req({ placeId: PORTLAND_ME, format: 'in_person' }), dist), false);
});

test('video matches anywhere', () => {
  const a = req({ placeId: PORTLAND_OR, format: 'video' });
  assert.equal(compatible(a, req({ placeId: PARIS, format: 'video' }), dist), true);
  assert.equal(compatible(a, req({ onlineOnly: true, format: 'video' }), dist), true);
  assert.equal(compatible(a, req({ placeId: PARIS, format: 'either' }), dist), true);
});

test('in person and video only do not match', () => {
  const a = req({ placeId: PORTLAND_OR, format: 'in_person' });
  assert.equal(compatible(a, req({ placeId: PORTLAND_OR, format: 'video' }), dist), false);
});

test('either matches in person nearby and video anywhere', () => {
  const a = req({ placeId: PORTLAND_OR, format: 'either' });
  assert.equal(compatible(a, req({ placeId: BEAVERTON, format: 'in_person' }), dist), true);
  assert.equal(compatible(a, req({ placeId: PORTLAND_ME, format: 'in_person' }), dist), false);
  assert.equal(compatible(a, req({ placeId: PORTLAND_ME, format: 'either' }), dist), true);
});

test('online only never matches in person only', () => {
  const a = req({ onlineOnly: true, format: 'video' });
  assert.equal(compatible(a, req({ placeId: PORTLAND_OR, format: 'in_person' }), dist), false);
});

test('matching is symmetric', () => {
  const formats = ['in_person', 'video', 'either'];
  const spots = [PORTLAND_OR, BEAVERTON, PORTLAND_ME, null];
  const all = [];
  for (const f of formats) for (const p of spots) all.push(req({ format: p == null ? 'video' : f, placeId: p, onlineOnly: p == null }));
  for (const a of all) for (const b of all) assert.equal(compatible(a, b, dist), compatible(b, a, dist));
});

test('matchesFor returns compatible others', () => {
  const a = req({ placeId: PORTLAND_OR, format: 'in_person' });
  const list = [a, req({ placeId: BEAVERTON, format: 'in_person' }), req({ placeId: PARIS, format: 'in_person' }), req({ workId: 9, placeId: PORTLAND_OR })];
  assert.equal(matchesFor(a, list, dist).length, 1);
});

test('meetings fit requests by format and distance', () => {
  const r = req({ placeId: PORTLAND_OR, format: 'in_person' });
  assert.equal(meetingFitsRequest(r, { workId: 1, placeId: BEAVERTON, format: 'in_person' }, dist), true);
  assert.equal(meetingFitsRequest(r, { workId: 1, placeId: PARIS, format: 'in_person' }, dist), false);
  assert.equal(meetingFitsRequest(r, { workId: 1, placeId: PARIS, format: 'video' }, dist), false);
  assert.equal(meetingFitsRequest(r, { workId: 2, placeId: PORTLAND_OR, format: 'in_person' }, dist), false);
  const v = req({ onlineOnly: true, format: 'video' });
  assert.equal(meetingFitsRequest(v, { workId: 1, placeId: PARIS, format: 'both' }, dist), true);
  assert.equal(meetingFitsRequest(v, { workId: 1, placeId: PARIS, format: 'in_person' }, dist), false);
});

test('unmatched lists only requests with no partner', () => {
  const a = req({ placeId: PORTLAND_OR, format: 'in_person', workId: 5 });
  const b = req({ placeId: BEAVERTON, format: 'in_person', workId: 5 });
  const c = req({ placeId: PARIS, format: 'in_person', workId: 5 });
  const d = req({ placeId: PARIS, format: 'video', workId: 6 });
  const out = unmatched([a, b, c, d], dist).map((r) => r.id);
  assert.deepEqual(out.sort(), [c.id, d.id].sort());
});
