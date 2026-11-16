import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

// Random row ids: sequential ids would reveal posting order and site-wide counts.
const rid = () => crypto.randomInt(1, 2 ** 47);

// All SQL lives here. Every query is parameterized.

export const HOUR = 3600 * 1000;
export const toHour = (ms) => Math.floor(ms / HOUR);
export const TRASH_HOURS = 7 * 24;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS works (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('book','article','film','recording')),
  ol_key TEXT,
  title TEXT NOT NULL,
  creator TEXT NOT NULL DEFAULT '',
  link TEXT,
  norm_key TEXT NOT NULL UNIQUE,
  held INTEGER NOT NULL DEFAULT 0,
  created_hour INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  place_id INTEGER,
  online_only INTEGER NOT NULL DEFAULT 0,
  format TEXT NOT NULL CHECK (format IN ('in_person','video','either')),
  radius_km INTEGER NOT NULL DEFAULT 50 CHECK (radius_km IN (25,50,100,200)),
  email_enc TEXT,
  status TEXT NOT NULL CHECK (status IN ('open','held')),
  last_notified_hour INTEGER NOT NULL DEFAULT 0,
  created_hour INTEGER NOT NULL,
  expires_hour INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS requests_work ON requests(work_id, status);
CREATE INDEX IF NOT EXISTS requests_expiry ON requests(expires_hour);
CREATE TABLE IF NOT EXISTS meetings (
  id TEXT PRIMARY KEY,
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  place_id INTEGER,
  format TEXT NOT NULL CHECK (format IN ('in_person','video','both')),
  starts_utc INTEGER NOT NULL,
  tz TEXT NOT NULL,
  venue TEXT NOT NULL DEFAULT '',
  video_url TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('open','closed','cancelled')),
  created_hour INTEGER NOT NULL,
  delete_after_hour INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS meetings_work ON meetings(work_id, starts_utc);
