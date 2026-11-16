// Matching rules. Pure functions so they are easy to test.
//
// The only basis for a match is the work. Place and format only decide
// whether a meeting is physically possible.

export const RADIUS_KM = 50;

export const acceptsVideo = (r) => r.format === 'video' || r.format === 'either';
export const acceptsInPerson = (r) => !r.onlineOnly && r.placeId != null && (r.format === 'in_person' || r.format === 'either');

// a, b: { id, workId, placeId, onlineOnly, format }
export function compatible(a, b, distanceKm, radius = RADIUS_KM) {
  if (a.workId !== b.workId || a.id === b.id) return false;
  if (acceptsVideo(a) && acceptsVideo(b)) return true;
  if (acceptsInPerson(a) && acceptsInPerson(b)) return distanceKm(a.placeId, b.placeId) <= radius;
  return false;
}

export function matchesFor(request, others, distanceKm, radius = RADIUS_KM) {
  return others.filter((o) => compatible(request, o, distanceKm, radius));
}

// meeting: { workId, placeId, format: in_person|video|both }
export function meetingFitsRequest(request, meeting, distanceKm, radius = RADIUS_KM) {
  if (request.workId !== meeting.workId) return false;
  const hasVideo = meeting.format === 'video' || meeting.format === 'both';
  const hasInPerson = meeting.format === 'in_person' || meeting.format === 'both';
  if (hasVideo && acceptsVideo(request)) return true;
  if (hasInPerson && acceptsInPerson(request) && meeting.placeId != null) {
    return distanceKm(request.placeId, meeting.placeId) <= radius;
  }
  return false;
}

// Requests in the list that have no compatible partner (for the open board).
export function unmatched(requests, distanceKm, radius = RADIUS_KM) {
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
      if (acceptsInPerson(r) && inPerson.some((o) => o.id !== r.id && distanceKm(r.placeId, o.placeId) <= radius)) continue;
      out.push(r);
    }
  }
  return out;
}
