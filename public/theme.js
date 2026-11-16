// Rebel University: light/dark theme. Follows the system unless the reader
// picks one; the choice is kept in this browser only. License: AGPL-3.0-or-later
(function () {
  'use strict';
  var KEY = 'ru-theme';
  var root = document.documentElement;
  function stored() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function apply(v) { if (v === 'light' || v === 'dark') root.setAttribute('data-theme', v); else root.removeAttribute('data-theme'); }
  apply(stored());
  function label(btn) {
    var v = stored() || 'auto';
    btn.textContent = v === 'auto' ? 'Theme: auto' : v === 'dark' ? 'Theme: dark' : 'Theme: light';
  }
  function init() {
    var btn = document.querySelector('.theme-toggle');
    if (!btn) return;
    btn.hidden = false;
    label(btn);
    btn.addEventListener('click', function () {
      var order = ['auto', 'light', 'dark'];
      var next = order[(order.indexOf(stored() || 'auto') + 1) % order.length];
      try { if (next === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, next); } catch (e) { /* not saved */ }
      apply(next);
      label(btn);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
