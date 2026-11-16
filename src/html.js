// HTML templating that escapes every interpolated value unless it is
// already a SafeHtml produced by this module.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };

export function esc(value) {
  return String(value).replace(/[&<>"'`]/g, (c) => ESC[c]);
}

export class SafeHtml {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}

// Only for strings that are known to be safe (constants in this codebase).
export function raw(s) { return new SafeHtml(String(s)); }

function render(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof SafeHtml) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  return esc(v);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return new SafeHtml(out);
}
