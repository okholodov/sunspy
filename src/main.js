import './style.css';
import { createMap, applyLook, lightFromSun, drawOverlays, setSpots, updateShadows, makePin } from './mapview.js';
import { sunPos, moonPos, moonIllum, apparent, dayInfo, phaseOf, moonPhaseKey } from './astro.js';
import { tzAt, zoned, fromZoned, dayBounds, addDays, dateStr, parseDate, hm, utcLabel, deviceTz, pad } from './tz.js';
import { t, applyStatic, cardinal, getLang, setLang } from './i18n.js';
import { Timeline } from './timeline.js';
import { ARView } from './ar.js';
import { searchPlaces, parseCoords, reverseName } from './search.js';
import * as store from './store.js';
import { computeHorizon } from './horizon.js';

const $ = (id) => document.getElementById(id);
const saved = store.loadState();
const S = {
  lat: saved.lat ?? 55.7525, lng: saved.lng ?? 37.6231, zoom: saved.zoom ?? 15.5,
  style: saved.style ?? 'map', buildings3d: saved.buildings3d ?? true, bshadows: saved.bshadows ?? true,
  terrain: saved.terrain ?? false, horizonOn: saved.horizonOn ?? false, showMoon: saved.showMoon ?? true,
  units: saved.units ?? (/-US/i.test(navigator.language) ? 'ft' : 'm'), objH: saved.objH ?? 1.8,
  tz: 'UTC', date: '', t: Date.now(), live: true,
  day: null, samples: [], moonSamples: [], horizon: null,
};

// Shared link: #@lat,lng,zoom&d=YYYY-MM-DD&t=HH:MM
const fromHash = (() => {
  const h = new URLSearchParams(location.hash.slice(1).replace(/^@([^&]+)/, 'p=$1'));
  const p = h.get('p')?.split(',').map(Number);
  if (!p || p.length < 2 || p.some((x) => !Number.isFinite(x))) return null;
  return { lat: p[0], lng: p[1], zoom: p[2], d: h.get('d'), tm: h.get('t') };
})();
if (fromHash) { S.lat = fromHash.lat; S.lng = fromHash.lng; if (fromHash.zoom) S.zoom = fromHash.zoom; }

S.tz = tzAt(S.lat, S.lng);
S.date = dateStr(zoned(S.t, S.tz));
if (fromHash?.d && /^\d{4}-\d\d-\d\d$/.test(fromHash.d)) {
  S.date = fromHash.d;
  const [h, mi] = (fromHash.tm || '12:00').split(':').map(Number);
  const { y, m, d } = parseDate(S.date);
  S.t = fromZoned(y, m, d, h || 0, mi || 0, S.tz);
  S.live = false;
}

applyStatic();
$('build').textContent = typeof __BUILD__ !== 'undefined' ? __BUILD__ : 'dev';

