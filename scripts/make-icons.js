// Renders the app icon to PNG with no dependencies (supersampled, zlib-compressed).
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};

function png(size, shade) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  const SS = 4;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const [cr, cg, cb] = shade((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size);
        r += cr; g += cg; b += cb;
      }
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = r / SS / SS; raw[o + 1] = g / SS / SS; raw[o + 2] = b / SS / SS;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

function shade(u, v) {
  // dusk sky gradient
  let c = mix([38, 30, 78], [255, 140, 60], Math.max(0, (v - 0.15) / 0.55) ** 1.6);
  // sun path arc (dashed feel is not needed at icon size)
  const ax = u - 0.5, ay = (v - 0.66) / 0.78;
  const rr = Math.hypot(ax, ay);
  if (v < 0.66 && Math.abs(rr - 0.34) < 0.016) c = mix(c, [255, 236, 170], 0.85);
  // sun
  const d = Math.hypot(u - 0.73, v - 0.42);
  if (d < 0.2) c = mix(c, [255, 200, 90], 0.35 * (1 - d / 0.2));
  if (d < 0.105) c = [255, 214, 74];
  if (d < 0.08) c = [255, 236, 150];
  // ground
  if (v > 0.66) c = mix([28, 22, 48], [18, 14, 32], (v - 0.66) / 0.34);
  // shadow streak on the ground
  if (v > 0.68 && v < 0.74 && u > 0.18 && u < 0.5 - (v - 0.68) * 0.6) c = [52, 42, 88];
  // pin
  const pd = Math.hypot(u - 0.5, v - 0.6);
  if (pd < 0.05) c = [255, 255, 255];
  if (pd < 0.032) c = [255, 122, 26];
  return c;
}

mkdirSync('public/icons', { recursive: true });
writeFileSync('public/icons/icon-192.png', png(192, shade));
writeFileSync('public/icons/icon-512.png', png(512, shade));
writeFileSync('public/icons/apple-touch-icon.png', png(180, shade));
console.log('icons written');
