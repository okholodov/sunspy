// AR view: rear camera with the sun & moon paths drawn where they are in the sky.
// Orientation comes from DeviceOrientation (iOS: webkitCompassHeading gives the absolute heading).
import { t, cardinal } from './i18n.js';
import { COLORS } from './mapview.js';

const rad = Math.PI / 180;
let prefs = { fov: 66, cal: 0 };
try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem('sunspy.ar') || '{}') }; } catch { /* ignore */ }
const savePrefs = () => { try { localStorage.setItem('sunspy.ar', JSON.stringify(prefs)); } catch { /* ignore */ } };

export class ARView {
  constructor(root, getScene) {
    this.root = root;
    this.getScene = getScene; // () => { sunPath, moonPath, sun, moon, horizon(az)|null, tz, labelOf(t) }
    this.video = root.querySelector('video');
    this.canvas = root.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.info = root.querySelector('.ar-heading');
    this.R = null;
    this.running = false;
    this.onOrient = this.onOrient.bind(this);
    this.loop = this.loop.bind(this);

    const fov = root.querySelector('#ar-fov');
    fov.value = prefs.fov;
    fov.addEventListener('input', () => { prefs.fov = +fov.value; savePrefs(); });
    root.querySelector('#ar-close').addEventListener('click', () => this.close());
    root.querySelector('#ar-reset').addEventListener('click', () => { prefs.cal = 0; savePrefs(); });

    // Drag horizontally to fine-tune the compass.
    let sx = null, sc = 0;
    this.canvas.addEventListener('pointerdown', (e) => { sx = e.clientX; sc = prefs.cal; });
    this.canvas.addEventListener('pointermove', (e) => {
      if (sx == null) return;
      const f = this.focal();
      prefs.cal = sc - Math.atan((e.clientX - sx) / f) / rad;
    });
    const up = () => { if (sx != null) savePrefs(); sx = null; };
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', up);
  }

