// Rebel University: anti-spam proof-of-work (ALTCHA-style) and time zone guess.
// Runs only in your browser. Sends nothing anywhere except with the form.
// License: AGPL-3.0-or-later
(function () {
  'use strict';

  var K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);
  var W = new Uint32Array(64);
  var H = new Uint32Array(8);
  var buf = new Uint8Array(256);

  // SHA-256 of buf[0..len) into H.
  function sha256(len) {
    var nb = ((len + 9 + 63) >> 6) << 6;
    buf[len] = 0x80;
    for (var z = len + 1; z < nb; z++) buf[z] = 0;
    var bits = len * 8;
    buf[nb - 4] = bits >>> 24; buf[nb - 3] = (bits >>> 16) & 255; buf[nb - 2] = (bits >>> 8) & 255; buf[nb - 1] = bits & 255;
    var h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a,
      h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
    for (var i = 0; i < nb; i += 64) {
      var t;
      for (t = 0; t < 16; t++) {
        var j = i + t * 4;
        W[t] = (buf[j] << 24) | (buf[j + 1] << 16) | (buf[j + 2] << 8) | buf[j + 3];
      }
      for (t = 16; t < 64; t++) {
        var w15 = W[t - 15], w2 = W[t - 2];
        var s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3);
        var s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10);
        W[t] = (W[t - 16] + s0 + W[t - 7] + s1) | 0;
      }
      var a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
      for (t = 0; t < 64; t++) {
        var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + K[t] + W[t]) | 0;
        var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        var mj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + mj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
      h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
    }
    H[0] = h0; H[1] = h1; H[2] = h2; H[3] = h3; H[4] = h4; H[5] = h5; H[6] = h6; H[7] = h7;
  }

  function solve(ch, done) {
    var target = new Uint32Array(8);
    for (var i = 0; i < 8; i++) target[i] = parseInt(ch.challenge.substr(i * 8, 8), 16);
    var saltLen = ch.salt.length;
    if (saltLen > 180) return done(null);
    for (var s = 0; s < saltLen; s++) buf[s] = ch.salt.charCodeAt(s) & 255;
    var n = 0;
    function chunk() {
      var end = Math.min(n + 20000, ch.maxnumber + 1);
      for (; n < end; n++) {
        var str = String(n), len = saltLen;
        for (var k = 0; k < str.length; k++) buf[len++] = str.charCodeAt(k);
        sha256(len);
        if (H[0] === target[0] && H[1] === target[1] && H[2] === target[2] && H[3] === target[3] &&
            H[4] === target[4] && H[5] === target[5] && H[6] === target[6] && H[7] === target[7]) {
          return done(n);
        }
      }
      if (n > ch.maxnumber) return done(null);
      setTimeout(chunk, 0);
    }
    chunk();
  }

  function setup(form) {
    var input = form.querySelector('input[name="pow"][data-challenge]');
    if (!input) return;
    var status = form.querySelector('.pow-status');
    var ch;
    try { ch = JSON.parse(input.getAttribute('data-challenge')); } catch (e) { return; }
    var solved = false, waiting = false;
    solve(ch, function (number) {
      if (number === null) { if (status) status.textContent = 'The anti-spam check failed. Please reload the page.'; return; }
      input.value = btoa(JSON.stringify({ algorithm: ch.algorithm, challenge: ch.challenge, number: number, salt: ch.salt, signature: ch.signature }));
      solved = true;
      if (waiting) { if (status) status.textContent = 'Sending…'; form.submit(); }
    });
    form.addEventListener('submit', function (ev) {
      if (solved) return;
      ev.preventDefault();
      waiting = true;
      if (status) status.textContent = 'Running a short anti-spam check…';
    });
  }

  function init() {
    var forms = document.querySelectorAll('form[data-pow]');
    for (var i = 0; i < forms.length; i++) setup(forms[i]);
    // Preselect the browser's time zone where the page has no better default.
    var sel = document.querySelector('select[name="tz"][data-guess]');
    if (sel && window.Intl) {
      try {
        var tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        for (var j = 0; j < sel.options.length; j++) if (sel.options[j].value === tz) { sel.selectedIndex = j; break; }
      } catch (e) { /* keep default */ }
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