// ---------- helpers ----------
const fmtLen = (m) => {
  if (!Number.isFinite(m)) return '—';
  if (S.units === 'ft') { const f = m * 3.28084; return f >= 1000 ? `${(f / 5280).toFixed(2)} mi` : `${f < 10 ? f.toFixed(1) : Math.round(f)} ${t('ft')}`; }
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m < 10 ? m.toFixed(1) : Math.round(m)} ${t('m')}`;
};
const fmtDur = (ms) => `${Math.floor(ms / 36e5)} ${t('h')} ${Math.round((ms % 36e5) / 6e4)} ${t('min')}`;
let toastTimer;
function toast(msg, ms = 2600) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}
const clockOf = (ms) => { const p = zoned(ms, S.tz); return { h: p.h, mi: p.mi }; };
const sunAt = (ms) => { const p = sunPos(ms, S.lat, S.lng); const app = apparent(p.alt); return { ...p, app, blocked: !!S.horizon && p.alt > -1 && app + 0.27 < S.horizon.at(p.az) }; };

// ---------- day computation ----------
function computeDay() {
  const { start, end } = dayBounds(S.date, S.tz);
  S.start = start; S.end = end;
  S.day = dayInfo(start, end, S.lat, S.lng, S.horizon?.at);
  S.samples = [];
  for (let ts = start; ts <= end; ts += 5 * 60000) {
    const s = sunAt(ts);
    const p = zoned(ts, S.tz);
    S.samples.push({ t: ts, az: s.az, alt: s.alt, app: s.app, blocked: s.blocked, hour: p.mi === 0 ? p.h : null });
  }
  S.moonSamples = [];
  for (let ts = start; ts <= end; ts += 10 * 60000) {
    const m = moonPos(ts, S.lat, S.lng);
    S.moonSamples.push({ t: ts, az: m.az, alt: m.alt });
  }
  timeline.setData({ start, end, tz: S.tz, sun: S.samples, moon: S.showMoon ? S.moonSamples : null });
  renderDayPanel();
}

// Lit part of the moon: a half-disc on the lit side plus a half-ellipse terminator.
function moonSvg({ fraction, phase }) {
  const r = 18, waxing = phase < 0.5;
  const rx = r * Math.abs(1 - 2 * fraction);
  const side = waxing ? 1 : 0; // lit limb on the right while waxing (as seen from the northern hemisphere)
  const flip = S.lat < 0 ? ' transform="scale(-1 1)"' : '';
  const termSweep = (fraction > 0.5) === waxing ? 1 : 0;
  const d = `M0 ${-r} A${r} ${r} 0 0 ${side} 0 ${r} A${rx} ${r} 0 0 ${termSweep} 0 ${-r}Z`;
  return `<svg class="moon-ico" viewBox="-20 -20 40 40" width="40" height="40"><circle r="${r}" fill="#2a2742" stroke="#ffffff22"/><path d="${d}" fill="#e9efff"${flip}/></svg>`;
}

// ---------- UI: day panel (chips, events, moon) ----------
const CHIP_DEFS = [
  ['blueAm', (d) => d.first('civilUp')],
  ['goldenAm', (d) => d.first('blueUp')],
  ['sunUp', (d) => d.first('sunUp')],
  ['noon', (d) => (d.noonAlt > -0.833 ? d.noon : null)],
  ['goldenPm', (d) => d.last('goldenDown')],
  ['sunDown', (d) => d.last('sunDown')],
  ['bluePm', (d) => d.last('blueDown')],
  ['terrainUp', (d) => d.first('terrainUp')],
  ['terrainDown', (d) => d.last('terrainDown')],
];
const CHIP_ICON = { blueAm: 'blue', goldenAm: 'gold', sunUp: 'rise', noon: 'noon', goldenPm: 'gold', sunDown: 'set', bluePm: 'blue', terrainUp: 'terrain', terrainDown: 'terrain' };

function renderDayPanel() {
  const d = S.day;
  const chips = $('chips');
  chips.innerHTML = '';
  const chipList = CHIP_DEFS.map(([key, get]) => [key, get(d)]).filter(([, ts]) => ts != null).sort((a, b) => a[1] - b[1]);
  for (const [key, ts] of chipList) {
    const b = document.createElement('button');
    b.className = `chip ${CHIP_ICON[key]}`;
    b.dataset.t = ts;
    b.innerHTML = `<i></i><span>${t('chips')[key]}</span><b>${hm(ts, S.tz)}</b>`;
    b.addEventListener('click', () => setTime(ts));
    chips.appendChild(b);
  }
  if (!chips.children.length) {
    const p = document.createElement('div');
    p.className = 'chip-note';
    p.textContent = d.noonAlt > 0 ? t('polarDay') : t('polarNight');
    chips.appendChild(p);
  }

  const ul = $('events');
  ul.innerHTML = '';
  const ev = t('ev');
  for (const e of d.events) {
    if (!ev[e.key]) continue;
    const li = document.createElement('li');
    const isMoon = e.key.startsWith('moon');
    const pos = isMoon ? moonPos(e.t, S.lat, S.lng) : sunPos(e.t, S.lat, S.lng);
    li.className = 'ev ' + (isMoon ? 'moon' : phaseOf(e.key === 'noon' ? 10 : sunPos(e.t + (e.rising ? 60000 : -60000), S.lat, S.lng).alt));
    if (e.key.startsWith('terrain')) li.classList.add('terrain');
    li.innerHTML = `<b>${hm(e.t, S.tz)}</b><span>${ev[e.key]}</span><small>${Math.round(pos.az)}° ${cardinal(pos.az)}</small>`;
    li.addEventListener('click', () => setTime(e.t));
    ul.appendChild(li);
  }
  const dl = document.createElement('li');
  dl.className = 'ev total';
  dl.innerHTML = `<b>${fmtDur(d.dayLength)}</b><span>${t('dayLength')}</span><small>${d.noonAlt.toFixed(1)}° max</small>`;
  ul.appendChild(dl);

  const ill = moonIllum(S.t);
  const mr = d.first('moonUp'), ms = d.first('moonDown');
  $('moon-info').innerHTML = `${moonSvg(ill)}
    <div><b>${t('moonPhase')[moonPhaseKey(ill.phase)]}</b><span>${Math.round(ill.fraction * 100)}% ${t('lit')}</span>
    <span>↑ ${hm(mr, S.tz)} &nbsp; ↓ ${hm(ms, S.tz)}</span></div>`;
  $('coords').textContent = `${S.lat.toFixed(5)}, ${S.lng.toFixed(5)} · ${S.tz}`;

  const days = (() => { const n = dateStr(zoned(Date.now(), S.tz)); return S.date === n ? t('today') : null; })();
  const { y, m, d: dd } = parseDate(S.date);
  const dt = new Date(Date.UTC(y, m - 1, dd, 12));
  $('d-label').textContent = (days ? days + ', ' : '') + dt.toLocaleDateString(getLang() === 'ru' ? 'ru-RU' : 'en-GB', { weekday: days ? undefined : 'short', day: 'numeric', month: 'short', year: y === new Date().getFullYear() ? undefined : 'numeric', timeZone: 'UTC' });
  $('d-input').value = S.date;
}

// ---------- UI: current moment ----------
let shadowTimer = 0, lastShadow = 0;
function scheduleShadows(force) {
  const now = performance.now();
  clearTimeout(shadowTimer);
  const run = () => { lastShadow = performance.now(); const s = sunAt(S.t); updateShadows(map, { az: s.az, alt: s.app }, S.bshadows && !s.blocked); };
  if (force || now - lastShadow > 90) run();
  else shadowTimer = setTimeout(run, 90);
}

let raf = 0;
function render() {
  if (raf) return;
  raf = requestAnimationFrame(() => { raf = 0; renderNow(); });
}
function renderNow() {
  const s = sunAt(S.t);
  const m = moonPos(S.t, S.lat, S.lng);
  const c = clockOf(S.t);
  $('clock').textContent = `${pad(c.h)}:${pad(c.mi)}`;
  const ph = phaseOf(s.alt);
  const pl = $('phase-label');
  pl.textContent = s.blocked && s.alt > 0 ? `${t('phase')[ph]} · ${t('blocked')}` : t('phase')[ph];
  pl.className = 'phase ' + ph;
  const dtz = deviceTz();
  const devOff = utcLabel(S.t, dtz), locOff = utcLabel(S.t, S.tz);
  $('tzinfo').innerHTML = `${S.tz.split('/').pop().replaceAll('_', ' ')} · ${locOff}` + (devOff !== locOff ? `<br><small>${t('yourTime')} ${hm(S.t, dtz)}</small>` : '');

  $('s-az').textContent = `${Math.round(s.az)}° ${cardinal(s.az)}`;
  $('s-alt').textContent = `${s.app.toFixed(1)}°`;
  const ratio = s.app > 0.3 ? 1 / Math.tan((s.app * Math.PI) / 180) : NaN;
  $('s-shadow').textContent = Number.isFinite(ratio) ? (ratio > 50 ? '>50×' : `${ratio < 10 ? ratio.toFixed(2) : ratio.toFixed(1)}×`) : '—';
  const mApp = apparent(m.alt);
  $('s-moon').textContent = mApp > -0.833 ? `${cardinal(m.az)} ${mApp.toFixed(0)}°` : '↓';
  $('obj-shadow').textContent = Number.isFinite(ratio) ? '→ ' + fmtLen(S.objH * ratio) : t('noShadow');

  for (const ch of $('chips').children) ch.classList?.toggle('on', Math.abs(+ch.dataset.t - S.t) < 60000);

  timeline.curAlt = s.alt;
  timeline.setTime(S.t);
  if (mapReady) {
    const rise = S.day.first('sunUp'), set = S.day.last('sunDown');
    drawOverlays(map, {
      lng: S.lng, lat: S.lat, sun: { az: s.az, alt: s.app }, blocked: s.blocked,
      rise: rise != null ? { az: sunPos(rise, S.lat, S.lng).az } : null,
      set: set != null ? { az: sunPos(set, S.lat, S.lng).az } : null,
      path: S.samples.map((p) => ({ az: p.az, alt: p.app, hour: p.hour })),
      moon: { az: m.az, alt: mApp }, showMoon: S.showMoon, objHeight: S.objH,
    });
    lightFromSun(map, { az: s.az, alt: s.app });
    scheduleShadows();
  }
  // darken the map at night, warm it in golden hour
  const n = s.app >= 0 ? 0 : Math.min(0.55, (-s.app / 18) * 0.55 + 0.08);
  night.style.background = s.app >= 6 ? 'transparent' : s.app >= 0 ? `rgba(255,140,40,${0.1 * (1 - s.app / 6)})` : `rgba(8,10,40,${n})`;
  persist();
}

let persistTimer;
function flush() {
  clearTimeout(persistTimer);
  const { lat, lng, style, buildings3d, bshadows, terrain, horizonOn, showMoon, units, objH } = S;
  store.saveState({ lat, lng, zoom: map.getZoom(), style, buildings3d, bshadows, terrain, horizonOn, showMoon, units, objH });
  const c = clockOf(S.t);
  history.replaceState(null, '', `#@${lat.toFixed(5)},${lng.toFixed(5)},${map.getZoom().toFixed(1)}&d=${S.date}&t=${pad(c.h)}:${pad(c.mi)}`);
}
function persist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(flush, 400);
}
window.addEventListener('pagehide', flush);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

