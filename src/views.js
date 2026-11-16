import { html, raw } from './html.js';
import { RADII_KM, radiusWorkFactor } from './matching.js';

// Shared layout and small components.

export function layout(ctx, { title, body, noindex = false }) {
  const { t } = ctx;
  const full = title ? `${title} · ${t('site.name')}` : t('site.name');
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${full}</title>
<meta name="description" content="${t('site.tagline')}">
${noindex ? raw('<meta name="robots" content="noindex, nofollow">') : ''}
<link rel="stylesheet" href="/static/style.css?v=1">
<link rel="icon" href="/static/icon.svg" type="image/svg+xml">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site">
  <a class="brand" href="/">${t('site.name')}</a>
  <nav aria-label="Main">
    <a href="/request/new">${t('nav.find')}</a>
    <a href="/board">${t('nav.board')}</a>
    <a href="/meetings">${t('nav.meetings')}</a>
    <a href="/how-to-meet">${t('nav.howto')}</a>
  </nav>
</header>
<main id="main">
${body}
</main>
<footer class="site">
  <p>${t('site.adults')}</p>
  <p><a href="/why">${t('footer.why')}</a> · <a href="/privacy">${t('footer.privacy')}</a> · <a href="/terms">${t('footer.terms')}</a> · <a href="${ctx.app.config.sourceUrl}">${t('footer.source')}</a></p>
</footer>
</body>
</html>`;
}

export function tips(ctx, { bring = false, compact = false } = {}) {
  const { t } = ctx;
  return html`<aside class="tips${compact ? ' compact' : ''}" aria-label="${t('meet.tips.title')}">
  <h2>${t('meet.tips.title')}</h2>
  <ul>${t('meet.tips').map((s) => html`<li>${s}</li>`)}</ul>
  ${bring ? html`<p><strong>${t('meet.bring')}</strong></p>` : ''}
  <p><a href="/how-to-meet">More on how to meet</a></p>
</aside>`;
}

export function errorBox(msg) {
  return msg ? html`<div class="error" role="alert"><p>${msg}</p></div>` : '';
}

export function noticeBox(msg) {
  return msg ? html`<div class="notice" role="status"><p>${msg}</p></div>` : '';
}

// Hidden fields every form carries.
// powBy: name of a form field (the travel distance) whose value scales the work.
// One challenge per distinct factor is embedded; the browser solves the one that applies.
export function guard(ctx, { pow = false, powBy = null } = {}) {
  const parts = [html`<input type="hidden" name="_csrf" value="${ctx.csrf}">`];
  if (pow) {
    const base = ctx.app.powDifficulty(ctx.ipKey);
    const challenge = ctx.app.pow.create(base, ctx.ipKey, 1);
    let byAttrs = '';
    if (powBy) {
      const byFactor = new Map([[1, challenge]]);
      const map = {};
      for (const km of RADII_KM) {
        const f = radiusWorkFactor(km);
        if (!byFactor.has(f)) byFactor.set(f, ctx.app.pow.create(base * f, ctx.ipKey, f));
        map[km] = byFactor.get(f);
      }
      byAttrs = html` data-challenge-by="${powBy}" data-challenges="${JSON.stringify(map)}"`;
    }
    parts.push(html`<div class="hp" aria-hidden="true"><label>Leave this empty <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
<input type="hidden" name="pow" value="" data-challenge="${JSON.stringify(challenge)}"${byAttrs}>
<noscript><p class="error">${ctx.t('pow.noscript')}</p></noscript>`);
  }
  return parts;
}

export function powScript() {
  return raw('<script src="/static/pow.js?v=1" defer></script>');
}

export function workLabel(ctx, w) {
  return html`<cite>${w.title}</cite>${w.creator ? html` <span class="by">by ${w.creator}</span>` : ''}${w.kind && w.kind !== 'book' ? html` <span class="kind">(${ctx.t(`kind.${w.kind}`)})</span>` : ''}`;
}

export function formatLabel(ctx, f) { return ctx.t(`format.${f}`); }

export function field(label, input, hint) {
  return html`<div class="field"><label>${label}${input}</label>${hint ? html`<p class="hint">${hint}</p>` : ''}</div>`;
}
