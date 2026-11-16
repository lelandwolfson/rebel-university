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

// ---- chosen travel distance
import { RADII_KM, DEFAULT_RADIUS_KM, kmToMiles, radiusWorkFactor, withinBoth } from '../src/matching.js';

// A stub distance so edges can be tested exactly: places are numbers on a line, in km.
const line = (a, b) => Math.abs(a - b);
const at = (km, radiusKm, o = {}) => req({ placeId: 1000 + km, radiusKm, format: 'in_person', ...o });

test('distance options and labels', () => {
  assert.deepEqual(RADII_KM, [25, 50, 100, 200]);
  assert.equal(DEFAULT_RADIUS_KM, 50);
  assert.deepEqual(RADII_KM.map(kmToMiles), [16, 31, 62, 124]);
});

test('requests without a stored distance default to 50 km', () => {
  const a = req({ placeId: 1000, format: 'in_person' });
  assert.equal(compatible(a, at(50, 200), line), true);
  assert.equal(compatible(a, at(51, 200), line), false);
});

test('each distance: exactly at the limit matches, just past it does not', () => {
  for (const r of RADII_KM) {
    const a = at(0, r);
    assert.equal(compatible(a, at(r, r), line), true, `${r} km at ${r}`);
    assert.equal(compatible(a, at(r + 0.001, r), line), false, `${r} km just past`);
    assert.equal(compatible(a, at(r - 0.001, r), line), true, `${r} km just inside`);
  }
});

test('mismatched limits: both people must be willing to travel the distance', () => {
  // 80 km apart: one will go 200, the other only 50 -> no match.
  assert.equal(compatible(at(0, 200), at(80, 50), line), false);
  assert.equal(compatible(at(0, 50), at(80, 200), line), false);
  // Within the smaller limit -> match.
  assert.equal(compatible(at(0, 200), at(50, 50), line), true);
  assert.equal(compatible(at(0, 25), at(25, 200), line), true);
  assert.equal(compatible(at(0, 25), at(26, 200), line), false);
  // Every pair of limits, at the smaller limit and just past it.
  for (const r1 of RADII_KM) for (const r2 of RADII_KM) {
    const m = Math.min(r1, r2);
    assert.equal(compatible(at(0, r1), at(m, r2), line), true, `${r1}/${r2} at ${m}`);
    assert.equal(compatible(at(0, r1), at(m + 0.5, r2), line), false, `${r1}/${r2} past ${m}`);
    assert.equal(compatible(at(0, r1), at(m + 0.5, r2), line), compatible(at(m + 0.5, r2), at(0, r1), line), 'symmetric');
  }
});

test('distance does not affect video matching', () => {
  assert.equal(compatible(at(0, 25, { format: 'video' }), at(5000, 25, { format: 'video' }), line), true);
  assert.equal(compatible(at(0, 25, { format: 'either' }), at(5000, 25, { format: 'either' }), line), true);
  // "either" people far apart still match on video, whatever their distance.
  assert.equal(compatible(at(0, 200, { format: 'either' }), at(150, 25, { format: 'in_person' }), line), false);
});

test('meetings fit a request within the reader\'s own distance', () => {
  const r25 = at(0, 25);
  const r200 = at(0, 200);
  const meetingAt = (km, format = 'in_person') => ({ workId: 1, placeId: 1000 + km, format });
  assert.equal(meetingFitsRequest(r25, meetingAt(25), line), true);
  assert.equal(meetingFitsRequest(r25, meetingAt(26), line), false);
  assert.equal(meetingFitsRequest(r200, meetingAt(200), line), true);
  assert.equal(meetingFitsRequest(r200, meetingAt(201), line), false);
  assert.equal(meetingFitsRequest(r25, meetingAt(500, 'both'), line), false, 'in-person-only reader, far meeting');
});

test('real cities: Portland to Salem (~70 km) needs 100 km on both sides', () => {
  const SALEM = 5750162;
  assert.ok(places.get(SALEM), 'Salem, OR in dataset');
  const d = dist(PORTLAND_OR, SALEM);
  assert.ok(d > 50 && d < 100, `distance ${d}`);
  const p = (place, radiusKm) => req({ placeId: place, radiusKm, format: 'in_person' });
  assert.equal(compatible(p(PORTLAND_OR, 100), p(SALEM, 100), dist), true);
  assert.equal(compatible(p(PORTLAND_OR, 100), p(SALEM, 50), dist), false);
  assert.equal(compatible(p(PORTLAND_OR, 50), p(SALEM, 200), dist), false);
});

test('unmatched honors both distances', () => {
  const a = at(0, 200, { workId: 9 });
  const b = at(150, 50, { workId: 9 });
  assert.deepEqual(unmatched([a, b], line).map((r) => r.id).sort(), [a.id, b.id].sort());
  const c = at(-150, 200, { workId: 9 }); // 150 km from a, 300 km from b
  assert.deepEqual(unmatched([a, b, c], line).map((r) => r.id), [b.id]);
  assert.equal(withinBoth(a, c, line), true);
});

test('proof-of-work factor grows with the area a distance covers', () => {
  assert.deepEqual(RADII_KM.map(radiusWorkFactor), [1, 1, 4, 16]);
});
