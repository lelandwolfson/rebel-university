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
