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

const workLine = (w) => `"${w.title}"${w.creator ? ` by ${w.creator}` : ''}`;

export function sendConfirmation(app, { email, token, work, matchCount }) {
  const { t } = app;
  const link = `${app.config.baseUrl}/r/${token}`;
  const matches = matchCount > 0
    ? `${matchCount} other ${matchCount === 1 ? 'person wants' : 'people want'} to discuss it and could meet you already.`
    : 'Nobody else has asked for it near you yet. We will email you once when someone does.';
  const text = `You posted a request on Rebel University to discuss ${workLine(work)}.\n\n${matches}\n\n` +
    `Your private link (keep it; it is the only way back, and we cannot resend it):\n${link}\n\n${tipsText(t)}${footer(app)}`;
  return app.mailer.send({ to: email, subject: 'Rebel University: your request', text });
}

async function notifyRequests(app, targets, work, reason) {
  const { t, store } = app;
  const minHour = store.hour() - 24;
  for (const r of targets) {
    if (!r.emailEnc || r.lastNotifiedHour > minHour) continue;
    const email = decrypt(app.config.keys.email, r.emailEnc);
    if (!email) continue;
    store.markNotified(r.id);
    const text = `${reason} ${workLine(work)}.\n\n` +
      'Open the private link we sent you when you posted your request to see who is waiting and to start or join a meeting.\n\n' +
      `${tipsText(t)}${footer(app)}`;
    await app.mailer.send({ to: email, subject: 'Rebel University: someone wants to discuss the same work', text });
  }
}

export async function notifyNewRequest(app, request, work) {
  if (!app.mailer.enabled || request.status !== 'open') return;
  const others = app.store.openRequestsForWork(request.workId).filter((o) => compatible(request, o, app.distanceKm));
  await notifyRequests(app, others, work, 'Someone else wants to discuss');
}

export async function notifyNewMeeting(app, meeting, work, exceptRequestId) {
  if (!app.mailer.enabled) return;
  const fits = app.store.openRequestsForWork(meeting.workId)
    .filter((r) => r.id !== exceptRequestId && meetingFitsRequest(r, meeting, app.distanceKm));
  await notifyRequests(app, fits, work, 'A meeting was started to discuss');
}

export function background(app, promise) {
  Promise.resolve(promise).catch((e) => app.log.error(`notify: ${e && e.message}`));
}
