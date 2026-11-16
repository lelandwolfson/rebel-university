import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../src/store.js';
import { runBackup, runCleanup } from '../src/jobs.js';
import { ProofOfWork } from '../src/pow.js';
import { RateLimiter } from '../src/ratelimit.js';

test('daily backup writes one file per day and keeps the newest N', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ru-backup-'));
  let now = Date.UTC(2026, 0, 1, 12);
  const store = new Store(path.join(dir, 'live.db'), { now: () => now });
  store.findOrCreateWork({ kind: 'book', olKey: 'OL1W', title: 'T', normKey: 'ol:OL1W' });
  const app = { store, now: () => now, config: { backupDir: path.join(dir, 'backups'), backupKeep: 3 } };
  for (let d = 0; d < 5; d++) {
    assert.ok(runBackup(app));
    assert.equal(runBackup(app), null, 'once per day');
    now += 86400000;
  }
  const files = fs.readdirSync(app.config.backupDir).sort();
  assert.deepEqual(files, ['rebel-2026-01-03.db', 'rebel-2026-01-04.db', 'rebel-2026-01-05.db']);
  const copy = new DatabaseSync(path.join(app.config.backupDir, files[2]));
  assert.equal(copy.prepare('SELECT COUNT(*) n FROM works').get().n, 1);
  copy.close();
  assert.equal(fs.statSync(path.join(app.config.backupDir, files[2])).mode & 0o777, 0o600);
  store.close();
  fs.rmSync(dir, { recursive: true });
});

test('hourly cleanup sweeps memory-only state too', () => {
  let now = 0;
  const store = new Store(':memory:', { now: () => now });
  const app = { store, now: () => now, pow: new ProofOfWork(Buffer.alloc(32), { now: () => now }), limiter: new RateLimiter({ now: () => now }), adminSessions: new Map([['x', 5]]) };
  app.limiter.hit('b', 'k', 1, 10);
  now = 100;
  runCleanup(app);
  assert.equal(app.limiter.windows.size, 0);
  assert.equal(app.adminSessions.size, 0);
  store.close();
});

test('each tick logs one line with counts and statuses only', async () => {
  const { runTick } = await import('../src/jobs.js');
  const { ProofOfWork } = await import('../src/pow.js');
  const { RateLimiter } = await import('../src/ratelimit.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ru-tick-'));
  let now = Date.UTC(2026, 0, 1, 12);
  const store = new Store(path.join(dir, 'live.db'), { now: () => now });
  const w = store.findOrCreateWork({ kind: 'film', title: 'Secret Title Kraków', creator: 'Private Person', normKey: 'film:secret' });
  store.createRequest({ tokenHash: 'x', workId: w.id, placeId: 5746545, onlineOnly: false, format: 'either', status: 'open' });
  now += 91 * 86400000; // request expired
  const lines = [];
  const log = { info: (m) => lines.push(m), error: (m) => lines.push(m) };
  const app = { store, now: () => now, log, config: { backupDir: path.join(dir, 'b'), backupKeep: 3 },
    pow: new ProofOfWork(Buffer.alloc(32), { now: () => now }), limiter: new RateLimiter({ now: () => now }), adminSessions: new Map(), joinedFrom: new Map() };
  await runTick(app);
  await runTick(app);
  assert.equal(lines.length, 2, 'one line per tick (moderation is off)');
  assert.match(lines[0], /^jobs: cleanup ok requests=1 meetings=0 works=1 trash=0 runs=0 audit=0; backup written$/);
  assert.match(lines[1], /^jobs: cleanup ok requests=0 meetings=0 works=0 trash=0 runs=0 audit=0; backup already-today$/);
  for (const l of lines) assert.doesNotMatch(l, /Secret|Kraków|Private|Portland|5746545/);
  store.close();
  fs.rmSync(dir, { recursive: true });
});
