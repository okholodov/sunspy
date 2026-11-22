// Building shadows on the ground. Every building is a prism (footprint × [min_height, height]);
// its shadow is the footprint swept along the sun's opposite direction. All shadows are drawn in solid
// colour into one canvas (so overlaps don't get darker), which the map drapes on the ground as a raster.

const SRC = 'bshadow';
export const SHADOW_LAYER = 'bshadow-layer';
const MAX_PX = 2048;
const MIN_ZOOM = 14.5;
const MAX_LEN = 900; // m; very low sun gives endless shadows

const canvas = document.createElement('canvas');
canvas.width = canvas.height = 4;
const ctx = canvas.getContext('2d');

const mercX = (lng) => (lng + 180) / 360;
const mercY = (lat) => { const s = Math.sin((lat * Math.PI) / 180); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI); };
const unY = (y) => (360 / Math.PI) * Math.atan(Math.exp((0.5 - y) * 2 * Math.PI)) - 90;

export function addShadowLayer(map, beforeId) {
  if (map.getSource(SRC)) return;
  map.addSource(SRC, { type: 'canvas', canvas, animate: false, coordinates: [[0, 0.001], [0.001, 0.001], [0.001, 0], [0, 0]] });
  map.addLayer({ id: SHADOW_LAYER, type: 'raster', source: SRC, paint: { 'raster-opacity': 0.42, 'raster-fade-duration': 0, 'raster-resampling': 'linear' } }, beforeId);
}

function clear(map) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  upload(map);
}

function upload(map) {
  const src = map.getSource(SRC);
  if (!src) return;
  src.play(); src.pause(); // forces a texture re-upload of the canvas
  map.triggerRepaint();
}

/** sun: { az, alt } apparent, degrees. Returns number of buildings drawn. */
export function drawShadows(map, sun, enabled) {
  if (!map.getSource(SRC)) return 0;
  if (!enabled || map.getZoom() < MIN_ZOOM || sun.alt <= 0.3) { clear(map); return 0; }

  const tanAlt = Math.tan((sun.alt * Math.PI) / 180);
  const azr = (sun.az * Math.PI) / 180;
  const dirE = -Math.sin(azr), dirN = -Math.cos(azr); // shadow points away from the sun

  // Area: the visible bounds (capped near the centre when pitched toward the horizon) plus the longest shadow.
  const c = map.getCenter();
  const b = map.getBounds();
  const cosC = Math.cos((c.lat * Math.PI) / 180);
  const capM = 2600;
  const capLat = capM / 111320, capLng = capM / (111320 * cosC);
  let west = Math.max(b.getWest(), c.lng - capLng), east = Math.min(b.getEast(), c.lng + capLng);
  let south = Math.max(b.getSouth(), c.lat - capLat), north = Math.min(b.getNorth(), c.lat + capLat);
  const padM = Math.min(MAX_LEN, 60 / tanAlt) + 50;
  west -= padM / (111320 * cosC); east += padM / (111320 * cosC);
  south -= padM / 111320; north += padM / 111320;

  const X0 = mercX(west), X1 = mercX(east), Y0 = mercY(north), Y1 = mercY(south);
  // About one canvas pixel per screen pixel: finer gets aliased when the GPU shrinks it, coarser looks blocky.
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const targetMpp = (40075016.686 * cosC) / (512 * 2 ** map.getZoom()) / dpr;
  let W = ((east - west) * 111320 * cosC) / targetMpp;
  let H = ((north - south) * 111320) / targetMpp;
  const k = Math.min(1, MAX_PX / Math.max(W, H));
  W = Math.max(64, Math.round(W * k)); H = Math.max(64, Math.round(H * k));
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  const sx = W / (X1 - X0), sy = H / (Y1 - Y0);
  const mPerPx = ((east - west) * 111320 * cosC) / W;
  const toPx = (lng, lat) => [(mercX(lng) - X0) * sx, (mercY(lat) - Y0) * sy];

  const feats = map.querySourceFeatures('openmaptiles', { sourceLayer: 'building' });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0b1026';
  const footprints = [];
  let count = 0;

  for (const f of feats) {
    const g = f.geometry;
    if (!g) continue;
    const p = f.properties || {};
    const top = +(p.render_height ?? p.height ?? 8);
    const base = +(p.render_min_height ?? p.min_height ?? 0);
    if (!(top > base)) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : null;
    if (!polys) continue;
    const l1 = Math.min(MAX_LEN, base / tanAlt) / mPerPx, l2 = Math.min(MAX_LEN, top / tanAlt) / mPerPx;
    const o1x = dirE * l1, o1y = -dirN * l1, o2x = dirE * l2, o2y = -dirN * l2;
    for (const poly of polys) {
      const rings = poly.map((ring) => ring.map(([lng, lat]) => toPx(lng, lat)));
      const outer = rings[0];
      // quick reject: footprint outside canvas
      let inView = false;
      for (const [x, y] of outer) if (x > -50 && y > -50 && x < W + 50 && y < H + 50) { inView = true; break; }
      if (!inView && !(l2 > 50)) continue;
      count++;
      // translated footprints (top and base of the prism)
      for (const [ox, oy] of [[o1x, o1y], [o2x, o2y]]) {
        ctx.beginPath();
        for (const ring of rings) { ring.forEach(([x, y], i) => (i ? ctx.lineTo(x + ox, y + oy) : ctx.moveTo(x + ox, y + oy))); ctx.closePath(); }
        ctx.fill('evenodd');
      }
      // every edge swept between them
      ctx.beginPath();
      for (const ring of rings) {
        for (let i = 0; i < ring.length - 1; i++) {
          const [ax, ay] = ring[i], [bx, by] = ring[i + 1];
          ctx.moveTo(ax + o1x, ay + o1y); ctx.lineTo(bx + o1x, by + o1y); ctx.lineTo(bx + o2x, by + o2y); ctx.lineTo(ax + o2x, ay + o2y); ctx.closePath();
        }
      }
      ctx.fill('nonzero');
      if (base < 2) footprints.push(rings);
    }
  }
  // Roofs are lit: cut each building's own footprint out of the shadow layer.
  ctx.globalCompositeOperation = 'destination-out';
  for (const rings of footprints) {
    ctx.beginPath();
    for (const ring of rings) { ring.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); }
    ctx.fill('evenodd');
  }
  ctx.globalCompositeOperation = 'source-over';

  const src = map.getSource(SRC);
  const n = unY(Y0), s = unY(Y1);
  src.setCoordinates([[west, n], [east, n], [east, s], [west, s]]);
  upload(map);
  return count;
}
