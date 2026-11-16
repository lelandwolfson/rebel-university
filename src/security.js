import crypto from 'node:crypto';

// Private links: 256 bits of randomness. Only the SHA-256 hash is stored.
export function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function isTokenShape(t) {
  return typeof t === 'string' && /^[A-Za-z0-9_-]{43}$/.test(t);
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function randomId(bytes = 9) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest('base64url');
}

export function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) {
    crypto.timingSafeEqual(ab, ab); // keep timing roughly constant
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

// Sign a JSON value into "payload.signature" so it can travel through a form.
export function signValue(key, value) {
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${payload}.${hmac(key, payload)}`;
}

export function verifyValue(key, signed) {
  if (typeof signed !== 'string' || signed.length > 4000) return null;
  const i = signed.lastIndexOf('.');
  if (i < 1) return null;
  const payload = signed.slice(0, i);
  if (!safeEqual(hmac(key, payload), signed.slice(i + 1))) return null;
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return null; }
}

// AES-256-GCM for notification emails at rest.
export function encrypt(key, plaintext) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
  return `v1.${iv.toString('base64url')}.${ct.toString('base64url')}.${c.getAuthTag().toString('base64url')}`;
}

export function decrypt(key, boxed) {
  try {
    const [v, iv, ct, tag] = String(boxed).split('.');
    if (v !== 'v1') return null;
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}
