import fs from 'node:fs';
import zlib from 'node:zlib';

// Bundled GeoNames cities (population >= 15,000). CC BY 4.0, geonames.org.

const fold = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export class Places {
  constructor(rows) {
    this.byId = new Map();
    this.list = [];
    for (const r of rows) {
      const p = { ...r, key: fold(r.name), akey: fold(r.ascii), rkey: fold(`${r.region} ${r.country} ${r.cc}`) };
      this.byId.set(p.id, p);
      this.list.push(p);
    }
    this.list.sort((a, b) => b.pop - a.pop);
  }

  static load(file = new URL('../data/places.tsv.gz', import.meta.url)) {
    const text = zlib.gunzipSync(fs.readFileSync(file)).toString('utf8');
    const lines = text.split('\n');
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i]) continue;
      const [id, name, ascii, region, country, cc, lat, lon, pop, tz] = lines[i].split('\t');
      rows.push({ id: Number(id), name, ascii, region, country, cc, lat: Number(lat), lon: Number(lon), pop: Number(pop), tz: tz || 'UTC' });
    }
    return new Places(rows);
  }

  get(id) { return this.byId.get(Number(id)) || null; }

  // "portland" or "portland, oregon" or "portland us"
  search(query, limit = 12) {
    const q = String(query || '').slice(0, 100);
    const [cityPart, ...rest] = q.split(',');
    const city = fold(cityPart);
    const where = fold(rest.join(' '));
    if (city.length < 2) return [];
    const exact = [];
    const prefix = [];
    for (const p of this.list) {
      if (where && !p.rkey.includes(where)) continue;
      if (p.key === city || p.akey === city) exact.push(p);
      else if (p.key.startsWith(city) || p.akey.startsWith(city)) prefix.push(p);
      if (exact.length >= limit) break;
    }
    return exact.concat(prefix).slice(0, limit);
  }

  label(id) {
    const p = this.get(id);
    if (!p) return null;
    return [p.name, p.region, p.country].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ');
  }

  regionLabel(id) {
    const p = this.get(id);
    if (!p) return null;
    return [p.region, p.country].filter(Boolean).join(', ');
  }

  cityLabel(id) {
    const p = this.get(id);
    return p ? `${p.name}, ${p.country}` : null;
  }

  distanceKm(a, b) {
    const p = this.get(a);
    const q = this.get(b);
    if (!p || !q) return Infinity;
    return haversineKm(p.lat, p.lon, q.lat, q.lon);
  }
}

export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}
