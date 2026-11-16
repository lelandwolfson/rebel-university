import crypto from 'node:crypto';
import path from 'node:path';

const DEV_SECRET = 'dev-only-insecure-secret-do-not-use-in-production-000';

// Reads configuration from the environment. Secrets never live in the repo.
export function loadConfig(env = process.env, overrides = {}) {
  const production = env.NODE_ENV === 'production';
  let appSecret = env.APP_SECRET || '';
  if (appSecret.length < 32) {
    if (production) throw new Error('APP_SECRET must be set to at least 32 characters');
    appSecret = DEV_SECRET;
  }
  const adminSecret = (env.ADMIN_SECRET || '').length >= 32 ? env.ADMIN_SECRET : null;
  // Read-only access to /admin/digest.json, and nothing else.
  const digestToken = (env.DIGEST_TOKEN || '').length >= 32 ? env.DIGEST_TOKEN : null;
  const baseUrl = (env.BASE_URL || (production ? 'https://rebeluniversity.org' : `http://localhost:${env.PORT || 3000}`)).replace(/\/+$/, '');
  const dataDir = env.DATA_DIR || path.resolve('var');

  const key = (info) => crypto.hkdfSync('sha256', appSecret, 'rebel-university', info, 32);
  const smtp = env.SMTP_HOST ? {
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT || 587),
    secure: env.SMTP_SECURE === 'true',
    user: env.SMTP_USER || undefined,
    pass: env.SMTP_PASS || undefined,
    from: env.SMTP_FROM || `Rebel University <no-reply@${new URL(baseUrl).hostname}>`,
  } : null;

  return {
    production,
    port: Number(env.PORT || 3000),
    host: env.HOST || (production ? '0.0.0.0' : '127.0.0.1'),
    baseUrl,
    secureCookies: baseUrl.startsWith('https://'),
    trustProxy: env.TRUST_PROXY === 'true',
    dataDir,
    dbPath: env.DB_PATH || path.join(dataDir, 'rebel.db'),
    backupDir: env.BACKUP_DIR || path.join(dataDir, 'backups'),
    backupKeep: Number(env.BACKUP_KEEP || 7),
    adminSecret,
    digestToken,
    // AI moderation runs only when this is set; the site works without it.
    anthropicApiKey: env.ANTHROPIC_API_KEY || null,
    aiModel: env.AI_MODEL || 'claude-haiku-5-5',
    keys: {
      email: Buffer.from(key('email-encryption-v1')),
      sign: Buffer.from(key('signing-v1')),
    },
    smtp,
    securityContact: env.SECURITY_CONTACT || 'https://github.com/lelandwolfson/rebel-university/security/advisories/new',
    sourceUrl: env.SOURCE_URL || 'https://github.com/lelandwolfson/rebel-university',
    openLibraryUrl: (env.OPEN_LIBRARY_URL || 'https://openlibrary.org').replace(/\/+$/, ''),
    jobs: env.DISABLE_JOBS !== 'true',
    powBase: Number(env.POW_BASE || 60000),
    formDebug: env.FORM_DEBUG === 'true',
    minFormMs: Number(env.MIN_FORM_MS ?? 3000),
    ...overrides,
  };
}
