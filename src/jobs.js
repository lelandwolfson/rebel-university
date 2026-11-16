import fs from 'node:fs';
import path from 'node:path';
import { maybeRunModeration } from './moderation.js';

// Built-in scheduled jobs. No cron, no operator.
//   hourly: delete expired requests, meetings 30 days past, orphan works; sweep memory
//   daily:  VACUUM INTO a dated backup, keep the newest N

export function runCleanup(app) {
  const r = app.store.cleanup();
  app.pow.sweep();
  app.limiter.sweep();
  for (const [k, exp] of app.adminSessions) if (exp < app.now()) app.adminSessions.delete(k);
  for (const [k, v] of app.joinedFrom || []) if (v.until < app.now()) app.joinedFrom.delete(k);
  return r;
}

// ISO time of the newest backup file, or null.
export function lastBackupAt(app) {
  try {
    const dir = app.config.backupDir;
    const files = fs.readdirSync(dir).filter((f) => /^rebel-\d{4}-\d{2}-\d{2}\.db$/.test(f));
    let newest = 0;
    for (const f of files) newest = Math.max(newest, fs.statSync(path.join(dir, f)).mtimeMs);
    return newest ? new Date(newest).toISOString() : null;
  } catch { return null; }
}

export function runBackup(app) {
  const { backupDir, backupKeep } = app.config;
  const day = new Date(app.now()).toISOString().slice(0, 10);
  const file = path.join(backupDir, `rebel-${day}.db`);
  if (fs.existsSync(file)) return null;
  app.store.backup(file);
  fs.chmodSync(file, 0o600);
  const old = fs.readdirSync(backupDir).filter((f) => /^rebel-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().reverse().slice(backupKeep);
  for (const f of old) fs.unlinkSync(path.join(backupDir, f));
  return file;
}

// One scheduled tick. Logs a single line every time, with counts and statuses
// only: no titles, places, names, or other content, so the logs can confirm the
// jobs ran without holding anything about people.
export function runTick(app) {
  let cleanup = 'failed';
  let backup = 'failed';
  try {
    const r = runCleanup(app);
    cleanup = `ok requests=${r.requests} meetings=${r.meetings} works=${r.works} trash=${r.trash ?? 0} runs=${r.runs ?? 0} audit=${r.audit}`;
  } catch (e) {
    app.log.error(`jobs: cleanup error (${e && e.name})`);
  }
  try {
    backup = runBackup(app) ? 'written' : 'already-today';
  } catch (e) {
    app.log.error(`jobs: backup error (${e && e.name})`);
  }
  app.log.info(`jobs: cleanup ${cleanup}; backup ${backup}`);
  return maybeRunModeration(app)
    .then((r) => { if (r) app.log.info(`moderation: ${r.status}${r.counts ? ` reviewed=${r.counts.reviewed} approved=${r.counts.approved} removed=${r.counts.removed} flagged=${r.counts.flagged}` : ''}`); })
    .catch((e) => app.log.error(`moderation: error (${e && e.name})`));
}

export function startJobs(app) {
  const tick = () => { runTick(app); };
  setTimeout(tick, 10 * 1000).unref();
  const timer = setInterval(tick, 60 * 60 * 1000);
  timer.unref();
  return () => clearInterval(timer);
}
