// Generates the extension icons (public/icons/icon-{16,32,48,128}.png)
// with no dependencies: pixels are rasterised here and encoded as PNG by hand.
// Run with: npm run icons
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// Sample the artwork in unit space (0..1); returns [r,g,b,a] or null.
function sample(u, v) {
  // rounded square mask
  const r = 0.2;
  const dx = Math.max(Math.abs(u - 0.5) - (0.5 - r), 0);
  const dy = Math.max(Math.abs(v - 0.5) - (0.5 - r), 0);
  if (dx * dx + dy * dy > r * r) return null;
  // night sky gradient
  let c = mix([12, 16, 44], [70, 52, 110], v);
  // stars
  for (const [sx, sy] of [[0.22, 0.2], [0.4, 0.12], [0.16, 0.42], [0.56, 0.3], [0.3, 0.33]]) {
    if (Math.hypot(u - sx, v - sy) < 0.022) c = [230, 236, 255];
  }
  // crescent moon
  const m1 = Math.hypot(u - 0.7, v - 0.3) < 0.16;
  const m2 = Math.hypot(u - 0.76, v - 0.25) < 0.14;
  if (m1 && !m2) c = [246, 226, 170];
  // far ridge
  const ridge = 0.66 + 0.05 * Math.sin(u * 9) + 0.03 * Math.sin(u * 23);
  if (v > ridge) c = [40, 34, 78];
  // near hill with glowing window
  const hill = 0.8 + 0.06 * Math.cos(u * 5 - 1);
  if (v > hill) c = [16, 14, 32];
  if (u > 0.3 && u < 0.38 && v > 0.74 && v < 0.8) c = [255, 180, 92];
  return [...c, 255];
}

for (const size of [16, 32, 48, 128]) {
  const buf = Buffer.alloc(size * size * 4);
  const ss = 4; // supersampling
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let acc = [0, 0, 0, 0];
      for (let j = 0; j < ss; j++) {
        for (let i = 0; i < ss; i++) {
          const s = sample((x + (i + 0.5) / ss) / size, (y + (j + 0.5) / ss) / size);
          if (s) acc = acc.map((v, k) => v + (k < 3 ? s[k] * (s[3] / 255) : s[3]));
        }
      }
      const n = ss * ss;
      const a = acc[3] / n;
      const o = (y * size + x) * 4;
      buf[o] = a ? Math.round(acc[0] / n / (a / 255)) : 0;
      buf[o + 1] = a ? Math.round(acc[1] / n / (a / 255)) : 0;
      buf[o + 2] = a ? Math.round(acc[2] / n / (a / 255)) : 0;
      buf[o + 3] = Math.round(a);
    }
  }
  writeFileSync(join(outDir, `icon-${size}.png`), png(size, buf));
}
console.log('Icons written to', outDir);
