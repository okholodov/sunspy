import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { addShadowLayer, drawShadows, SHADOW_LAYER } from './shadows.js';

maplibregl.setWorkerUrl(workerUrl);

const STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const SAT_TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const DEM_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const FONT = ['Noto Sans Bold'];

export const COLORS = {
  sun: '#ffd23f', rise: '#ff9a3c', set: '#ff4f5e', moon: '#a9c7ff', shadow: '#1b1f3a',
  golden: '#ff9f1c', day: '#ffe066', path: '#ffd23f',
};

const empty = () => ({ type: 'FeatureCollection', features: [] });
const R = 6378137;

/** Destination point `dist` meters from (lng,lat) toward compass bearing `az` (deg). */
export function dest(lng, lat, az, dist) {
  const a = (az * Math.PI) / 180;
  return [lng + ((dist * Math.sin(a)) / (R * Math.cos((lat * Math.PI) / 180))) * (180 / Math.PI), lat + ((dist * Math.cos(a)) / R) * (180 / Math.PI)];
}

export function createMap(container, { center, zoom, onReady }) {
  const map = new maplibregl.Map({
    container,
    style: STYLE,
    center,
    zoom,
    maxPitch: 75,
    attributionControl: false,
    fadeDuration: 0,
    canvasContextAttributes: { antialias: true },
  });
  map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: 'Imagery © Esri, Maxar · Elevation: Mapzen/AWS Terrain Tiles' }), 'bottom-left');
  map.touchZoomRotate.enableRotation();
  map.dragRotate.enable();

  map.on('style.load', () => {
    // Satellite under everything from the vector map except labels and buildings.
    const firstSymbol = map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
    map.addSource('sat', { type: 'raster', tiles: [SAT_TILES], tileSize: 256, maxzoom: 19 });
    map.addLayer({ id: 'sat', type: 'raster', source: 'sat', layout: { visibility: 'none' }, paint: { 'raster-fade-duration': 150 } }, 'building');
    map.addSource('dem', { type: 'raster-dem', tiles: [DEM_TILES], tileSize: 256, maxzoom: 15, encoding: 'terrarium' });
    map.addLayer({
      id: 'hillshade', type: 'hillshade', source: 'dem', layout: { visibility: 'none' },
      paint: { 'hillshade-exaggeration': 0.45, 'hillshade-illumination-anchor': 'map', 'hillshade-shadow-color': '#1b2140', 'hillshade-highlight-color': '#fff6d8', 'hillshade-accent-color': '#3a3150' },
    }, 'building');
    addShadowLayer(map, 'building');

    map.addSource('spots', { type: 'geojson', data: empty() });
    map.addLayer({ id: 'spots', type: 'circle', source: 'spots', paint: { 'circle-radius': 6, 'circle-color': '#ffffff', 'circle-stroke-color': '#ff7a1a', 'circle-stroke-width': 3 } }, firstSymbol);
    map.addLayer({
      id: 'spots-label', type: 'symbol', source: 'spots', minzoom: 11,
      layout: { 'text-field': ['get', 'name'], 'text-font': FONT, 'text-size': 12, 'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-max-width': 10 },
      paint: { 'text-color': '#fff', 'text-halo-color': '#1d1a2b', 'text-halo-width': 1.6 },
    });

    map.addSource('path', { type: 'geojson', data: empty() });
    map.addSource('lines', { type: 'geojson', data: empty() });
    map.addSource('marks', { type: 'geojson', data: empty() });
    map.addLayer({ id: 'path-halo', type: 'line', source: 'path', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#1d1a2b', 'line-width': 7, 'line-opacity': 0.35 } });
    map.addLayer({ id: 'path', type: 'line', source: 'path', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 4 } });
    map.addLayer({
      id: 'lines-halo', type: 'line', source: 'lines', filter: ['!=', ['get', 'kind'], 'shadow'],
      layout: { 'line-cap': 'round' }, paint: { 'line-color': '#1d1a2b', 'line-opacity': 0.4, 'line-width': ['+', ['get', 'w'], 3] },
    });
    map.addLayer({
      id: 'lines', type: 'line', source: 'lines',
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'w'], 'line-opacity': ['coalesce', ['get', 'o'], 1] },
    });
    map.addLayer({
      id: 'marks-dot', type: 'circle', source: 'marks', filter: ['has', 'r'],
      paint: { 'circle-radius': ['get', 'r'], 'circle-color': ['get', 'color'], 'circle-stroke-color': ['coalesce', ['get', 'stroke'], '#1d1a2b'], 'circle-stroke-width': ['coalesce', ['get', 'sw'], 2], 'circle-blur': ['coalesce', ['get', 'blur'], 0] },
    });
    map.addLayer({
      id: 'marks-label', type: 'symbol', source: 'marks', filter: ['has', 'label'],
      layout: { 'text-field': ['get', 'label'], 'text-font': FONT, 'text-size': ['coalesce', ['get', 'size'], 11], 'text-allow-overlap': true, 'text-ignore-placement': true, 'text-offset': ['coalesce', ['get', 'off'], ['literal', [0, 0]]] },
      paint: { 'text-color': ['coalesce', ['get', 'tc'], '#ffffff'], 'text-halo-color': '#1d1a2b', 'text-halo-width': 1.5 },
    });
    onReady?.(map);
  });
  return map;
}