// ---------- state changes ----------
function setTime(ts, { keepLive = false } = {}) {
  S.t = ts;
  if (!keepLive) S.live = false;
  const ds = dateStr(zoned(ts, S.tz));
  if (ds !== S.date) { S.date = ds; computeDay(); }
  render();
}

function setDate(ds) {
  const c = clockOf(S.t);
  const { y, m, d } = parseDate(ds);
  S.date = ds;
  S.t = fromZoned(y, m, d, c.h, c.mi, S.tz);
  S.live = false;
  computeDay();
  render();
}

function goNow() {
  S.live = true;
  S.t = Date.now();
  S.date = dateStr(zoned(S.t, S.tz));
  computeDay();
  render();
}

function setPlace(lat, lng, { final = true } = {}) {
  const c = clockOf(S.t);
  S.lat = lat; S.lng = lng;
  const tz = tzAt(lat, lng);
  if (tz !== S.tz) {
    S.tz = tz;
    if (S.live) { S.t = Date.now(); S.date = dateStr(zoned(S.t, tz)); }
    else { const { y, m, d } = parseDate(S.date); S.t = fromZoned(y, m, d, c.h, c.mi, tz); }
  }
  if (final) { S.horizon = null; refreshHorizon(); }
  computeDay();
  render();
}

