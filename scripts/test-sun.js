// Sanity checks of the sun math against published sunrise/sunset times (timeanddate.com / NOAA, ±2 min).
import { dayInfo, sunPos, moonIllum } from '../src/astro.js';
import { tzAt, dayBounds, hm } from '../src/tz.js';

const cases = [
  { name: 'Moscow', lat: 55.7558, lng: 37.6173, date: '2026-06-21', rise: '03:44', set: '21:18' },
  { name: 'London', lat: 51.5072, lng: -0.1276, date: '2026-12-21', rise: '08:04', set: '15:53' },
  { name: 'Sydney', lat: -33.8688, lng: 151.2093, date: '2026-01-15', rise: '05:59', set: '20:09' },
  { name: 'New York (DST day)', lat: 40.7128, lng: -74.006, date: '2026-03-08', rise: '07:19', set: '18:56' },
];
const toMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
let fail = 0;
for (const c of cases) {
  const tz = tzAt(c.lat, c.lng);
  const { start, end } = dayBounds(c.date, tz);
  const d = dayInfo(start, end, c.lat, c.lng);
  const r = hm(d.rise, tz), s = hm(d.set, tz);
  const ok = Math.abs(toMin(r) - toMin(c.rise)) <= 2 && Math.abs(toMin(s) - toMin(c.set)) <= 2;
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${c.name} ${tz} ${(end - start) / 36e5}h  rise ${r} (exp ${c.rise})  set ${s} (exp ${c.set})  noon ${hm(d.noon, tz)} ${d.noonAlt.toFixed(1)}°`);
}
// Moscow solar noon on the June solstice: altitude ≈ 90 − 55.76 + 23.44 = 57.7°
const p = sunPos(Date.UTC(2026, 5, 21, 9, 30), 55.7558, 37.6173);
console.log('Moscow 12:30 MSK az/alt', p.az.toFixed(1), p.alt.toFixed(1));
console.log('Moon lit on 2026-11-24 (full moon)', moonIllum(Date.UTC(2026, 10, 24, 12)).fraction.toFixed(2));
process.exit(fail ? 1 : 0);
