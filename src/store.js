import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// All SQL lives here. Every query is parameterized.

export const HOUR = 3600 * 1000;
export const toHour = (ms) => Math.floor(ms / HOUR);

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
  target TEXT NOT NULL DEFAULT ''
);
`;

const toRequest = (r) => r && ({
  id: r.id, workId: r.work_id, placeId: r.place_id, onlineOnly: !!r.online_only, format: r.format,
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
    this.q = new Map();
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
    if (existing) {
      if (!existing.link && link) this.sql('UPDATE works SET link = ? WHERE id = ?').run(link, existing.id);
      return toWork(this.sql('SELECT * FROM works WHERE id = ?').get(existing.id));
    }
    const r = this.sql('INSERT INTO works (kind, ol_key, title, creator, link, norm_key, held, created_hour) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(kind, olKey, title, creator, link, normKey, held ? 1 : 0, this.hour());
    return this.getWork(Number(r.lastInsertRowid));
  }

  heldWorks() {
    return this.sql('SELECT * FROM works WHERE held = 1 ORDER BY id DESC LIMIT 200').all().map(toWork);
  }

  approveWork(id) {
    return this.tx(() => {
      this.sql('UPDATE works SET held = 0 WHERE id = ?').run(id);
      this.sql("UPDATE requests SET status = 'open' WHERE work_id = ? AND status = 'held'").run(id);
    });
  }

  deleteWork(id) { return this.sql('DELETE FROM works WHERE id = ?').run(id).changes; }

  // ---- requests
  createRequest({ tokenHash, workId, placeId, onlineOnly, format, emailEnc, status }) {
    const h = this.hour();
    const r = this.sql(`INSERT INTO requests (token_hash, work_id, place_id, online_only, format, email_enc, status, created_hour, expires_hour)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(tokenHash, workId, placeId ?? null, onlineOnly ? 1 : 0, format, emailEnc ?? null, status, h, h + 90 * 24);
    return this.getRequest(Number(r.lastInsertRowid));
  }
  getRequest(id) { return toRequest(this.sql('SELECT * FROM requests WHERE id = ?').get(id)); }
  requestByToken(tokenHash) { return toRequest(this.sql('SELECT * FROM requests WHERE token_hash = ?').get(tokenHash)); }
  openRequestsForWork(workId) {
    return this.sql("SELECT * FROM requests WHERE work_id = ? AND status = 'open'").all(workId).map(toRequest);
  }
  openRequests() { return this.sql("SELECT * FROM requests WHERE status = 'open'").all().map(toRequest); }
  deleteRequest(id) { return this.sql('DELETE FROM requests WHERE id = ?').run(id).changes; }
  clearRequestEmail(id) { this.sql('UPDATE requests SET email_enc = NULL WHERE id = ?').run(id); }
  markNotified(id) { this.sql('UPDATE requests SET last_notified_hour = ? WHERE id = ?').run(this.hour(), id); }
  recentRequests(limit = 200) {
    return this.sql(`SELECT r.*, w.title, w.creator, w.kind FROM requests r JOIN works w ON w.id = r.work_id
      ORDER BY r.id DESC LIMIT ?`).all(limit).map((r) => ({ ...toRequest(r), title: r.title, creator: r.creator, kind: r.kind }));
  }
  workSummary() {
    return this.sql(`SELECT w.*, COUNT(r.id) AS n FROM works w JOIN requests r ON r.work_id = w.id
      WHERE r.status = 'open' AND w.held = 0 GROUP BY w.id`).all();
  }

  // ---- meetings
  createMeeting({ id, workId, placeId, format, startsUtc, tz, venue, videoUrl, note, organizerTokenHash, organizerName }) {
    const h = this.hour();
    return this.tx(() => {
      this.sql(`INSERT INTO meetings (id, work_id, place_id, format, starts_utc, tz, venue, video_url, note, status, created_hour, delete_after_hour)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`).run(id, workId, placeId ?? null, format, startsUtc, tz, venue, videoUrl, note, h, toHour(startsUtc) + 30 * 24);
      this.sql('INSERT INTO attendees (meeting_id, token_hash, display_name, is_organizer) VALUES (?, ?, ?, 1)').run(id, organizerTokenHash, organizerName);
      return this.getMeeting(id);
    });
  }
  getMeeting(id) { return toMeeting(this.sql('SELECT * FROM meetings WHERE id = ?').get(String(id))); }
  updateMeeting(id, { format, placeId, startsUtc, tz, venue, videoUrl, note }) {
    this.sql(`UPDATE meetings SET format = ?, place_id = ?, starts_utc = ?, tz = ?, venue = ?, video_url = ?, note = ?, delete_after_hour = ?
      WHERE id = ?`).run(format, placeId ?? null, startsUtc, tz, venue, videoUrl, note, toHour(startsUtc) + 30 * 24, id);
  }
  setMeetingStatus(id, status) { this.sql('UPDATE meetings SET status = ? WHERE id = ?').run(status, id); }
  deleteMeeting(id) { return this.sql('DELETE FROM meetings WHERE id = ?').run(id).changes; }
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
    return Number(this.sql('INSERT INTO attendees (meeting_id, token_hash, display_name, is_organizer) VALUES (?, ?, ?, 0)')
      .run(meetingId, tokenHash, displayName).lastInsertRowid);
  }
  attendeeByToken(tokenHash) {
    const a = this.sql('SELECT * FROM attendees WHERE token_hash = ?').get(tokenHash);
    return a && { id: a.id, meetingId: a.meeting_id, displayName: a.display_name, isOrganizer: !!a.is_organizer };
  }
  attendees(meetingId) {
    return this.sql('SELECT id, display_name, is_organizer FROM attendees WHERE meeting_id = ? ORDER BY is_organizer DESC, id').all(meetingId)
      .map((a) => ({ id: a.id, displayName: a.display_name, isOrganizer: !!a.is_organizer }));
  }
  attendeeCount(meetingId) { return this.sql('SELECT COUNT(*) AS n FROM attendees WHERE meeting_id = ?').get(meetingId).n; }
  removeAttendee(meetingId, attendeeId) {
    return this.sql('DELETE FROM attendees WHERE id = ? AND meeting_id = ? AND is_organizer = 0').run(attendeeId, meetingId).changes;
  }

  // ---- reports
  addReport(meetingId, reason, text) {
    this.sql('INSERT INTO reports (meeting_id, reason, text, created_hour) VALUES (?, ?, ?, ?)').run(meetingId, reason, text, this.hour());
  }
  reports() {
    return this.sql(`SELECT r.*, m.status, w.title FROM reports r JOIN meetings m ON m.id = r.meeting_id JOIN works w ON w.id = m.work_id
      ORDER BY r.id DESC LIMIT 200`).all();
  }
  deleteReport(id) { this.sql('DELETE FROM reports WHERE id = ?').run(id); }
  reportCountForMeeting(meetingId) { return this.sql('SELECT COUNT(*) AS n FROM reports WHERE meeting_id = ?').get(meetingId).n; }

  // ---- audit
  audit(action, target = '') {
    this.sql('INSERT INTO audit_log (at_hour, action, target) VALUES (?, ?, ?)').run(this.hour(), action, String(target).slice(0, 200));
  }
  auditLog(limit = 100) { return this.sql('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(limit); }

  // ---- bulk removal (admin)
  deleteRequestsSince(hours) {
    return this.sql('DELETE FROM requests WHERE created_hour >= ?').run(this.hour() - hours).changes;
  }
  deleteMeetingsSince(hours) {
    return this.sql('DELETE FROM meetings WHERE created_hour >= ?').run(this.hour() - hours).changes;
  }

  // ---- scheduled cleanup
  cleanup() {
    const h = this.hour();
    return this.tx(() => ({
      requests: this.sql('DELETE FROM requests WHERE expires_hour <= ?').run(h).changes,
      meetings: this.sql('DELETE FROM meetings WHERE delete_after_hour <= ?').run(h).changes,
      works: this.sql(`DELETE FROM works WHERE NOT EXISTS (SELECT 1 FROM requests r WHERE r.work_id = works.id)
        AND NOT EXISTS (SELECT 1 FROM meetings m WHERE m.work_id = works.id) AND created_hour < ?`).run(h - 1).changes,
      audit: this.sql('DELETE FROM audit_log WHERE at_hour < ?').run(h - 180 * 24).changes,
    }));
  }

  backup(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.sql('VACUUM INTO ?').run(file);
  }
}