// ---------- terrain horizon ----------
let horizonAbort;
async function refreshHorizon() {
  horizonAbort?.abort();
  const box = $('horizon-status');
  if (!S.horizonOn) { S.horizon = null; box.hidden = true; return; }
  const ctl = (horizonAbort = new AbortController());
  box.hidden = false;
  box.className = 'loading';
  box.textContent = t('horizonLoading');
  try {
    const h = await computeHorizon(S.lat, S.lng, { signal: ctl.signal });
    if (ctl.signal.aborted) return;
    S.horizon = h;
    computeDay();
    render();
    const up = S.day.first('terrainUp'), down = S.day.last('terrainDown');
    let maxH = -90, maxAz = 0;
    h.profile.forEach((v, i) => { if (v > maxH) { maxH = v; maxAz = i * h.step; } });
    box.className = '';
    box.innerHTML = `<b>${t('horizonCalc')}</b> · ${Math.round(h.ground)} ${t('m')}<br>` +
      `${t('ev').terrainUp}: <b>${hm(up, S.tz)}</b> · ${t('ev').terrainDown}: <b>${hm(down, S.tz)}</b><br>` +
      `<small>max ${maxH.toFixed(1)}° @ ${Math.round(maxAz)}° ${cardinal(maxAz)}</small>`;
  } catch (e) {
    if (e.name === 'AbortError') return;
    box.className = 'error';
    box.textContent = t('horizonFail');
  }
}