/** Map look: 'map' | 'sat'; 3D buildings; terrain. */
export function applyLook(map, { style, buildings3d, terrain }) {
  if (!map.getLayer('sat')) return;
  const sat = style === 'sat';
  for (const l of map.getStyle().layers) {
    if (l.id === 'sat' || l.id === 'hillshade' || l.id === SHADOW_LAYER || l.source === 'spots' || ['path', 'lines', 'marks'].includes(l.source)) continue;
    if (l.type === 'fill' || l.type === 'line' || l.type === 'raster' || l.type === 'background') {
      if (l.id === 'building' && !sat) continue;
      const vis = sat ? (l.id.startsWith('boundary') ? 'visible' : 'none') : 'visible';
      if (l.id === 'background' && sat) continue;
      map.setLayoutProperty(l.id, 'visibility', vis);
    }
  }
  map.setLayoutProperty('sat', 'visibility', sat ? 'visible' : 'none');
  if (sat) map.setLayoutProperty('building', 'visibility', 'none');
  map.setLayoutProperty('building-3d', 'visibility', buildings3d ? 'visible' : 'none');
  if (map.getLayer('building-3d')) {
    map.setPaintProperty('building-3d', 'fill-extrusion-opacity', sat ? 0.9 : 0.85);
    map.setPaintProperty('building-3d', 'fill-extrusion-color', sat ? '#d9d4cc' : 'hsl(35,8%,88%)');
  }
  map.setPaintProperty(SHADOW_LAYER, 'raster-opacity', sat ? 0.5 : 0.42);
  map.setLayoutProperty('hillshade', 'visibility', terrain ? 'visible' : 'none');
  map.setTerrain(terrain ? { source: 'dem', exaggeration: 1.25 } : null);
}

/** Light the 3D buildings and hillshade from where the sun actually is. */
export function lightFromSun(map, sun) {
  if (!map.getLayer('hillshade')) return;
  const alt = Math.max(sun.alt, 2);
  map.setLight({ anchor: 'map', position: [1.4, sun.az, Math.min(88, 90 - alt)], intensity: sun.alt > 0 ? 0.5 : 0.25, color: sun.alt > 8 ? '#ffffff' : sun.alt > 0 ? '#ffe2c4' : '#9aaeff' });
  map.setPaintProperty('hillshade', 'hillshade-illumination-direction', sun.az);
}

/** Overlay radius: ~40% of the smaller screen side, in meters at the pin. */
export function overlayRadius(map, lat) {
  const c = map.getCanvas();
  const pad = map.getPadding();
  const px = Math.min(c.clientWidth - pad.left - pad.right, c.clientHeight - pad.top - pad.bottom) * 0.42;
  const mpp = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** map.getZoom());
  return px * mpp;
}

/**
 * Draw sun/moon lines and the sun path around the pin.
 * o: { lng, lat, sun:{az,alt}, rise:{az}|null, set:{az}|null, path:[{az,alt,t,hour?}], moon, objHeight, showMoon, blocked }
 */
