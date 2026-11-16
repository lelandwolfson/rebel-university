// Matching rules. Pure functions so they are easy to test.
//
// The only basis for a match is the work. Place, format, and travel distance
// only decide whether a meeting is physically possible.

// How far a person will travel to meet in person. Kilometres; miles shown alongside.
export const RADII_KM = [25, 50, 100, 200];
export const DEFAULT_RADIUS_KM = 50;
export const RADIUS_KM = DEFAULT_RADIUS_KM; // kept for older callers

export const isRadius = (r) => RADII_KM.includes(r);
export const radiusOf = (r) => (isRadius(r.radiusKm) ? r.radiusKm : DEFAULT_RADIUS_KM);
export const kmToMiles = (km) => Math.round(km * 0.621371);

// Proof-of-work multiplier: proportional to the area a probe could cover (THREAT-MODEL.md T1a).
export const radiusWorkFactor = (km) => Math.max(1, Math.round((km / DEFAULT_RADIUS_KM) ** 2));

export const acceptsVideo = (r) => r.format === 'video' || r.format === 'either';
export const acceptsInPerson = (r) => !r.onlineOnly && r.placeId != null && (r.format === 'in_person' || r.format === 'either');

// In person, two people can meet only if each is willing to travel that far.
export const withinBoth = (a, b, distanceKm) => distanceKm(a.placeId, b.placeId) <= Math.min(radiusOf(a), radiusOf(b));

// a, b: { id, workId, placeId, onlineOnly, format, radiusKm }
export function compatible(a, b, distanceKm) {
  if (a.workId !== b.workId || a.id === b.id) return false;
  if (acceptsVideo(a) && acceptsVideo(b)) return true;
  if (acceptsInPerson(a) && acceptsInPerson(b)) return withinBoth(a, b, distanceKm);
  return false;
}

export function matchesFor(request, others, distanceKm) {
  return others.filter((o) => compatible(request, o, distanceKm));
}

// meeting: { workId, placeId, format: in_person|video|both }
// The meeting is in its organizer's city; it fits if that is within the reader's own limit.
export function meetingFitsRequest(request, meeting, distanceKm) {
  if (request.workId !== meeting.workId) return false;
  const hasVideo = meeting.format === 'video' || meeting.format === 'both';
  const hasInPerson = meeting.format === 'in_person' || meeting.format === 'both';
  if (hasVideo && acceptsVideo(request)) return true;
  if (hasInPerson && acceptsInPerson(request) && meeting.placeId != null) {
    return distanceKm(request.placeId, meeting.placeId) <= radiusOf(request);
  }
  return false;
}

// Requests in the list that have no compatible partner (for the open board).
export function unmatched(requests, distanceKm) {
  const byWork = new Map();
  for (const r of requests) {
    if (!byWork.has(r.workId)) byWork.set(r.workId, []);
    byWork.get(r.workId).push(r);
  }
  const out = [];
  for (const group of byWork.values()) {
    // Same result as checking compatible() for every pair, with less work:
    // any two video-accepting requests match, so only in-person pairs need distances.
    const videoMatched = group.filter(acceptsVideo).length >= 2;
    const inPerson = group.filter(acceptsInPerson);
    for (const r of group) {
      if (videoMatched && acceptsVideo(r)) continue;
      if (acceptsInPerson(r) && inPerson.some((o) => o.id !== r.id && withinBoth(r, o, distanceKm))) continue;
      out.push(r);
    }
  }
  return out;
}

// ---- The open board
//
// Whether a request is on the board must not depend on anyone's chosen travel
// distance, or watching the board would reveal those distances (second review,
// finding 4). So the board uses one fixed rule: a request leaves the board once
// someone else for the same work could meet it on video, or is within
// BOARD_NEARBY_KM in person. A spatial grid keeps it fast even when one work
// has thousands of requests (second review, finding 3).

export const BOARD_NEARBY_KM = DEFAULT_RADIUS_KM;
const CELL_DEG = 0.5;

// locate(placeId) -> { lat, lon } or null
export function boardUnmatched(requests, distanceKm, locate) {
  const byWork = new Map();
  for (const r of requests) {
    if (!byWork.has(r.workId)) byWork.set(r.workId, []);
    byWork.get(r.workId).push(r);
  }
  const out = [];
  for (const group of byWork.values()) {
    const videoMatched = group.filter(acceptsVideo).length >= 2;
    const grid = new Map();
    const cellOf = (p) => [Math.floor(p.lat / CELL_DEG), Math.floor(p.lon / CELL_DEG)];
    for (const r of group) {
      if (!acceptsInPerson(r)) continue;
      const p = locate(r.placeId);
      if (!p) continue;
      const [i, j] = cellOf(p);
      const k = `${i},${j}`;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(r);
    }
    for (const r of group) {
      if (videoMatched && acceptsVideo(r)) continue;
      if (acceptsInPerson(r) && nearbyInGrid(r, grid, locate, cellOf, distanceKm)) continue;
      out.push(r);
    }
  }
  return out;
}

function nearbyInGrid(r, grid, locate, cellOf, distanceKm) {
  const p = locate(r.placeId);
  if (!p) return false;
  const [i, j] = cellOf(p);
  const latSpan = Math.ceil(BOARD_NEARBY_KM / 111 / CELL_DEG);
  const cos = Math.max(Math.cos((Math.abs(p.lat) + latSpan * CELL_DEG) * Math.PI / 180), 0.01);
  const lonSpan = Math.min(Math.ceil(BOARD_NEARBY_KM / (111.32 * cos) / CELL_DEG), 360 / CELL_DEG);
  for (let di = -latSpan; di <= latSpan; di++) {
    for (let dj = -lonSpan; dj <= lonSpan; dj++) {
      const cell = grid.get(`${i + di},${wrapLon(j + dj)}`);
      if (!cell) continue;
      for (const o of cell) if (o.id !== r.id && distanceKm(r.placeId, o.placeId) <= BOARD_NEARBY_KM) return true;
    }
  }
  return false;
}

// Longitude cells run from -360 to 359 (lon -180..180 at 0.5 degrees); wrap around the date line.
function wrapLon(j) {
  const n = 360 / CELL_DEG; // 720 cells
  const lo = -n / 2;
  return ((j - lo) % n + n) % n + lo;
}