// ---------- map ----------
let mapReady = false;
let pin;
const map = createMap('map', {
  center: [S.lng, S.lat],
  zoom: S.zoom,
  onReady: (m) => {
    mapReady = true;
    applyLook(m, S);
    setSpots(m, store.loadSpots());
    render();
  },
});
map.on('load', () => {
  document.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
  if (S.buildings3d && !fromHash) map.easeTo({ pitch: 45, duration: 800 });
});
// Keep the pin in the visible part of the map, above the bottom sheet.
function fitPadding() {
  const sh = document.getElementById('sheet');
  if (sh.classList.contains('open')) return; // the open sheet is temporary; don't shove the map around
  const wide = innerWidth >= 760;
  const pad = wide ? { top: 70, bottom: 20, left: sh.offsetWidth + 24, right: 70 } : { top: 70, bottom: Math.min(sh.offsetHeight, innerHeight * 0.6) - 10, left: 10, right: 60 };
  map.setPadding(pad);
  render();
}
new ResizeObserver(fitPadding).observe(document.getElementById('sheet'));
window.addEventListener('hashchange', () => location.reload());
const night = document.createElement('div');
night.id = 'night';
map.getCanvasContainer().appendChild(night);
pin = makePin(map, [S.lng, S.lat], (ll, final) => setPlace(ll.lat, ll.lng, { final }));

map.on('click', (e) => {
  if (!results.hidden || document.activeElement === q) { results.hidden = true; q.blur(); return; }
  const f = map.getLayer('spots') && map.queryRenderedFeatures(e.point, { layers: ['spots'] })[0];
  const ll = f ? { lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] } : e.lngLat;
  pin.setLngLat(ll);
  setPlace(ll.lat, ll.lng);
});
map.on('zoom', render);
map.on('moveend', () => { scheduleShadows(true); persist(); });
let srcTimer;
map.on('sourcedata', (e) => {
  if (e.sourceId !== 'openmaptiles' || !e.isSourceLoaded) return;
  clearTimeout(srcTimer);
  srcTimer = setTimeout(() => scheduleShadows(true), 250);
});
map.on('rotate', () => { $('btn-north').hidden = Math.abs(map.getBearing()) < 1; $('btn-north').firstChild.style.transform = `rotate(${-map.getBearing()}deg)`; });
map.on('pitchend', () => $('btn-tilt').classList.toggle('on', map.getPitch() > 10));
$('btn-north').addEventListener('click', () => map.easeTo({ bearing: 0 }));
$('btn-tilt').addEventListener('click', () => {
  const tilted = map.getPitch() > 10;
  map.easeTo({ pitch: tilted ? 0 : 60, duration: 600 });
  $('btn-tilt').classList.toggle('on', !tilted);
});

// ---------- timeline & time controls ----------
const timeline = new Timeline($('timeline'), (ts) => { stopPlay(); setTime(ts); });
$('d-prev').addEventListener('click', () => setDate(addDays(S.date, -1)));
$('d-next').addEventListener('click', () => setDate(addDays(S.date, 1)));
$('d-input').addEventListener('change', (e) => { if (e.target.value) setDate(e.target.value); });
$('btn-now').addEventListener('click', () => { stopPlay(); goNow(); });
setInterval(() => { if (S.live && document.visibilityState === 'visible') setTime(Date.now(), { keepLive: true }); }, 30000);
document.addEventListener('visibilitychange', () => { if (S.live && document.visibilityState === 'visible') goNow(); });

