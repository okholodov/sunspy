// Terrain horizon: for every compass direction, how high the skyline (hills, mountains) rises above
// eye level at a point. Uses open Terrarium elevation tiles (AWS Open Data / Mapzen, global, ~30 m).

const TILE = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const R_EARTH = 6371000;
const K_REFR = 0.13; // terrestrial refraction makes the earth look flatter
const NEAR = { z: 12, radius: 7000 };
const FAR = { z: 10, radius: 50000 };
const STEP_DEG = 0.5;

const tileCache = new Map();

function lngLatToTile(lng, lat, z) {
  const n = 2 ** z;
  const x = ((lng + 180) / 360) * n;
  const s = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
  return [x, y];
}

async function loadTile(z, x, y, signal) {
  const n = 2 ** z;
  x = ((x % n) + n) % n;
  if (y < 0 || y >= n) return null;
  const key = `${z}/${x}/${y}`;
  if (tileCache.has(key)) return tileCache.get(key);
  const p = (async () => {
    const res = await fetch(TILE(z, x, y), { signal, mode: 'cors' });
    if (!res.ok) throw new Error('tile ' + res.status);
    const bmp = await createImageBitmap(await res.blob());
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    const px = ctx.getImageData(0, 0, c.width, c.height).data;
    const elev = new Float32Array(c.width * c.height);
    for (let i = 0; i < elev.length; i++) elev[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
    return { size: c.width, elev };
  })();
  tileCache.set(key, p);
  p.catch(() => tileCache.delete(key));
  if (tileCache.size > 80) tileCache.delete(tileCache.keys().next().value);
  return p;
}

/** Load all tiles of zoom z within `radius` meters; returns a bilinear sampler (lng,lat) → meters. */
async function grid(lat, lng, z, radius, signal) {
  const dLat = radius / 111320, dLng = radius / (111320 * Math.cos((lat * Math.PI) / 180));
  const [x0, y0] = lngLatToTile(lng - dLng, lat + dLat, z).map(Math.floor);
  const [x1, y1] = lngLatToTile(lng + dLng, lat - dLat, z).map(Math.floor);
  const tiles = new Map();
  const jobs = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) jobs.push(loadTile(z, x, y, signal).then((t) => tiles.set(`${x},${y}`, t)));
  await Promise.all(jobs);
  return (sLng, sLat) => {
    const [fx, fy] = lngLatToTile(sLng, sLat, z);
    const tx = Math.floor(fx), ty = Math.floor(fy);
    const t = tiles.get(`${tx},${ty}`);
    if (!t) return NaN;
    const px = (fx - tx) * t.size - 0.5, py = (fy - ty) * t.size - 0.5;
    const ix = Math.max(0, Math.min(t.size - 2, Math.floor(px))), iy = Math.max(0, Math.min(t.size - 2, Math.floor(py)));
    const ax = Math.min(1, Math.max(0, px - ix)), ay = Math.min(1, Math.max(0, py - iy));
    const e = t.elev, s = t.size, i = iy * s + ix;
    return (e[i] * (1 - ax) + e[i + 1] * ax) * (1 - ay) + (e[i + s] * (1 - ax) + e[i + s + 1] * ax) * ay;
  };
}

/**
 * Returns { ground, profile: Float32Array (deg per STEP_DEG), at(az) } or throws.
 * eye: observer height above ground in meters.
 */
export async function computeHorizon(lat, lng, { eye = 1.7, signal } = {}) {
  const [near, far] = await Promise.all([grid(lat, lng, NEAR.z, NEAR.radius, signal), grid(lat, lng, FAR.z, FAR.radius, signal)]);
  const ground = near(lng, lat);
  const e0 = (Number.isFinite(ground) ? ground : 0) + eye;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const n = Math.round(360 / STEP_DEG);
  const profile = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const az = (i * STEP_DEG * Math.PI) / 180;
    const sx = Math.sin(az), sy = Math.cos(az);
    let best = -90;
    for (let d = 40; d < FAR.radius; d = d < 2000 ? d + 25 : d * 1.012) {
      const sLat = lat + (d * sy) / 111320, sLng = lng + (d * sx) / (111320 * cosLat);
      const h = d < NEAR.radius - 500 ? near(sLng, sLat) : far(sLng, sLat);
      if (!Number.isFinite(h)) continue;
      const drop = ((d * d) / (2 * R_EARTH)) * (1 - K_REFR);
      const a = Math.atan2(h - drop - e0, d);
      if (a > best) best = a;
    }
    profile[i] = (best * 180) / Math.PI;
  }
  // Light smoothing removes single-sample spikes from noisy DEM pixels.
  const sm = new Float32Array(n);
  for (let i = 0; i < n; i++) sm[i] = Math.max(profile[i], (profile[(i + n - 1) % n] + profile[(i + 1) % n]) / 2) * 0.5 + profile[i] * 0.5;
  const at = (az) => {
    const f = ((((az % 360) + 360) % 360) / STEP_DEG);
    const i = Math.floor(f) % n, j = (i + 1) % n, w = f - Math.floor(f);
    return sm[i] * (1 - w) + sm[j] * w;
  };
  return { ground, profile: sm, at, step: STEP_DEG };
}