CREATE INDEX IF NOT EXISTS meetings_starts ON meetings(starts_utc);
CREATE TABLE IF NOT EXISTS attendees (
  id INTEGER PRIMARY KEY,
  meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  is_organizer INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS attendees_meeting ON attendees(meeting_id);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY,
  meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  created_hour INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  at_hour INTEGER NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL DEFAULT 'admin',
  reason TEXT NOT NULL DEFAULT ''
);
-- One row per AI moderation run: what it saw, did, and flagged (plain JSON).
CREATE TABLE IF NOT EXISTS moderation_runs (
  id INTEGER PRIMARY KEY,
  at_ms INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok','flagged','skipped','error')),
  summary TEXT NOT NULL,
  acked INTEGER NOT NULL DEFAULT 0
);
-- Removed items, kept TRASH_HOURS so the admin can restore them, then purged.
CREATE TABLE IF NOT EXISTS trash (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('request','meeting','work')),
  ref TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL,
  removed_hour INTEGER NOT NULL,
  actor TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT ''
);
`;

const toRequest = (r) => r && ({
  id: r.id, workId: r.work_id, placeId: r.place_id, onlineOnly: !!r.online_only, format: r.format, radiusKm: r.radius_km,
  emailEnc: r.email_enc, status: r.status, lastNotifiedHour: r.last_notified_hour,
  createdHour: r.created_hour, expiresHour: r.expires_hour,
});
const toMeeting = (m) => m && ({
  id: m.id, workId: m.work_id, placeId: m.place_id, format: m.format, startsUtc: m.starts_utc, tz: m.tz,
  venue: m.venue, videoUrl: m.video_url, note: m.note, status: m.status, createdHour: m.created_hour,
  deleteAfterHour: m.delete_after_hour,
});
const toWork = (w) => w && ({
  id: w.id, kind: w.kind, olKey: w.ol_key, title: w.title, creator: w.creator, link: w.link, held: !!w.held,
  createdHour: w.created_hour,
});

export class Store {
  constructor(file, { now = () => Date.now() } = {}) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.now = now;
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA secure_delete = ON;');
    this.db.exec(SCHEMA);
    this.migrate();
    this.q = new Map();
    this.version = 0; // bumps whenever open requests change (board cache)
  }

  // Additive migrations for databases created by older versions.
  migrate() {
    const cols = this.db.prepare('PRAGMA table_info(requests)').all().map((c) => c.name);
    if (!cols.includes('radius_km')) {
      this.db.exec('ALTER TABLE requests ADD COLUMN radius_km INTEGER NOT NULL DEFAULT 50 CHECK (radius_km IN (25,50,100,200))');
    }
    const auditCols = this.db.prepare('PRAGMA table_info(audit_log)').all().map((c) => c.name);
    if (!auditCols.includes('actor')) this.db.exec("ALTER TABLE audit_log ADD COLUMN actor TEXT NOT NULL DEFAULT 'admin'");
    if (!auditCols.includes('reason')) this.db.exec("ALTER TABLE audit_log ADD COLUMN reason TEXT NOT NULL DEFAULT ''");
    // Marks an item as already seen by AI moderation, so it isn't sent again.
    for (const table of ['reports', 'works']) {
      const c = this.db.prepare(`PRAGMA table_info(${table})`).all().map((x) => x.name);
      if (!c.includes('ai_reviewed_hour')) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ai_reviewed_hour INTEGER`);
    }
  }

  sql(s) {
    let st = this.q.get(s);
    if (!st) { st = this.db.prepare(s); this.q.set(s, st); }
    return st;
  }

  tx(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); this.db.exec('COMMIT'); return r; } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }

  hour() { return toHour(this.now()); }

  // secure_delete overwrites deleted rows in the main file, but old copies stay in
  // the write-ahead log until it is reused. Checkpoint and truncate it after
  // deletions so "deleted" means gone from disk too (second review, finding 11).
  scrub() {
    try { this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* busy: the hourly job retries */ }
  }

  close() { this.db.close(); }

  // ---- settings
  getSetting(key, fallback = null) {
    const r = this.sql('SELECT value FROM settings WHERE key = ?').get(key);
    return r ? r.value : fallback;
  }
  setSetting(key, value) {
    this.sql('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
  }
  holdManual() { return this.getSetting('hold_manual', '0') === '1'; }

  // ---- works
  getWork(id) { return toWork(this.sql('SELECT * FROM works WHERE id = ?').get(id)); }

  findOrCreateWork({ kind, olKey = null, title, creator = '', link = null, normKey, held = false }) {
    const existing = this.sql('SELECT * FROM works WHERE norm_key = ?').get(normKey);
    // An existing work is never changed by a later request (its link could be swapped for a phishing link).
    if (existing) return toWork(existing);
    const id = rid();
    this.sql('INSERT INTO works (id, kind, ol_key, title, creator, link, norm_key, held, created_hour) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, kind, olKey, title, creator, link, normKey, held ? 1 : 0, this.hour());
    return this.getWork(id);
  }

  heldWorks() {
    return this.sql('SELECT * FROM works WHERE held = 1 ORDER BY created_hour DESC LIMIT 200').all().map(toWork);
  }

  approveWork(id) {
    this.version++;
    return this.tx(() => {
      this.sql('UPDATE works SET held = 0 WHERE id = ?').run(id);
      this.sql("UPDATE requests SET status = 'open' WHERE work_id = ? AND status = 'held'").run(id);
    });
  }

  deleteWork(id) { this.version++; const n = this.sql('DELETE FROM works WHERE id = ?').run(id).changes; this.scrub(); return n; }

  // ---- requests
  createRequest({ tokenHash, workId, placeId, onlineOnly, format, radiusKm = 50, emailEnc, status }) {
    const h = this.hour();
    const id = rid();
    this.version++;
    this.sql(`INSERT INTO requests (id, token_hash, work_id, place_id, online_only, format, radius_km, email_enc, status, created_hour, expires_hour)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, tokenHash, workId, placeId ?? null, onlineOnly ? 1 : 0, format, radiusKm, emailEnc ?? null, status, h, h + 90 * 24);
    this.scrub(); // don't leave insertion order in the write-ahead log
    return this.getRequest(id);
  }
  getRequest(id) { return toRequest(this.sql('SELECT * FROM requests WHERE id = ?').get(id)); }
  requestByToken(tokenHash) { return toRequest(this.sql('SELECT * FROM requests WHERE token_hash = ?').get(tokenHash)); }
  openRequestsForWork(workId) {
    return this.sql("SELECT * FROM requests WHERE work_id = ? AND status = 'open'").all(workId).map(toRequest);
  }
  requestCountForWork(workId) {
    return this.sql('SELECT COUNT(*) AS n FROM requests WHERE work_id = ?').get(workId).n;
  }
  openRequestCountForWork(workId) {
    return this.sql("SELECT COUNT(*) AS n FROM requests WHERE work_id = ? AND status IN ('open','held')").get(workId).n;
  }
  openRequests() { return this.sql("SELECT * FROM requests WHERE status = 'open'").all().map(toRequest); }
  deleteRequest(id) { this.version++; const n = this.sql('DELETE FROM requests WHERE id = ?').run(id).changes; this.scrub(); return n; }
  setRequestRadius(id, radiusKm) {
    this.version++;
    this.sql('UPDATE requests SET radius_km = ? WHERE id = ?').run(radiusKm, id);
  }
  clearRequestEmail(id) { this.sql('UPDATE requests SET email_enc = NULL WHERE id = ?').run(id); this.scrub(); }
  markNotified(id) { this.sql('UPDATE requests SET last_notified_hour = ? WHERE id = ?').run(this.hour(), id); }
  recentRequests(limit = 200) {
    return this.sql(`SELECT r.*, w.title, w.creator, w.kind FROM requests r JOIN works w ON w.id = r.work_id
      ORDER BY r.created_hour DESC LIMIT ?`).all(limit).map((r) => ({ ...toRequest(r), title: r.title, creator: r.creator, kind: r.kind }));
  }
  workSummary() {
    return this.sql(`SELECT w.*, COUNT(r.id) AS n FROM works w JOIN requests r ON r.work_id = w.id
      WHERE r.status = 'open' AND w.held = 0 GROUP BY w.id`).all();
  }

  // ---- meetings
  createMeeting({ id, workId, placeId, format, startsUtc, tz, venue, videoUrl, note, organizerTokenHash, organizerName }) {
    const h = this.hour();
    const m = this.tx(() => {
      this.sql(`INSERT INTO meetings (id, work_id, place_id, format, starts_utc, tz, venue, video_url, note, status, created_hour, delete_after_hour)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`).run(id, workId, placeId ?? null, format, startsUtc, tz, venue, videoUrl, note, h, toHour(startsUtc) + 30 * 24);
      this.sql('INSERT INTO attendees (id, meeting_id, token_hash, display_name, is_organizer) VALUES (?, ?, ?, ?, 1)').run(rid(), id, organizerTokenHash, organizerName);
      return this.getMeeting(id);
    });
    this.scrub();
    return m;
  }
  getMeeting(id) { return toMeeting(this.sql('SELECT * FROM meetings WHERE id = ?').get(String(id))); }
  updateMeeting(id, { format, placeId, startsUtc, tz, venue, videoUrl, note }) {
    this.sql(`UPDATE meetings SET format = ?, place_id = ?, starts_utc = ?, tz = ?, venue = ?, video_url = ?, note = ?, delete_after_hour = ?
      WHERE id = ?`).run(format, placeId ?? null, startsUtc, tz, venue, videoUrl, note, toHour(startsUtc) + 30 * 24, id);

    this.scrub(); // the old venue, link, and note leave the write-ahead log too
  }
  setMeetingStatus(id, status) { this.sql('UPDATE meetings SET status = ? WHERE id = ?').run(status, id); }
  deleteMeeting(id) { const n = this.sql('DELETE FROM meetings WHERE id = ?').run(id).changes; this.scrub(); return n; }
  upcomingMeetings({ sinceMs, workId = null, limit = 100, offset = 0 }) {
    const rows = workId == null
      ? this.sql(`SELECT m.*, w.title, w.creator, w.kind FROM meetings m JOIN works w ON w.id = m.work_id
          WHERE m.starts_utc >= ? AND m.status != 'cancelled' AND w.held = 0 ORDER BY m.starts_utc LIMIT ? OFFSET ?`).all(sinceMs, limit, offset)
      : this.sql(`SELECT m.*, w.title, w.creator, w.kind FROM meetings m JOIN works w ON w.id = m.work_id
          WHERE m.starts_utc >= ? AND m.status != 'cancelled' AND w.held = 0 AND m.work_id = ? ORDER BY m.starts_utc LIMIT ? OFFSET ?`).all(sinceMs, workId, limit, offset);
    return rows.map((m) => ({ ...toMeeting(m), title: m.title, creator: m.creator, kind: m.kind }));
  }
  recentMeetings(limit = 200) {
    return this.sql(`SELECT m.*, w.title FROM meetings m JOIN works w ON w.id = m.work_id ORDER BY m.created_hour DESC, m.starts_utc DESC LIMIT ?`)
      .all(limit).map((m) => ({ ...toMeeting(m), title: m.title }));
  }

  // ---- attendees
  addAttendee(meetingId, tokenHash, displayName) {
    const id = rid();
    this.sql('INSERT INTO attendees (id, meeting_id, token_hash, display_name, is_organizer) VALUES (?, ?, ?, ?, 0)').run(id, meetingId, tokenHash, displayName);
    this.scrub();
    return id;
  }
  attendeeByToken(tokenHash) {
    const a = this.sql('SELECT * FROM attendees WHERE token_hash = ?').get(tokenHash);
    return a && { id: a.id, meetingId: a.meeting_id, displayName: a.display_name, isOrganizer: !!a.is_organizer };
  }
  attendees(meetingId) {
    return this.sql('SELECT id, display_name, is_organizer FROM attendees WHERE meeting_id = ? ORDER BY is_organizer DESC, display_name').all(meetingId)
      .map((a) => ({ id: a.id, displayName: a.display_name, isOrganizer: !!a.is_organizer }));
  }
  attendeeCount(meetingId) { return this.sql('SELECT COUNT(*) AS n FROM attendees WHERE meeting_id = ?').get(meetingId).n; }
  removeAttendee(meetingId, attendeeId) {
    const n = this.sql('DELETE FROM attendees WHERE id = ? AND meeting_id = ? AND is_organizer = 0').run(attendeeId, meetingId).changes;
    this.scrub();
    return n;
  }

  // ---- reports
  addReport(meetingId, reason, text) {
    this.sql('INSERT INTO reports (id, meeting_id, reason, text, created_hour) VALUES (?, ?, ?, ?, ?)').run(rid(), meetingId, reason, text, this.hour());
    this.scrub();
  }
  reports() {
    return this.sql(`SELECT r.*, m.status, w.title FROM reports r JOIN meetings m ON m.id = r.meeting_id JOIN works w ON w.id = m.work_id
      ORDER BY r.created_hour DESC LIMIT 200`).all();
  }
  deleteReport(id) { this.sql('DELETE FROM reports WHERE id = ?').run(id); this.scrub(); }
  reportCountForMeeting(meetingId) { return this.sql('SELECT COUNT(*) AS n FROM reports WHERE meeting_id = ?').get(meetingId).n; }

  // ---- audit
  audit(action, target = '', { actor = 'admin', reason = '' } = {}) {
    this.sql('INSERT INTO audit_log (at_hour, action, target, actor, reason) VALUES (?, ?, ?, ?, ?)')
      .run(this.hour(), action, String(target).slice(0, 200), actor, String(reason).slice(0, 300));
  }
  auditLog(limit = 100) { return this.sql('SELECT * FROM audit_log ORDER BY at_hour DESC, id DESC LIMIT ?').all(limit); }

  // ---- soft delete: trash
  //
  // A removed request, meeting, or work moves here with its dependent rows, as
  // JSON, for TRASH_HOURS. Live tables never hold removed rows, so no other
  // query needs to know about removal.

  rowsOf(table, where, ...args) { return this.db.prepare(`SELECT * FROM ${table} WHERE ${where}`).all(...args); }

  insertRow(table, row) {
    const cols = this.db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name).filter((c) => c in row);
    this.db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map((c) => row[c]));
  }

  toTrash(kind, ref, label, payload, actor, reason) {
    return Number(this.sql('INSERT INTO trash (kind, ref, label, payload, removed_hour, actor, reason) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(kind, String(ref), String(label).slice(0, 300), JSON.stringify(payload), this.hour(), actor, String(reason).slice(0, 300)).lastInsertRowid);
  }

  // Each returns the trash id if something was removed, or null.
  trashRequest(id, { actor, reason }) {
    const done = this.tx(() => {
      const row = this.sql('SELECT * FROM requests WHERE id = ?').get(id);
      if (!row) return null;
      const w = this.sql('SELECT * FROM works WHERE id = ?').get(row.work_id);
      const t = this.toTrash('request', id, w ? w.title : '', { works: w ? [w] : [], requests: [row] }, actor, reason);
      this.sql('DELETE FROM requests WHERE id = ?').run(id);
      return t;
    });
    if (done) { this.version++; this.scrub(); }
    return done;
  }

  trashMeeting(id, { actor, reason }) {
    const done = this.tx(() => {
      const row = this.sql('SELECT * FROM meetings WHERE id = ?').get(String(id));
      if (!row) return null;
      const w = this.sql('SELECT * FROM works WHERE id = ?').get(row.work_id);
      const t = this.toTrash('meeting', id, w ? w.title : '', {
        works: w ? [w] : [],
        meetings: [row], attendees: this.rowsOf('attendees', 'meeting_id = ?', row.id), reports: this.rowsOf('reports', 'meeting_id = ?', row.id),
      }, actor, reason);
      this.sql('DELETE FROM meetings WHERE id = ?').run(row.id);
      return t;
    });
    if (done) this.scrub();
    return done;
  }

  trashWork(id, { actor, reason }) {
    const done = this.tx(() => {
      const row = this.sql('SELECT * FROM works WHERE id = ?').get(id);
      if (!row) return null;
      const meetings = this.rowsOf('meetings', 'work_id = ?', id);
      const mids = meetings.map((m) => m.id);
      const t = this.toTrash('work', id, row.title, {
        works: [row],
        requests: this.rowsOf('requests', 'work_id = ?', id),
        meetings,
        attendees: mids.flatMap((m) => this.rowsOf('attendees', 'meeting_id = ?', m)),
        reports: mids.flatMap((m) => this.rowsOf('reports', 'meeting_id = ?', m)),
      }, actor, reason);
      this.sql('DELETE FROM works WHERE id = ?').run(id);
      return t;
    });
    if (done) { this.version++; this.scrub(); }
    return done;
  }

  trashList(limit = 200) {
    return this.sql('SELECT id, kind, ref, label, removed_hour, actor, reason FROM trash ORDER BY removed_hour DESC, id DESC LIMIT ?').all(limit);
  }

  // Put everything back. The work row travels with every trashed item: if the
  // work is gone (cleanup removes works nothing refers to), it is re-created; if
  // a work with the same title now exists, the restored items join it.
  // Returns null on success or a short error message.
  restoreTrash(trashId) {
    const t = this.sql('SELECT * FROM trash WHERE id = ?').get(trashId);
    if (!t) return 'gone';
    const h = this.hour();
    if (t.removed_hour <= h - TRASH_HOURS) return 'expired';
    const p = JSON.parse(t.payload);
    // Nothing past its own deletion date comes back (third review).
    if ((p.requests || []).some((r) => r.expires_hour <= h) || (p.meetings || []).some((m) => m.delete_after_hour <= h)) return 'expired';
    try {
      const err = this.tx(() => {
        const workIds = new Map();
        for (const w of p.works || []) {
          if (this.sql('SELECT id FROM works WHERE id = ?').get(w.id)) { workIds.set(w.id, w.id); continue; }
          // The work itself was removed: restore that first, never re-create it here.
          if (t.kind !== 'work' && this.sql("SELECT 1 FROM trash WHERE kind = 'work' AND ref = ?").get(String(w.id))) return 'work_removed';
          const twin = this.sql('SELECT * FROM works WHERE norm_key = ?').get(w.norm_key);
          if (twin) {
            // Join an existing work only if it is the same work: same link, same review state.
            if ((twin.link || null) !== (w.link || null) || twin.held !== w.held) return 'conflict';
            workIds.set(w.id, twin.id);
          } else {
            this.insertRow('works', w);
            workIds.set(w.id, w.id);
          }
        }
        const fix = (row) => (workIds.has(row.work_id) ? { ...row, work_id: workIds.get(row.work_id) } : row);
        for (const row of p.requests || []) if (!this.sql('SELECT 1 FROM requests WHERE id = ?').get(row.id)) this.insertRow('requests', fix(row));
        for (const row of p.meetings || []) if (!this.sql('SELECT 1 FROM meetings WHERE id = ?').get(row.id)) this.insertRow('meetings', fix(row));
        for (const row of p.attendees || []) if (!this.sql('SELECT 1 FROM attendees WHERE id = ?').get(row.id)) this.insertRow('attendees', row);
        for (const row of p.reports || []) if (!this.sql('SELECT 1 FROM reports WHERE id = ?').get(row.id)) this.insertRow('reports', row);
        this.sql('DELETE FROM trash WHERE id = ?').run(trashId);
        return null;
      });
      if (err) return err;
    } catch (e) {
      return /UNIQUE/.test(e.message) ? 'conflict' : 'failed';
    }
    this.version++;
    this.scrub();
    return null;
  }

  // When the item a review record describes is gone for good (not in the
  // trash either), clear its title, ids, and reason from the record.
  redactRuns() {
    const exists = (table, id) => !!this.db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id);
    const inTrash = (kind, id) => !!this.sql('SELECT 1 FROM trash WHERE kind = ? AND ref = ?').get(kind, String(id));
    const live = (x) => (x.meetingId ? exists('meetings', x.meetingId) || inTrash('meeting', x.meetingId) : true)
      && (x.workId ? exists('works', x.workId) || inTrash('work', x.workId) : true);
    let changed = 0;
    for (const r of this.sql('SELECT id, summary FROM moderation_runs').all()) {
      const s = JSON.parse(r.summary);
      let dirty = false;
      for (const list of [s.actions || [], s.flagged || []]) {
        for (const x of list) {
          if ((x.meetingId || x.workId) && !live(x)) {
            Object.assign(x, { title: null, adminTitle: '(deleted)', meetingId: null, workId: null, reason: '(deleted)' });
            dirty = true;
          }
        }
      }
      if (dirty) { this.sql('UPDATE moderation_runs SET summary = ? WHERE id = ?').run(JSON.stringify(s), r.id); changed++; }
    }
    return changed;
  }

  // ---- AI moderation queue (only the fields the model needs)
  heldWorksForReview(limit) {
    if (limit <= 0) return [];
    return this.sql(`SELECT id, kind, title, creator, link FROM works WHERE held = 1 AND ai_reviewed_hour IS NULL
      ORDER BY created_hour LIMIT ?`).all(limit);
  }
  // Unreviewed reports grouped by meeting: one item per meeting, up to perItem report texts.
  reportGroupsForReview(limit, perItem) {
    if (limit <= 0) return [];
    const metas = this.sql(`SELECT r.meeting_id, m.format, w.title, w.creator, w.kind, MIN(r.created_hour) AS first
      FROM reports r JOIN meetings m ON m.id = r.meeting_id JOIN works w ON w.id = m.work_id
      WHERE r.ai_reviewed_hour IS NULL GROUP BY r.meeting_id
      ORDER BY MAX(r.reason IN ('unsafe','participant')) DESC, first LIMIT ?`).all(limit); // safety reports first
    return metas.map((g) => {
      const rows = this.sql('SELECT id, reason, text FROM reports WHERE meeting_id = ? AND ai_reviewed_hour IS NULL ORDER BY created_hour DESC, id').all(g.meeting_id);
      return { meetingId: g.meeting_id, format: g.format, title: g.title, creator: g.creator, kind: g.kind,
        reportIds: rows.map((r) => r.id), reports: rows.slice(0, perItem).map((r) => ({ reason: r.reason, text: r.text })) };
    });
  }
  markReviewed(table, ids) {
    if (!['reports', 'works'].includes(table)) throw new Error('bad table');
    const st = this.db.prepare(`UPDATE ${table} SET ai_reviewed_hour = ? WHERE id = ?`);
    for (const id of ids) st.run(this.hour(), id);
  }

  // ---- AI moderation runs
  addRun(status, summary) {
    // Run times are rounded to the hour, like every other timestamp.
    const r = this.sql('INSERT INTO moderation_runs (at_ms, status, summary) VALUES (?, ?, ?)').run(this.hour() * HOUR, status, JSON.stringify(summary));
    // Keep at most 60 runs, and none older than 60 days.
    this.sql('DELETE FROM moderation_runs WHERE id NOT IN (SELECT id FROM moderation_runs ORDER BY at_ms DESC LIMIT 60) OR at_ms < ?').run(this.now() - 60 * 86400000);
    return Number(r.lastInsertRowid);
  }
  runs(limit = 10) {
    return this.sql('SELECT * FROM moderation_runs ORDER BY at_ms DESC, id DESC LIMIT ?').all(limit)
      .map((r) => ({ id: r.id, atMs: r.at_ms, status: r.status, acked: !!r.acked, summary: JSON.parse(r.summary) }));
  }
  unackedRuns() {
    return this.sql('SELECT * FROM moderation_runs WHERE acked = 0 ORDER BY at_ms DESC, id DESC').all()
      .map((r) => ({ id: r.id, atMs: r.at_ms, status: r.status, acked: false, summary: JSON.parse(r.summary) }));
  }
  lastRunAt(statuses = ['ok', 'flagged', 'error']) {
    const r = this.db.prepare(`SELECT MAX(at_ms) AS t FROM moderation_runs WHERE status IN (${statuses.map(() => '?').join(',')})`).get(...statuses);
    return r && r.t ? r.t : 0;
  }
  ackRun(id) { this.sql('UPDATE moderation_runs SET acked = 1 WHERE id = ?').run(id); }
  // Items flagged for the owner in runs the owner hasn't marked handled.
  waitingForOwner() {
    let n = 0;
    for (const r of this.sql('SELECT status, summary FROM moderation_runs WHERE acked = 0').all()) {
      const s = JSON.parse(r.summary);
      n += (s.flagged || []).length + (r.status === 'error' ? 1 : 0);
    }
    return n;
  }

  // ---- bulk removal (admin)
  deleteRequestsSince(hours) {
    this.version++;
    const n = this.sql('DELETE FROM requests WHERE created_hour >= ?').run(this.hour() - hours).changes;
    this.scrub();
    return n;
  }
  deleteMeetingsSince(hours) {
    const n = this.sql('DELETE FROM meetings WHERE created_hour >= ?').run(this.hour() - hours).changes;
    this.scrub();
    return n;
  }

  // ---- scheduled cleanup
  cleanup() {
    const h = this.hour();
    this.version++;
    const r = this.tx(() => ({
      requests: this.sql('DELETE FROM requests WHERE expires_hour <= ?').run(h).changes,
      meetings: this.sql('DELETE FROM meetings WHERE delete_after_hour <= ?').run(h).changes,
      works: this.sql(`DELETE FROM works WHERE NOT EXISTS (SELECT 1 FROM requests r WHERE r.work_id = works.id)
        AND NOT EXISTS (SELECT 1 FROM meetings m WHERE m.work_id = works.id) AND created_hour < ?`).run(h - 1).changes,
      audit: this.sql('DELETE FROM audit_log WHERE at_hour < ?').run(h - 180 * 24).changes,
      trash: this.sql('DELETE FROM trash WHERE removed_hour <= ?').run(h - TRASH_HOURS).changes,
      runs: this.sql('DELETE FROM moderation_runs WHERE at_ms < ?').run(this.now() - 60 * 86400000).changes,
    }));
    r.redacted = this.redactRuns();
    this.scrub();
    return r;
  }

  backup(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.sql('VACUUM INTO ?').run(file);
  }
}
