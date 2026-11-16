import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { ProofOfWork } from '../src/pow.js';

// Runs the real browser script (public/pow.js) against a stub DOM and checks
// that the server accepts what it produces.
test('browser proof-of-work script produces a solution the server accepts', async () => {
  const pow = new ProofOfWork(crypto.randomBytes(32));
  const ch = pow.create(30000);
  const input = { value: '', getAttribute: () => JSON.stringify(ch) };
  const status = { textContent: '' };
  let submitted = false;
  let onSubmit;
  const form = {
    querySelector: (sel) => (sel.startsWith('input') ? input : sel === '.pow-status' ? status : null),
    addEventListener: (_, fn) => { onSubmit = fn; },
    submit: () => { submitted = true; },
  };
  const document = { readyState: 'complete', querySelectorAll: () => [form], querySelector: () => null };
  vm.runInNewContext(fs.readFileSync(new URL('../public/pow.js', import.meta.url), 'utf8'), {
    document, window: {}, setTimeout, btoa, Uint32Array, Uint8Array, JSON, Math, String, parseInt,
  });
  // Submitting before it's solved waits, then submits by itself.
  let prevented = false;
  onSubmit({ preventDefault: () => { prevented = true; } });
  const start = Date.now();
  while (!input.value && Date.now() - start < 10000) await new Promise((r) => setTimeout(r, 5));
  assert.ok(input.value, 'solved');
  assert.ok(prevented);
  assert.ok(submitted, 'form submitted after solving');
  assert.equal(pow.verify(input.value).ok, true);
});