let playing = 0;
function stopPlay() { if (playing) { cancelAnimationFrame(playing); playing = 0; $('btn-play').classList.remove('on'); } }
$('btn-play').addEventListener('click', () => {
  if (playing) return stopPlay();
  if (S.t >= S.end - 5 * 60000) S.t = S.start;
  $('btn-play').classList.add('on');
  let last = performance.now();
  const step = (now) => {
    const dt = Math.min(64, now - last); last = now;
    const next = S.t + dt * 60000 * 0.25 * 60 / 16; // ≈ 15 min of day per 1/16 s
    if (next >= S.end - 60000) { setTime(S.end - 60000); stopPlay(); return; }
    setTime(Math.round(next));
    playing = requestAnimationFrame(step);
  };
  playing = requestAnimationFrame(step);
});

// ---------- sheet ----------
const sheet = $('sheet');
$('sheet-toggle').addEventListener('click', () => sheet.classList.toggle('open'));
let sy = null;
sheet.addEventListener('touchstart', (e) => { if (!e.target.closest('canvas,.chips,input,.details')) sy = e.touches[0].clientY; }, { passive: true });
sheet.addEventListener('touchend', (e) => {
  if (sy == null) return;
  const dy = e.changedTouches[0].clientY - sy;
  if (dy < -30) sheet.classList.add('open');
  if (dy > 30) sheet.classList.remove('open');
  sy = null;
});

// ---------- object height ----------
const objInput = $('obj-h');
function showObj() {
  objInput.value = S.units === 'ft' ? +(S.objH * 3.28084).toFixed(1) : +S.objH.toFixed(2);
  $('obj-unit').textContent = t(S.units);
}
objInput.addEventListener('input', () => {
  const v = parseFloat(objInput.value.replace(',', '.'));
  if (!Number.isFinite(v) || v < 0) return;
  S.objH = S.units === 'ft' ? v / 3.28084 : v;
  render();
});

// ---------- search ----------
const q = $('q'), results = $('results');
let searchAbort, searchTimer;
function showResults(items, msg) {
  results.innerHTML = '';
  if (msg) { const li = document.createElement('li'); li.className = 'msg'; li.textContent = msg; results.appendChild(li); }
  for (const it of items) {
    const li = document.createElement('li');
    li.innerHTML = '<b></b><small></small>';
    li.firstChild.textContent = it.title;
    li.lastChild.textContent = it.sub || '';
    li.addEventListener('click', () => goTo(it));
    results.appendChild(li);
  }
  results.hidden = !items.length && !msg;
}
function goTo(it) {
  results.hidden = true;
  q.blur();
  pin.setLngLat([it.lng, it.lat]);
  setPlace(it.lat, it.lng);
  if (it.extent) {
    const [w, n, e, s] = it.extent;
    const big = Math.abs(e - w) > 0.05 || Math.abs(n - s) > 0.05;
    if (!big) { map.fitBounds([[w, s], [e, n]], { padding: 80, maxZoom: 17, duration: 1200 }); return; }
  }
  map.flyTo({ center: [it.lng, it.lat], zoom: Math.max(map.getZoom(), 16), duration: 1200 });
}
q.addEventListener('input', () => {
  $('q-clear').hidden = !q.value;
  clearTimeout(searchTimer);
  const v = q.value.trim();
  if (v.length < 3) { showResults([]); return; }
  const c = parseCoords(v);
  if (c) { showResults([{ title: `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`, sub: '📍', ...c }]); return; }
  searchTimer = setTimeout(async () => {
    searchAbort?.abort();
    searchAbort = new AbortController();
    try {
      const center = map.getCenter();
      const r = await searchPlaces(v, { lat: center.lat, lng: center.lng }, searchAbort.signal);
      showResults(r, r.length ? null : t('nothingFound'));
    } catch (e) {
      if (e.name !== 'AbortError') showResults([], t('searchFail'));
    }
  }, 350);
});
q.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { const first = results.querySelector('li:not(.msg)'); if (first) first.click(); }
  if (e.key === 'Escape') { results.hidden = true; q.blur(); }
});
q.addEventListener('focus', () => { if (results.children.length) results.hidden = false; });
$('q-clear').addEventListener('click', () => { q.value = ''; $('q-clear').hidden = true; showResults([]); q.focus(); });
map.on('movestart', () => { if (document.activeElement !== q) results.hidden = true; });

