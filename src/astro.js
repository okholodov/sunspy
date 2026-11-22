// Sun and moon positions. Formulas follow SunCalc (Vladimir Agafonkin, BSD-2) / Astronomy Answers,
// plus topocentric moon parallax. Events (sunrise, golden hour…) are found numerically, so they work
// for any altitude threshold, polar days/nights and a terrain horizon.

const PI = Math.PI;
const rad = PI / 180;
const deg = 180 / PI;
const dayMs = 864e5;
const J1970 = 2440588;
const J2000 = 2451545;
const OBLIQ = rad * 23.4397;

const toDays = (ms) => ms / dayMs - 0.5 + J1970 - J2000;
const rightAscension = (l, b) => Math.atan2(Math.sin(l) * Math.cos(OBLIQ) - Math.tan(b) * Math.sin(OBLIQ), Math.cos(l));
const declination = (l, b) => Math.asin(Math.sin(b) * Math.cos(OBLIQ) + Math.cos(b) * Math.sin(OBLIQ) * Math.sin(l));
const azimuthS = (H, phi, dec) => Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
const altitude = (H, phi, dec) => Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
const sidereal = (d, lw) => rad * (280.16 + 360.9856235 * d) - lw;
const toCompass = (azS) => ((azS * deg + 180) % 360 + 360) % 360;

function sunCoords(d) {
  const M = rad * (357.5291 + 0.98560028 * d);
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + rad * 102.9372 + PI;
  return { dec: declination(L, 0), ra: rightAscension(L, 0) };
}

function moonCoords(d) {
  const L = rad * (218.316 + 13.176396 * d);
  const M = rad * (134.963 + 13.064993 * d);
  const F = rad * (93.272 + 13.22935 * d);
  const l = L + rad * 6.289 * Math.sin(M);
  const b = rad * 5.128 * Math.sin(F);
  return { ra: rightAscension(l, b), dec: declination(l, b), dist: 385001 - 20905 * Math.cos(M) };
}

/** Atmospheric refraction (degrees) for a geometric altitude in degrees (Sæmundsson). */
export function refraction(h) {
  if (h < -1.9) return 0;
  return 1.02 / Math.tan((h + 10.3 / (h + 5.11)) * rad) / 60;
}

/** Sun: compass azimuth (0 = north, clockwise) and geometric altitude, both in degrees. */
export function sunPos(ms, lat, lng) {
  const lw = rad * -lng, phi = rad * lat, d = toDays(ms);
  const c = sunCoords(d);
  const H = sidereal(d, lw) - c.ra;
  return { az: toCompass(azimuthS(H, phi, c.dec)), alt: altitude(H, phi, c.dec) * deg };
}

/** Apparent altitude (what you see, with refraction). */
export const apparent = (alt) => alt + refraction(alt);

/** Moon: compass azimuth, topocentric geometric altitude (deg), distance (km). */
export function moonPos(ms, lat, lng) {
  const lw = rad * -lng, phi = rad * lat, d = toDays(ms);
  const c = moonCoords(d);
  const H = sidereal(d, lw) - c.ra;
  let h = altitude(H, phi, c.dec);
  h -= Math.asin(6378.14 / c.dist) * Math.cos(h); // parallax: the moon is close enough for it to matter (~1°)
  return { az: toCompass(azimuthS(H, phi, c.dec)), alt: h * deg, dist: c.dist };
}

/** fraction lit (0–1), phase (0 new → 0.5 full → 1 new). */
export function moonIllum(ms) {
  const d = toDays(ms);
  const s = sunCoords(d), m = moonCoords(d), sdist = 149598000;
  const phi = Math.acos(Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra));
  const inc = Math.atan2(sdist * Math.sin(phi), m.dist - sdist * Math.cos(phi));
  const angle = Math.atan2(Math.cos(s.dec) * Math.sin(s.ra - m.ra), Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra));
  return { fraction: (1 + Math.cos(inc)) / 2, phase: 0.5 + (0.5 * inc * (angle < 0 ? -1 : 1)) / PI };
}

// Altitude thresholds (geometric, degrees). Golden / blue hour as used by most photo planners.
export const ALT = { ASTRO: -18, NAUTICAL: -12, CIVIL: -6, BLUE_GOLD: -4, HORIZON: -0.833, GOLDEN_END: 6 };

