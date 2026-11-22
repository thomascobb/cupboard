#!/usr/bin/env node
// Draws the app icon (a white two-door cupboard on iOS blue) into public/ as PNG and SVG.
// No dependencies: shapes are rasterised with 4×4 supersampling and written with zlib.
//   npm run icons
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const BLUE = [0x00, 0x7a, 0xff];
const WHITE = [0xff, 0xff, 0xff];

// Shapes in unit coordinates, painted in order: [x0, y0, x1, y1, radius, colour].
const cupboard = [
  [0.27, 0.2, 0.73, 0.8, 0.05, WHITE],   // body
  [0.493, 0.25, 0.507, 0.75, 0, BLUE],   // gap between the doors
  [0.425, 0.43, 0.46, 0.57, 0.0175, BLUE], // left handle
  [0.54, 0.43, 0.575, 0.57, 0.0175, BLUE], // right handle
  [0.3, 0.8, 0.36, 0.84, 0.015, WHITE],  // feet
  [0.64, 0.8, 0.7, 0.84, 0.015, WHITE],
];

function inRoundRect(x, y, [x0, y0, x1, y1, r]) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

/** RGBA pixels. `corner` rounds the background (0 = full bleed square). */
function draw(size, corner) {
  const px = Buffer.alloc(size * size * 4);
  const ss = 4;
  const bg = [0, 0, 1, 1, corner, BLUE];
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sj = 0; sj < ss; sj++) {
        for (let si = 0; si < ss; si++) {
          const x = (i + (si + 0.5) / ss) / size;
          const y = (j + (sj + 0.5) / ss) / size;
          if (!inRoundRect(x, y, bg)) continue;
          let c = BLUE;
          for (const s of cupboard) if (inRoundRect(x, y, s)) c = s[5];
          r += c[0]; g += c[1]; b += c[2]; a += 255;
        }
      }
      const n = ss * ss;
      const o = (j * size + i) * 4;
      const cov = a / 255;
      px[o] = cov ? Math.round(r / cov) : 0;
      px[o + 1] = cov ? Math.round(g / cov) : 0;
      px[o + 2] = cov ? Math.round(b / cov) : 0;
      px[o + 3] = Math.round(a / n);
    }
  }
  return px;
}

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba, opaque) {
  const ch = opaque ? 3 : 4;
  const raw = Buffer.alloc(size * (size * ch + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * ch + 1)] = 0;
    for (let x = 0; x < size; x++) {
      for (let k = 0; k < ch; k++) raw[y * (size * ch + 1) + 1 + x * ch + k] = rgba[(y * size + x) * 4 + k];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = opaque ? 2 : 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = new URL('../public/', import.meta.url);
mkdirSync(out, { recursive: true });
const write = (name, size, corner, opaque = false) =>
  writeFileSync(new URL(name, out), png(size, draw(size, corner), opaque));

write('icon-192.png', 192, 0.22);
write('icon-512.png', 512, 0.22);
write('icon-maskable-512.png', 512, 0, true); // full bleed; content sits inside the safe zone
write('apple-touch-icon.png', 180, 0, true);  // iOS rounds the corners itself and dislikes transparency

const hex = (c) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
const rect = ([x0, y0, x1, y1, r, c]) =>
  `<rect x="${x0 * 100}" y="${y0 * 100}" width="${((x1 - x0) * 100).toFixed(1)}" height="${((y1 - y0) * 100).toFixed(1)}" rx="${(r * 100).toFixed(2)}" fill="${hex(c)}"/>`;
writeFileSync(
  new URL('icon.svg', out),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${rect([0, 0, 1, 1, 0.22, BLUE])}${cupboard.map(rect).join('')}</svg>\n`,
);
console.log('Wrote icons to public/');
