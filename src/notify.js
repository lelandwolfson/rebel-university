import { decrypt } from './security.js';
import { compatible, meetingFitsRequest } from './matching.js';

// Optional email notices. Functional only: "a match exists". At most one
// notice per request per 24 hours. Never includes anyone else's details.

function tipsText(t) {
  return `${t('meet.tips.title')}:\n${t('meet.tips').map((s) => `- ${s}`).join('\n')}\n- ${t('meet.bring')}`;
}

function footer(app) {
  return `\n\nYou get this because you added this address to a request on ${app.config.baseUrl}. ` +
    'To stop, open your private link and remove the email, or close the request. ' +
    'Your address is deleted when the request closes or expires (90 days at most).\n';
}

// Emails never contain the work's title or any other text someone typed:
// anyone can enter any address, so the site must not carry their words to it,
// and mail providers needn't learn what people read (second review, finding 7).
// Each address gets at most MAIL_PER_DAY messages, counted in memory only.
const MAIL_PER_DAY = 3;

function sendLimited(app, to, subject, text) {
  const key = app.limiter.scoped(String(to).toLowerCase(), 'mail');
  if (!app.limiter.hit('mail-to', key, MAIL_PER_DAY, 24 * 3600 * 1000)) return false;
  return app.mailer.send({ to, subject, text });
}

export function sendConfirmation(app, { email, token, matchCount }) {
  const { t } = app;
  const link = `${app.config.baseUrl}/r/${token}`;
  const matches = matchCount > 0
    ? `${matchCount} other ${matchCount === 1 ? 'person wants' : 'people want'} to discuss the same work and could meet you already.`
    : 'Nobody else has asked for it near you yet. We will email you when someone does.';
  const text = 'You posted a request on Rebel University to find people to discuss a work. Your private link shows which one.\n\n' +
    `${matches}\n\nYour private link (keep it; it is the only way back, and we cannot resend it):\n${link}\n\n` +
    `If you did not post this, ignore this email; the address is deleted when the request expires.\n\n${tipsText(t)}${footer(app)}`;
  return sendLimited(app, email, 'Rebel University: your request', text);
}

async function notifyRequests(app, targets, reason) {
  const { t, store } = app;
  const minHour = store.hour() - 24;
  for (const r of targets) {
    if (!r.emailEnc || r.lastNotifiedHour > minHour) continue;
    const email = decrypt(app.config.keys.email, r.emailEnc);
    if (!email) continue;
    store.markNotified(r.id);
    const text = `${reason}\n\n` +
      'Open the private link we sent you when you posted your request to see who is waiting and to start or join a meeting.\n\n' +
      `${tipsText(t)}${footer(app)}`;
    await sendLimited(app, email, 'Rebel University: someone wants to discuss the same work', text);
  }
}

export async function notifyNewRequest(app, request, work) {
  if (!app.mailer.enabled || request.status !== 'open') return;
  const others = app.store.openRequestsForWork(request.workId).filter((o) => compatible(request, o, app.distanceKm));
  await notifyRequests(app, others, 'Someone else wants to discuss the work in your request.');
}

export async function notifyNewMeeting(app, meeting, work, exceptRequestId) {
  if (!app.mailer.enabled) return;
  const fits = app.store.openRequestsForWork(meeting.workId)
    .filter((r) => r.id !== exceptRequestId && meetingFitsRequest(r, meeting, app.distanceKm));
  await notifyRequests(app, fits, 'A meeting was started to discuss the work in your request.');
}

export function background(app, promise) {
  Promise.resolve(promise).catch((e) => app.log.error(`notify: ${e && e.message}`));
}
