// Time zone of a map location, and conversions between "local clock time there" and UTC instants.
import tzlookup from '@photostructure/tz-lookup';

export function tzAt(lat, lng) {
  try { return tzlookup(lat, lng); } catch { return 'UTC'; }
}

const fmtCache = new Map();
function partsFmt(tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    fmtCache.set(tz, f);
  }
  return f;
}

/** Wall-clock parts at `tz` for UTC instant `ms`. */
export function zoned(ms, tz) {
  const p = {};
  for (const { type, value } of partsFmt(tz).formatToParts(new Date(ms))) p[type] = +value;
  return { y: p.year, m: p.month, d: p.day, h: p.hour % 24, mi: p.minute, s: p.second };
}

/** Offset of `tz` from UTC at instant `ms`, minutes. */
export function offsetMin(ms, tz) {
  const p = zoned(ms, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

/** UTC instant for wall-clock time y-m-d h:mi at `tz`. */
export function fromZoned(y, m, d, h, mi, tz) {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let t = guess - offsetMin(guess, tz) * 60000;
  const o2 = offsetMin(t, tz);
  t = guess - o2 * 60000;
  return t;
}

export const pad = (n) => String(n).padStart(2, '0');
export const dateStr = (p) => `${p.y}-${pad(p.m)}-${pad(p.d)}`;
export function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return { y, m, d }; }

/** Start and end (UTC ms) of the local day `ds` (YYYY-MM-DD) at `tz`. 23 or 25 h around DST switches. */
export function dayBounds(ds, tz) {
  const { y, m, d } = parseDate(ds);
  const start = fromZoned(y, m, d, 0, 0, tz);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const end = fromZoned(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0, tz);
  return { start, end };
}

export function addDays(ds, n) {
  const { y, m, d } = parseDate(ds);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return dateStr({ y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() });
}

export function hm(ms, tz) {
  if (ms == null) return '—';
  const p = zoned(ms, tz);
  return `${pad(p.h)}:${pad(p.mi)}`;
}

export function utcLabel(ms, tz) {
  const o = offsetMin(ms, tz);
  const sign = o < 0 ? '−' : '+';
  const a = Math.abs(o);
  return `UTC${sign}${Math.floor(a / 60)}${a % 60 ? ':' + pad(a % 60) : ''}`;
}

export const deviceTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