// ---------- dialogs ----------
for (const b of document.querySelectorAll('[data-close]')) b.addEventListener('click', () => b.closest('dialog').close());
for (const d of document.querySelectorAll('dialog.sheet-dlg')) d.addEventListener('click', (e) => { if (e.target === d) d.close(); });

function ask(title, value) {
  const dlg = $('dlg-prompt');
  $('prompt-title').textContent = title;
  const inp = $('prompt-input');
  inp.value = value || '';
  dlg.returnValue = '';
  dlg.showModal();
  setTimeout(() => inp.select(), 50);
  return {
    dlg, inp,
    result: new Promise((res) => dlg.addEventListener('close', () => res(dlg.returnValue === 'ok' ? inp.value.trim() : null), { once: true })),
  };
}
function confirmDlg(title) {
  const dlg = $('dlg-confirm');
  $('confirm-title').textContent = title;
  dlg.returnValue = '';
  dlg.showModal();
  return new Promise((res) => dlg.addEventListener('close', () => res(dlg.returnValue === 'ok'), { once: true }));
}
$('prompt-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('dlg-prompt').close('ok'); } });

// layers / settings
function syncSettingsUI() {
  for (const b of $('seg-style').children) b.classList.toggle('on', b.dataset.v === S.style);
  for (const b of $('seg-units').children) b.classList.toggle('on', b.dataset.v === S.units);
  for (const b of $('seg-lang').children) b.classList.toggle('on', b.dataset.v === getLang());
  $('opt-3d').checked = S.buildings3d;
  $('opt-bshadows').checked = S.bshadows;
  $('opt-terrain').checked = S.terrain;
  $('opt-horizon').checked = S.horizonOn;
  $('opt-moon').checked = S.showMoon;
}
$('btn-layers').addEventListener('click', () => { syncSettingsUI(); $('dlg-layers').showModal(); });
$('seg-style').addEventListener('click', (e) => { const v = e.target.dataset?.v; if (!v) return; S.style = v; applyLook(map, S); syncSettingsUI(); persist(); });
$('seg-units').addEventListener('click', (e) => { const v = e.target.dataset?.v; if (!v) return; S.units = v; showObj(); syncSettingsUI(); render(); });
$('seg-lang').addEventListener('click', (e) => {
  const v = e.target.dataset?.v; if (!v) return;
  setLang(v); applyStatic(); syncSettingsUI(); showObj(); computeDay(); render();
  if (!$('horizon-status').hidden) refreshHorizon();
});
$('opt-3d').addEventListener('change', (e) => {
  S.buildings3d = e.target.checked; applyLook(map, S); persist();
  if (S.buildings3d && map.getPitch() < 10) map.easeTo({ pitch: 50 });
});
$('opt-bshadows').addEventListener('change', (e) => { S.bshadows = e.target.checked; scheduleShadows(true); persist(); });
$('opt-terrain').addEventListener('change', (e) => {
  S.terrain = e.target.checked; applyLook(map, S); persist();
  if (S.terrain && map.getPitch() < 10) map.easeTo({ pitch: 60, zoom: Math.min(map.getZoom(), 13.5) });
});
$('opt-horizon').addEventListener('change', (e) => { S.horizonOn = e.target.checked; S.horizon = null; refreshHorizon(); computeDay(); render(); persist(); });
$('opt-moon').addEventListener('change', (e) => { S.showMoon = e.target.checked; computeDay(); render(); });

// spots
function renderSpots() {
  const list = store.loadSpots();
  const ul = $('spot-list');
  ul.innerHTML = '';
  if (!list.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = t('noSpots'); ul.appendChild(li); }
  for (const s of list) {
    const li = document.createElement('li');
    li.innerHTML = `<button class="spot-go"><b></b><small></small></button>
      <button class="icon-btn" data-a="rename" aria-label="${t('rename')}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg></button>
      <button class="icon-btn danger" data-a="del" aria-label="${t('del')}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg></button>`;
    li.querySelector('b').textContent = s.name;
    const tz = tzAt(s.lat, s.lng);
    const { start, end } = dayBounds(dateStr(zoned(S.t, tz)), tz);
    const di = dayInfo(start, end, s.lat, s.lng);
    li.querySelector('small').textContent = `☀↑ ${hm(di.rise, tz)}  ☀↓ ${hm(di.set, tz)} · ${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}`;
    li.querySelector('.spot-go').addEventListener('click', () => {
      $('dlg-spots').close();
      pin.setLngLat([s.lng, s.lat]);
      setPlace(s.lat, s.lng);
      map.flyTo({ center: [s.lng, s.lat], zoom: Math.max(15.5, map.getZoom()), duration: 1200 });
    });
    li.querySelector('[data-a=rename]').addEventListener('click', async () => {
      const name = await ask(t('rename'), s.name).result;
      if (name) { store.updateSpot(s.id, { name }); renderSpots(); setSpots(map, store.loadSpots()); }
    });
    li.querySelector('[data-a=del]').addEventListener('click', async () => {
      if (!(await confirmDlg(t('delConfirm')(s.name)))) return;
      store.deleteSpot(s.id);
      renderSpots();
      setSpots(map, store.loadSpots());
      toast(t('deleted'));
    });
    ul.appendChild(li);
  }
}
$('btn-spots').addEventListener('click', () => { renderSpots(); $('dlg-spots').showModal(); });
$('btn-save').addEventListener('click', async () => {
  const lat = S.lat, lng = S.lng;
  const fallback = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  const p = ask(t('spotName'), fallback);
  reverseName(lat, lng).then((n) => { if (n && p.inp.value === fallback) { p.inp.value = n; p.inp.select(); } });
  const name = await p.result;
  if (name == null) return;
  store.addSpot({ name: name || fallback, lat, lng });
  setSpots(map, store.loadSpots());
  toast(t('saved'));
});

// locate
function locate(quiet) {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude: lat, longitude: lng } = pos.coords;
      pin.setLngLat([lng, lat]);
      setPlace(lat, lng);
      map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 16), duration: 1200 });
    },
    () => { if (!quiet) toast(t('locFail')); },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
  );
}
$('btn-locate').addEventListener('click', () => locate(false));

