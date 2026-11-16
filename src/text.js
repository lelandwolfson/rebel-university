// Input cleaning. Every user-entered string goes through clean().

const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;
const URLISH = [
  /\b[a-z][a-z0-9+.-]*:\/\/\S*/gi, // scheme://...
  /\bwww\.\S*/gi,
  /[\p{L}\p{N}._+-]+@[\p{L}\p{N}-]+(\.[\p{L}\p{N}-]+)+/giu, // email addresses
  // bare domains, including internationalized ones: example.com/x, пример.рф
  /(?<![\p{L}\p{N}_-])[\p{L}\p{N}-]+(\.[\p{L}\p{N}-]+)*\.\p{L}{2,24}(?![\p{L}\p{N}_-])(\/\S*)?/giu,
  // obfuscated: evil[.]com, evil(dot)com, evil . com
  /[\p{L}\p{N}-]+\s*(\[\.\]|\(\.\)|\[dot\]|\(dot\)|\s\.\s)\s*\p{L}{2,24}\b/giu,
  /\b(?:mailto|javascript|data):\S*/gi,
];
// Characters browsers treat as a dot in host names.
const DOTS = /[\u3002\uff0e\uff61\u2024\ufe52]/g;

export function stripUrls(s) {
  let out = s;
  for (const re of URLISH) out = out.replace(re, '');
  return out;
}

export function clean(value, max, { keepUrls = false } = {}) {
  if (typeof value !== 'string') return '';
  let s = value.normalize('NFC').replace(CONTROL, ' ');
  if (!keepUrls) s = s.normalize('NFKC').replace(DOTS, '.');
  if (!keepUrls) s = stripUrls(s);
  s = s.replace(/\s+/g, ' ').trim();
  return [...s].slice(0, max).join('').trim();
}

// For matching manual works: case, accents, and punctuation don't matter.
export function normalizeForKey(s) {
  return String(s || '')
    .normalize('NFD').replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/^(the|a|an) /, '')
    .trim();
}

// An https link that is safe to show as a plain <a href>. Returns the
// normalized href, or null.
export function safeHttpsUrl(value, max = 300) {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (!s || s.length > max || /[\s<>"'`\\]/.test(s)) return null;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  if (!u.hostname.includes('.') || u.hostname.endsWith('.')) return null;
  if (u.port && u.port !== '443') return null;
  return u.href.length <= max ? u.href : null;
}

export function emailShape(value) {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (s.length > 254 || /[\s<>"'`,;\\()\[\]]/.test(s)) return null;
  return /^[^@]+@[^@]+\.[a-z]{2,}$/i.test(s) ? s : null;
}
