// Input cleaning. Every user-entered string goes through clean().

const CONTROL = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g;
const URLISH = [
  /\b[a-z][a-z0-9+.-]*:\/\/\S*/gi, // scheme://...
  /\bwww\.\S*/gi,
  /\b[\w.+-]+@[\w-]+(\.[\w-]+)+\b/gi, // email addresses
  /\b[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,24}\b(\/\S*)?/gi, // bare domains like example.com/x
  /\b(?:mailto|javascript|data):\S*/gi,
];

export function stripUrls(s) {
  let out = s;
  for (const re of URLISH) out = out.replace(re, '');
  return out;
}

export function clean(value, max, { keepUrls = false } = {}) {
  if (typeof value !== 'string') return '';
  let s = value.normalize('NFC').replace(CONTROL, ' ');
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