// share
$('btn-share').addEventListener('click', async () => {
  persist();
  await new Promise((r) => setTimeout(r, 450));
  const url = location.href;
  try {
    if (navigator.share) await navigator.share({ title: 'SunSpy', text: `${S.date} ${$('clock').textContent}`, url });
    else { await navigator.clipboard.writeText(url); toast(t('copied')); }
  } catch { /* user cancelled */ }
});

// AR
const ar = new ARView($('ar'), () => {
  const s = sunAt(S.t);
  const m = moonPos(S.t, S.lat, S.lng);
  return {
    sunPath: S.samples, sun: { az: s.az, app: s.app },
    moonPath: S.showMoon ? S.moonSamples.map((p) => ({ az: p.az, alt: apparent(p.alt) })) : null,
    moon: S.showMoon && m.alt > -1 ? { az: m.az, app: apparent(m.alt) } : null,
    horizon: S.horizon?.at || null,
    label: $('clock').textContent,
  };
});
$('btn-ar').addEventListener('click', async () => {
  try { await ar.open(); } catch (e) { toast(e.message, 4000); }
});

// ---------- start ----------
showObj();
computeDay();
render();
if (S.horizonOn) refreshHorizon();
if (!saved.lat && !fromHash) locate(true);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
if (import.meta.env.DEV) window.__sunspy = { map, S, ar };
