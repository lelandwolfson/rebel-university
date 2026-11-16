import { clean, normalizeForKey } from './text.js';

// Identifying a work. Books come from Open Library, keyed by the Open Library
// *work* id so every edition lands on the same record. Other works are entered
// by hand and matched on normalized title + creator.

export const MANUAL_KINDS = ['article', 'film', 'recording'];
export const KINDS = ['book', ...MANUAL_KINDS];

export function bookNormKey(olKey) { return `ol:${olKey}`; }

export function manualNormKey(kind, title, creator) {
  return `${kind}:${normalizeForKey(title)}|${normalizeForKey(creator)}`;
}

export function isOlWorkKey(k) { return typeof k === 'string' && /^OL\d{1,12}W$/.test(k); }

export class OpenLibrary {
  constructor(baseUrl, { fetchImpl = globalThis.fetch, userAgent = 'RebelUniversity/0.1 (+https://rebeluniversity.org)' } = {}) {
    this.baseUrl = baseUrl;
    this.fetch = fetchImpl;
    this.userAgent = userAgent;
    this.cache = new Map();
  }

  async search(query) {
    const q = clean(query, 120, { keepUrls: true });
    if (q.length < 2) return [];
    const key = q.toLowerCase();
    const hit = this.cache.get(key);
    if (hit && hit.until > Date.now()) return hit.results;

    const url = `${this.baseUrl}/search.json?q=${encodeURIComponent(q)}&fields=key,title,author_name,first_publish_year&limit=12`;
    const res = await this.fetch(url, { headers: { 'User-Agent': this.userAgent, Accept: 'application/json' }, signal: AbortSignal.timeout(6000), redirect: 'error' });
    if (!res.ok) throw new Error(`Open Library returned ${res.status}`);
    const chunks = [];
    let size = 0;
    for await (const chunk of res.body) {
      size += chunk.length;
      if (size > 2_000_000) throw new Error('Open Library response too large');
      chunks.push(chunk);
    }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const results = [];
    for (const d of Array.isArray(data.docs) ? data.docs : []) {
      const olKey = typeof d.key === 'string' ? d.key.replace(/^\/works\//, '') : '';
      if (!isOlWorkKey(olKey) || typeof d.title !== 'string') continue;
      results.push({
        olKey,
        title: clean(d.title, 300, { keepUrls: true }),
        creator: clean([...new Set(Array.isArray(d.author_name) ? d.author_name : [])].slice(0, 3).join(', '), 200, { keepUrls: true }),
        year: Number.isInteger(d.first_publish_year) ? d.first_publish_year : null,
      });
    }
    if (this.cache.size > 500) this.cache.clear();
    this.cache.set(key, { results, until: Date.now() + 15 * 60 * 1000 });
    return results;
  }
}
