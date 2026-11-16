// Time zones with nothing but Intl.

let zones;
export function timeZones() {
  if (!zones) {
    const list = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
    zones = new Set(['UTC', ...list]);
  }
  return zones;
}

export function isTimeZone(tz) {
  return typeof tz === 'string' && timeZones().has(tz);
}

function partsIn(ms, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = {};
  for (const { type, value } of dtf.formatToParts(new Date(ms))) p[type] = value;
  return p;
}

function offsetMs(ms, tz) {
  const p = partsIn(ms, tz);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

// "2026-03-14", "10:30", "Europe/Paris" -> UTC milliseconds, or null.
export function zonedToUtc(date, time, tz) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
  const t = /^(\d{2}):(\d{2})$/.exec(String(time || ''));
  if (!d || !t || !isTimeZone(tz)) return null;
  const [y, mo, da, h, mi] = [+d[1], +d[2], +d[3], +t[1], +t[2]];
  if (mo < 1 || mo > 12 || da < 1 || da > 31 || h > 23 || mi > 59) return null;
  const guess = Date.UTC(y, mo - 1, da, h, mi);
  if (new Date(guess).getUTCDate() !== da) return null; // e.g. Feb 30
  let ms = guess - offsetMs(guess, tz);
  const second = offsetMs(ms, tz);
  if (guess - second !== ms) ms = guess - second;
  return ms;
}

// UTC ms -> { date: "YYYY-MM-DD", time: "HH:MM" } in tz (for edit forms).
export function utcToZoned(ms, tz) {
  const p = partsIn(ms, tz);
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${String(+p.hour % 24).padStart(2, '0')}:${p.minute}` };
}

export function formatInZone(ms, tz, locale = 'en-GB') {
  const s = new Intl.DateTimeFormat(locale, {
    timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(ms));
  return `${s} (${tz.replace(/_/g, ' ')})`;
}

export function formatDateInZone(ms, tz, locale = 'en-GB') {
  return new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(ms));
}