export function phaseOf(alt) {
  if (alt >= ALT.GOLDEN_END) return 'day';
  if (alt >= ALT.BLUE_GOLD) return 'golden';
  if (alt >= ALT.CIVIL) return 'blue';
  if (alt >= ALT.NAUTICAL) return 'nautical';
  if (alt >= ALT.ASTRO) return 'astro';
  return 'night';
}

/** Find times in [t0,t1] where f crosses zero, refined by bisection. f is sampled every `step` ms. */
function crossings(f, t0, t1, step) {
  const out = [];
  let ta = t0, fa = f(ta);
  while (ta < t1) {
    const tb = Math.min(ta + step, t1);
    const fb = f(tb);
    if ((fa < 0) !== (fb < 0)) {
      let lo = ta, hi = tb, flo = fa;
      for (let i = 0; i < 14; i++) {
        const mid = (lo + hi) / 2, fm = f(mid);
        if ((fm < 0) === (flo < 0)) { lo = mid; flo = fm; } else hi = mid;
      }
      out.push({ t: Math.round((lo + hi) / 2), rising: fb > fa });
    }
    ta = tb; fa = fb;
  }
  return out;
}

/**
 * Everything about one local day at a place.
 * horizon(az) → apparent horizon altitude in degrees from terrain (optional).
 */
export function dayInfo(start, end, lat, lng, horizon) {
  const step = 5 * 60000;
  const sunAlt = (t) => sunPos(t, lat, lng).alt;
  const ev = [];
  const add = (key, th) => { for (const c of crossings((t) => sunAlt(t) - th, start, end, step)) ev.push({ ...c, key: key + (c.rising ? 'Up' : 'Down') }); };
  add('astro', ALT.ASTRO);
  add('nautical', ALT.NAUTICAL);
  add('civil', ALT.CIVIL);
  add('blue', ALT.BLUE_GOLD);
  add('sun', ALT.HORIZON);
  add('golden', ALT.GOLDEN_END);

  // Solar noon: highest point of the day (ternary search around the best sample).
  let best = start, bestAlt = -99;
  for (let t = start; t <= end; t += step) { const a = sunAlt(t); if (a > bestAlt) { bestAlt = a; best = t; } }
  let lo = Math.max(start, best - step), hi = Math.min(end, best + step);
  for (let i = 0; i < 30; i++) {
    const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
    if (sunAlt(m1) < sunAlt(m2)) lo = m1; else hi = m2;
  }
  const noon = Math.round((lo + hi) / 2);
  ev.push({ key: 'noon', t: noon });

  if (horizon) {
    // Upper limb clears the ridge line.
    const f = (t) => { const p = sunPos(t, lat, lng); return apparent(p.alt) + 0.27 - Math.max(horizon(p.az), -2); };
    for (const c of crossings(f, start, end, 2 * 60000)) ev.push({ ...c, key: c.rising ? 'terrainUp' : 'terrainDown' });
  }

  const moonAlt = (t) => moonPos(t, lat, lng).alt;
  for (const c of crossings((t) => moonAlt(t) - ALT.HORIZON, start, end, 10 * 60000)) ev.push({ ...c, key: c.rising ? 'moonUp' : 'moonDown' });

  ev.sort((a, b) => a.t - b.t);
  const first = (k) => ev.find((e) => e.key === k)?.t ?? null;
  const last = (k) => { for (let i = ev.length - 1; i >= 0; i--) if (ev[i].key === k) return ev[i].t; return null; };
  const rise = first('sunUp'), set = last('sunDown');
  let dayLength;
  if (rise != null && set != null && set > rise) dayLength = set - rise;
  else if (rise == null && set == null) dayLength = sunAlt(noon) > ALT.HORIZON ? end - start : 0;
  else dayLength = rise != null ? end - rise : set - start;

  return { events: ev, noon, noonAlt: sunAlt(noon), rise, set, dayLength, first, last };
}

export const MOON_PHASES = ['new', 'waxCrescent', 'firstQuarter', 'waxGibbous', 'full', 'wanGibbous', 'lastQuarter', 'wanCrescent'];
export function moonPhaseKey(phase) {
  return MOON_PHASES[Math.round(phase * 8) % 8];
}

export { rad, deg };
