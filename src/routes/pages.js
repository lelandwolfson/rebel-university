import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { page } from '../app.js';
import { HttpError } from '../http.js';
import { tips } from '../views.js';
import * as en from '../i18n/en-pages.js';

const PUBLIC_DIR = new URL('../../public/', import.meta.url);
const TYPES = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const FONTS_DIR = new URL('../../public/fonts/', import.meta.url);

export default function register(app) {
  const { router, config } = app;

  // Static files: a fixed allowlist read once at startup.
  const statics = new Map();
  for (const name of fs.readdirSync(PUBLIC_DIR)) {
    const type = TYPES[path.extname(name)];
    if (type) statics.set(name, { type, body: fs.readFileSync(new URL(name, PUBLIC_DIR)) });
  }
  // Content-hash versions for static URLs, so browsers never run a stale script
  // or stylesheet after a deploy.
  app.asset = (name) => {
    const f = statics.get(name);
    if (!f) return `/static/${name}`;
    f.version ||= crypto.createHash('sha256').update(f.body).digest('hex').slice(0, 10);
    return `/static/${name}?v=${f.version}`;
  };
  router.get('/static/:name', (ctx) => {
    const f = statics.get(ctx.params.name);
    if (!f) throw new HttpError(404);
    // Immutable only for the exact current version; anything else revalidates.
    const current = ctx.query.get('v') === app.asset(ctx.params.name).split('?v=')[1];
    ctx.res.writeHead(200, { 'Content-Type': f.type, 'Content-Length': f.body.length, 'Cache-Control': current ? 'public, max-age=31536000, immutable' : 'no-cache' });
    ctx.res.end(ctx.req.method === 'HEAD' ? undefined : f.body);
  });

  // Self-hosted fonts (Source Serif 4, SIL Open Font License; see public/fonts/OFL.txt).
  const fonts = new Map();
  for (const name of fs.readdirSync(FONTS_DIR)) {
    if (name.endsWith('.woff2')) fonts.set(name, fs.readFileSync(new URL(name, FONTS_DIR)));
  }
  router.get('/static/fonts/:name', (ctx) => {
    const body = fonts.get(ctx.params.name);
    if (!body) throw new HttpError(404);
    ctx.res.writeHead(200, { 'Content-Type': 'font/woff2', 'Content-Length': body.length, 'Cache-Control': 'public, max-age=2592000' });
    ctx.res.end(ctx.req.method === 'HEAD' ? undefined : body);
  });

  router.get('/', (ctx) => page(ctx, { title: null, body: en.home(ctx, tips(ctx, { bring: true })) }));
  router.get('/why', (ctx) => page(ctx, { title: ctx.t('footer.why'), body: en.why(ctx) }));
  router.get('/how-to-meet', (ctx) => page(ctx, { title: ctx.t('nav.howto'), body: en.howToMeet(ctx) }));
  router.get('/privacy', (ctx) => page(ctx, { title: ctx.t('footer.privacy'), body: en.privacy(ctx) }));
  router.get('/terms', (ctx) => page(ctx, { title: ctx.t('footer.terms'), body: en.terms(ctx) }));

  const text = (ctx, body, type = 'text/plain; charset=utf-8') => {
    ctx.res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=3600' });
    ctx.res.end(body);
  };

  router.get('/robots.txt', (ctx) => text(ctx, 'User-agent: *\nDisallow: /m/\nDisallow: /r/\nDisallow: /a/\nDisallow: /board\nDisallow: /meetings\nDisallow: /request/\nDisallow: /admin\n'));

  router.get('/.well-known/security.txt', (ctx) => {
    const expires = new Date(app.now() + 365 * 24 * 3600 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const contact = config.securityContact.includes('@') && !config.securityContact.startsWith('mailto:')
      ? `mailto:${config.securityContact}` : config.securityContact;
    text(ctx, `Contact: ${contact}\nExpires: ${expires}\nPolicy: ${config.sourceUrl}/blob/main/SECURITY.md\nPreferred-Languages: en\nCanonical: ${config.baseUrl}/.well-known/security.txt\n`);
  });

  router.get('/healthz', (ctx) => text(ctx, 'ok\n'));
}