export function drawOverlays(map, o) {
  if (!map.getSource('lines')) return;
  const L = overlayRadius(map, o.lat);
  const P = [o.lng, o.lat];
  const lines = [], marks = [], path = [];
  const line = (az, len, color, w, kind, extra = {}) => lines.push({ type: 'Feature', properties: { color, w, kind, ...extra }, geometry: { type: 'LineString', coordinates: [P, dest(o.lng, o.lat, az, len)] } });
  const at = (az, alt, scale = 1) => dest(o.lng, o.lat, az, L * scale * Math.cos((Math.max(0, alt) * Math.PI) / 180));

  // Sun path: radius shrinks as the sun climbs (a view of the sky dome from above).
  let seg = null;
  for (const p of o.path) {
    if (p.alt < -0.833) { seg = null; continue; }
    const color = p.alt < 6 ? COLORS.golden : COLORS.day;
    const pt = at(p.az, p.alt);
    if (!seg || seg.properties.color !== color) {
      const prev = seg ? seg.geometry.coordinates.at(-1) : null;
      seg = { type: 'Feature', properties: { color }, geometry: { type: 'LineString', coordinates: prev ? [prev] : [] } };
      path.push(seg);
    }
    seg.geometry.coordinates.push(pt);
    if (p.hour != null) marks.push({ type: 'Feature', properties: { r: 3, color: '#fff', sw: 1.5, label: String(p.hour), size: 10, off: [0, -1.1] }, geometry: { type: 'Point', coordinates: pt } });
  }
  for (const s of path) if (s.geometry.coordinates.length < 2) s.geometry.coordinates.push(s.geometry.coordinates[0]);

  if (o.rise) line(o.rise.az, L * 1.08, COLORS.rise, 3, 'rise');
  if (o.set) line(o.set.az, L * 1.08, COLORS.set, 3, 'set');

  if (o.showMoon && o.moon && o.moon.alt > -0.833) {
    line(o.moon.az, L * 0.95, COLORS.moon, 2.5, 'moon', { o: 0.95 });
    marks.push({ type: 'Feature', properties: { r: 7, color: '#e9efff', stroke: '#5a6fa8', sw: 2 }, geometry: { type: 'Point', coordinates: at(o.moon.az, o.moon.alt, 0.95) } });
  }

  if (o.sun.alt > -0.833) {
    line(o.sun.az, L * 1.15, COLORS.sun, 5, 'sun', { o: o.blocked ? 0.45 : 1 });
    const sp = at(o.sun.az, o.sun.alt);
    marks.push({ type: 'Feature', properties: { r: 16, color: '#ffd23f', stroke: '#ffd23f', sw: 0, blur: 0.8 }, geometry: { type: 'Point', coordinates: sp } });
    marks.push({ type: 'Feature', properties: { r: 8, color: o.blocked ? '#a99a6a' : '#fff4c2', stroke: '#ff9a1c', sw: 3 }, geometry: { type: 'Point', coordinates: sp } });
    // Real-scale shadow of an object standing at the pin.
    if (o.sun.alt > 0.3 && o.objHeight > 0) {
      const len = Math.min(5000, o.objHeight / Math.tan((o.sun.alt * Math.PI) / 180));
      const end = dest(o.lng, o.lat, (o.sun.az + 180) % 360, len);
      lines.push({ type: 'Feature', properties: { color: COLORS.shadow, w: 6, kind: 'shadow', o: 0.75 }, geometry: { type: 'LineString', coordinates: [P, end] } });
    }
  }

  map.getSource('lines').setData({ type: 'FeatureCollection', features: lines });
  map.getSource('marks').setData({ type: 'FeatureCollection', features: marks });
  map.getSource('path').setData({ type: 'FeatureCollection', features: path });
}

export function setSpots(map, spots) {
  map.getSource('spots')?.setData({
    type: 'FeatureCollection',
    features: spots.map((s) => ({ type: 'Feature', properties: { id: s.id, name: s.name }, geometry: { type: 'Point', coordinates: [s.lng, s.lat] } })),
  });
}

export function updateShadows(map, sun, enabled) {
  return drawShadows(map, sun, enabled);
}

export function makePin(map, lngLat, onMove) {
  const el = document.createElement('div');
  el.className = 'pin';
  el.innerHTML = '<svg viewBox="0 0 40 52" width="40" height="52"><path d="M20 51C20 51 4 32 4 19a16 16 0 0 1 32 0c0 13-16 32-16 32z" fill="#ff7a1a" stroke="#fff" stroke-width="3"/><circle cx="20" cy="19" r="6" fill="#fff"/></svg>';
  const m = new maplibregl.Marker({ element: el, anchor: 'bottom', draggable: true }).setLngLat(lngLat).addTo(map);
  m.on('drag', () => onMove(m.getLngLat(), false));
  m.on('dragend', () => onMove(m.getLngLat(), true));
  return m;
}

export { maplibregl };
