// Day strip: background coloured by sun phase, sun altitude curve, moon curve, terrain-blocked spans,
// hour ticks, and a draggable cursor.
import { phaseOf } from './astro.js';
import { zoned } from './tz.js';

export const PHASE_COLORS = {
  night: '#0b0f24', astro: '#141c42', nautical: '#22306a', blue: '#2f5fc4', golden: '#f0962e', day: '#7cc4f5',
};

export class Timeline {
  constructor(canvas, onChange) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.onChange = onChange;
    this.data = null;
    this.t = 0;
    const pick = (e) => {
      const r = this.c.getBoundingClientRect();
      const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      if (!this.data) return;
      const { start, end } = this.data;
      let t = start + f * (end - start);
      t = Math.round(t / 60000) * 60000;
      this.onChange(Math.min(end - 60000, t));
    };
    let active = false;
    canvas.addEventListener('pointerdown', (e) => { active = true; canvas.setPointerCapture(e.pointerId); pick(e); });
    canvas.addEventListener('pointermove', (e) => { if (active) pick(e); });
    const stop = () => { active = false; };
    canvas.addEventListener('pointerup', stop);
    canvas.addEventListener('pointercancel', stop);
    new ResizeObserver(() => this.draw()).observe(canvas);
  }

  /** data: { start, end, tz, sun: [{t,alt,app,blocked}], moon: [{t,alt}] } */
  setData(data) { this.data = data; this.draw(); }
  setTime(t) { this.t = t; this.draw(); }

  draw() {
    const { c, ctx, data } = this;
    if (!data) return;
    const dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth, H = c.clientHeight;
    if (!W || !H) return;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const { start, end, sun, moon, tz } = data;
    const span = end - start;
    const x = (t) => ((t - start) / span) * W;
    const top = 4, bandH = H - 18;
    const yAlt = (a) => top + bandH * (1 - (Math.max(-20, Math.min(90, a)) + 20) / 110);
    const horizonY = yAlt(0);

    // phase stripes
    ctx.save();
    const r = 10;
    ctx.beginPath(); ctx.roundRect(0, top, W, bandH, r); ctx.clip();
    for (let i = 0; i < sun.length - 1; i++) {
      const a = sun[i], b = sun[i + 1];
      ctx.fillStyle = PHASE_COLORS[phaseOf(a.alt)];
      ctx.fillRect(Math.floor(x(a.t)), top, Math.ceil(x(b.t) - x(a.t)) + 1, bandH);
    }
    // terrain-blocked spans: hatching
    ctx.fillStyle = 'rgba(20,14,30,.55)';
    for (let i = 0; i < sun.length - 1; i++) {
      if (!sun[i].blocked) continue;
      ctx.fillRect(x(sun[i].t), top, x(sun[i + 1].t) - x(sun[i].t) + 0.5, bandH);
    }
    // horizon
    ctx.fillStyle = 'rgba(0,0,0,.16)';
    ctx.fillRect(0, horizonY, W, top + bandH - horizonY);
    ctx.strokeStyle = 'rgba(255,255,255,.35)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, horizonY + 0.5); ctx.lineTo(W, horizonY + 0.5); ctx.stroke();
    // moon curve
    if (moon?.length) {
      ctx.strokeStyle = 'rgba(200,215,255,.55)';
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      moon.forEach((p, i) => (i ? ctx.lineTo(x(p.t), yAlt(p.alt)) : ctx.moveTo(x(p.t), yAlt(p.alt))));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // sun curve
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    sun.forEach((p, i) => (i ? ctx.lineTo(x(p.t), yAlt(p.alt)) : ctx.moveTo(x(p.t), yAlt(p.alt))));
    ctx.stroke();
    ctx.restore();

    // hour ticks
    ctx.fillStyle = 'rgba(255,255,255,.6)';
    ctx.font = '10px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    let lastH = -1;
    for (let t = start; t < end; t += 15 * 60000) {
      const p = zoned(t, tz);
      if (p.mi !== 0 || p.h === lastH) continue;
      lastH = p.h;
      const xx = x(t);
      ctx.fillRect(xx, top + bandH, 1, p.h % 3 === 0 ? 4 : 2);
      if (p.h % 3 === 0 && p.h !== 0) ctx.fillText(String(p.h), xx, top + bandH + 5);
    }

    // cursor
    const cx = x(this.t);
    const cur = sun.reduce((best, p) => (Math.abs(p.t - this.t) < Math.abs(best.t - this.t) ? p : best), sun[0]);
    ctx.fillStyle = '#fff';
    ctx.fillRect(cx - 1, top - 2, 2, bandH + 4);
    ctx.beginPath();
    ctx.arc(cx, yAlt(this.curAlt ?? cur?.alt ?? 0), 7, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd23f';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#1d1a2b';
    ctx.stroke();
  }
}
