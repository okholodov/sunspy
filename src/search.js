// Place search (Photon by Komoot, OpenStreetMap data, free) with Nominatim as fallback.
import { getLang } from './i18n.js';

/** "55.75, 37.62" / "55.75 37.62" / "55°45'N 37°37'E" → {lat,lng} */
export function parseCoords(q) {
  const s = q.trim().replace(/,(?=\s*-?\d)/g, ' ');
  const dec = s.match(/^(-?\d{1,2}(?:\.\d+)?)\s+(-?\d{1,3}(?:\.\d+)?)$/);
  if (dec) {
    const lat = +dec[1], lng = +dec[2];
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
  }
  const dms = s.match(/(\d+)[°\s]+(\d+)?['′\s]*([\d.]+)?["″\s]*([NSСЮ])\s*(\d+)[°\s]+(\d+)?['′\s]*([\d.]+)?["″\s]*([EWВЗ])/i);
  if (dms) {
    const conv = (d, m, sec, h) => (+d + (+m || 0) / 60 + (+sec || 0) / 3600) * (/[SЮWЗ]/i.test(h) ? -1 : 1);
    return { lat: conv(dms[1], dms[2], dms[3], dms[4]), lng: conv(dms[5], dms[6], dms[7], dms[8]) };
  }
  return null;
}

function label(p) {
  const name = p.name || [p.street, p.housenumber].filter(Boolean).join(' ');
  const street = p.name && p.street ? [p.street, p.housenumber].filter(Boolean).join(' ') : '';
  const rest = [street, p.city || p.town || p.village || p.county, p.state, p.country].filter((x, i, a) => x && x !== name && a.indexOf(x) === i);
  return { title: name || rest.shift() || '?', sub: rest.join(', ') };
}

export async function searchPlaces(q, near, signal) {
  const lang = getLang() === 'en' ? 'en' : 'default';
  try {
    const u = new URL('https://photon.komoot.io/api/');
    u.searchParams.set('q', q);
    u.searchParams.set('limit', '7');
    u.searchParams.set('lang', lang);
    if (near) { u.searchParams.set('lat', near.lat.toFixed(3)); u.searchParams.set('lon', near.lng.toFixed(3)); }
    const r = await fetch(u, { signal });
    if (!r.ok) throw new Error(r.status);
    const j = await r.json();
    const seen = new Set();
    return j.features
      .map((f) => ({ ...label(f.properties), lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], extent: f.properties.extent }))
      .filter((it) => { const k = it.title + '|' + it.sub; if (seen.has(k)) return false; seen.add(k); return true; }); // one street = many OSM ways
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    const u = new URL('https://nominatim.openstreetmap.org/search');
    u.searchParams.set('q', q);
    u.searchParams.set('format', 'jsonv2');
    u.searchParams.set('limit', '7');
    u.searchParams.set('accept-language', getLang());
    const r = await fetch(u, { signal });
    if (!r.ok) throw new Error(r.status);
    const j = await r.json();
    return j.map((p) => {
      const parts = p.display_name.split(', ');
      return { title: parts[0], sub: parts.slice(1, 4).join(', '), lat: +p.lat, lng: +p.lon };
    });
  }
}

export async function reverseName(lat, lng) {
  try {
    const u = new URL('https://photon.komoot.io/reverse');
    u.searchParams.set('lat', lat);
    u.searchParams.set('lon', lng);
    u.searchParams.set('lang', getLang() === 'en' ? 'en' : 'default');
    const r = await fetch(u);
    const j = await r.json();
    const p = j.features?.[0]?.properties;
    if (!p) return null;
    const l = label(p);
    return l.title;
  } catch { return null; }
}