  async open() {
    // Both permission prompts must start from the same tap on iOS.
    const DOE = window.DeviceOrientationEvent;
    const orientP = DOE && typeof DOE.requestPermission === 'function' ? DOE.requestPermission().catch(() => 'denied') : Promise.resolve('granted');
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    } catch (e) {
      throw new Error(t('arNoCam'));
    }
    if ((await orientP) !== 'granted') { stream.getTracks().forEach((tr) => tr.stop()); throw new Error(t('arNeed')); }
    this.stream = stream;
    this.video.srcObject = stream;
    await this.video.play().catch(() => {});
    this.root.hidden = false;
    this.running = true;
    window.addEventListener('deviceorientationabsolute', this.onOrient);
    window.addEventListener('deviceorientation', this.onOrient);
    requestAnimationFrame(this.loop);
  }

  close() {
    this.running = false;
    this.root.hidden = true;
    window.removeEventListener('deviceorientationabsolute', this.onOrient);
    window.removeEventListener('deviceorientation', this.onOrient);
    this.stream?.getTracks().forEach((tr) => tr.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.R = null;
  }

  onOrient(e) {
    if (e.alpha == null) return;
    let alpha;
    if (typeof e.webkitCompassHeading === 'number' && e.webkitCompassHeading >= 0) alpha = 360 - e.webkitCompassHeading;
    else if (e.absolute || e.type === 'deviceorientationabsolute') alpha = e.alpha;
    else return; // relative-only orientation: no use for pointing at the sky
    if (e.type === 'deviceorientation' && this.gotAbsolute && typeof e.webkitCompassHeading !== 'number') return;
    if (e.type === 'deviceorientationabsolute') this.gotAbsolute = true;
    const a = alpha * rad, b = e.beta * rad, g = e.gamma * rad;
    const cA = Math.cos(a), sA = Math.sin(a), cB = Math.cos(b), sB = Math.sin(b), cG = Math.cos(g), sG = Math.sin(g);
    // device → earth (x east, y north, z up), W3C Z-X'-Y'' convention
    const R = [
      cA * cG - sA * sB * sG, -cB * sA, cG * sA * sB + cA * sG,
      cG * sA + cA * sB * sG, cA * cB, sA * sG - cA * cG * sB,
      -cB * sG, sB, cB * cG,
    ];
    if (!this.R) this.R = R;
    else {
      // light smoothing; re-orthogonalising isn't needed for drawing
      const k = 0.35;
      for (let i = 0; i < 9; i++) this.R[i] += (R[i] - this.R[i]) * k;
    }
  }

  focal() {
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    const vw = this.video.videoWidth || 3, vh = this.video.videoHeight || 4;
    const s = Math.max(W / vw, H / vh); // object-fit: cover
    const longPx = Math.max(vw, vh) * s;
    return longPx / 2 / Math.tan((prefs.fov * rad) / 2);
  }

  /** world direction (az, alt deg) → screen [x,y] or null if behind the camera */
  project(az, alt) {
    const R = this.R;
    if (!R) return null;
    const A = (az + prefs.cal) * rad, h = alt * rad;
    const v = [Math.sin(A) * Math.cos(h), Math.cos(A) * Math.cos(h), Math.sin(h)];
    // device = Rᵀ · world
    const dx = R[0] * v[0] + R[3] * v[1] + R[6] * v[2];
    const dy = R[1] * v[0] + R[4] * v[1] + R[7] * v[2];
    const dz = R[2] * v[0] + R[5] * v[1] + R[8] * v[2];
    const ang = ((screen.orientation?.angle ?? window.orientation ?? 0) * rad);
    const sx = dx * Math.cos(ang) - dy * Math.sin(ang);
    const sy = dx * Math.sin(ang) + dy * Math.cos(ang);
    const fwd = -dz;
    if (fwd < 0.05) return null;
    const f = this.focal();
    return [this.canvas.clientWidth / 2 + (f * sx) / fwd, this.canvas.clientHeight / 2 - (f * sy) / fwd];
  }

  heading() {
    const R = this.R;
    if (!R) return null;
    // camera looks along -z of the device
    const fx = -R[2], fy = -R[5];
    if (Math.hypot(fx, fy) < 0.2) return null;
    return ((Math.atan2(fx, fy) / rad - prefs.cal) % 360 + 360) % 360;
  }

  loop() {
    if (!this.running) return;
    requestAnimationFrame(this.loop);
    const c = this.canvas, ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth, H = c.clientHeight;
    if (c.width !== Math.round(W * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const hd = this.heading();
    this.info.textContent = hd == null ? '…' : `${t('heading')} ${Math.round(hd)}° ${cardinal(hd)}${Math.abs(prefs.cal) > 0.5 ? `  ·  ${t('arCal')} ${prefs.cal > 0 ? '+' : ''}${prefs.cal.toFixed(1)}°` : ''}`;
    if (!this.R) return;
    const sc = this.getScene();

    const polyline = (pts, style, width, dash) => {
      ctx.strokeStyle = style; ctx.lineWidth = width; ctx.setLineDash(dash || []);
      ctx.beginPath();
      let pen = false;
      for (const p of pts) {
        if (!p) { pen = false; continue; }
        if (pen) ctx.lineTo(p[0], p[1]); else { ctx.moveTo(p[0], p[1]); pen = true; }
      }
      ctx.stroke();
      ctx.setLineDash([]);
    };
    const dense = (fn) => { const out = []; for (let a = 0; a <= 360; a += 2) out.push(this.project(a, fn(a))); return out; };

    // astronomical horizon and compass ticks
    polyline(dense(() => 0), 'rgba(255,255,255,.55)', 1.5);
    if (sc.horizon) {
      const ridge = dense(sc.horizon);
      polyline(ridge, 'rgba(120,255,170,.9)', 2);
    }
    ctx.font = '600 13px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (let a = 0; a < 360; a += 15) {
      const p = this.project(a, 0), q = this.project(a, a % 45 === 0 ? 2.2 : 1);
      if (!p || !q) continue;
      ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
      if (a % 45 === 0) {
        const lp = this.project(a, -3);
        if (lp) { ctx.fillStyle = a === 0 ? '#ff6b6b' : '#fff'; ctx.fillText(cardinal(a), lp[0], lp[1]); }
      }
    }

    // moon path
    if (sc.moonPath) polyline(sc.moonPath.map((p) => (p.alt > -2 ? this.project(p.az, p.alt) : null)), 'rgba(185,205,255,.7)', 2, [6, 6]);

    // sun path: golden part orange, daylight part yellow
    const segs = sc.sunPath.map((p) => ({ p: p.app > -2 ? this.project(p.az, p.app) : null, golden: p.alt < 6, hour: p.hour, t: p.t }));
    for (let i = 0; i < segs.length - 1; i++) {
      const a = segs[i], b = segs[i + 1];
      if (!a.p || !b.p) continue;
      ctx.strokeStyle = a.golden ? COLORS.golden : COLORS.day;
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(a.p[0], a.p[1]); ctx.lineTo(b.p[0], b.p[1]); ctx.stroke();
    }
    ctx.font = '600 12px -apple-system, system-ui, sans-serif';
    for (const s of segs) {
      if (s.hour == null || !s.p) continue;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(s.p[0], s.p[1], 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.fillText(String(s.hour), s.p[0] + 1, s.p[1] - 9);
      ctx.fillStyle = '#fff';
      ctx.fillText(String(s.hour), s.p[0], s.p[1] - 10);
    }

    // moon & sun at the selected time
    if (sc.moon) {
      const m = this.project(sc.moon.az, sc.moon.app);
      if (m) { ctx.fillStyle = '#e9efff'; ctx.beginPath(); ctx.arc(m[0], m[1], 10, 0, Math.PI * 2); ctx.fill(); }
    }
    const s = this.project(sc.sun.az, sc.sun.app);
    if (s) {
      const g = ctx.createRadialGradient(s[0], s[1], 4, s[0], s[1], 40);
      g.addColorStop(0, 'rgba(255,240,170,1)'); g.addColorStop(0.35, 'rgba(255,210,63,.85)'); g.addColorStop(1, 'rgba(255,170,30,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(s[0], s[1], 40, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#1d1a2b'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(s[0], s[1], 13, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = '700 13px -apple-system, system-ui, sans-serif';
      ctx.fillText(sc.label, s[0], s[1] + 34);
    } else {
      // off-screen: arrow at the edge pointing toward the sun
      const hdg = this.heading();
      if (hdg != null) {
        const d = ((sc.sun.az - hdg + 540) % 360) - 180;
        ctx.fillStyle = '#ffd23f'; ctx.font = '700 15px -apple-system, system-ui, sans-serif';
        ctx.textAlign = d < 0 ? 'left' : 'right';
        ctx.fillText(d < 0 ? `◀ ${t('legend').sun} ${Math.round(-d)}°` : `${t('legend').sun} ${Math.round(d)}° ▶`, d < 0 ? 16 : W - 16, H / 2);
        ctx.textAlign = 'center';
      }
    }
  }
}

export const arPrefs = prefs;
