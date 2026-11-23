// scripts/generate-icons.mjs - Icons generated locally. No external assets, no deps.
// Writes a PNG from a tiny hand-rolled encoder: a 3x3 tile with one ember cell,
// the same mark as the header lockup.

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../public/icons/', import.meta.url));
mkdirSync(ROOT, { recursive: true });

const BG = [10, 12, 16];
const TILE = [18, 22, 32];
const LINE = [43, 50, 64];
const ACCENT = [255, 122, 26];

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/**
 * @param {number} size
 * @param {boolean} maskable
 * @returns {Buffer}
 */
function png(size, maskable) {
  const px = Buffer.alloc(size * size * 4);
  const set = (x, y, [r, g, b]) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = 255;
  };

  // Background.
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) set(x, y, BG);

  // The tile: a rounded square with a 3x3 hairline grid and one ember cell.
  const inset = maskable ? size * 0.22 : size * 0.16;
  const x0 = Math.round(inset);
  const x1 = Math.round(size - inset);
  const radius = Math.round(size * 0.06);
  for (let y = x0; y < x1; y++) {
    for (let x = x0; x < x1; x++) {
      const cx = Math.min(x - x0, x1 - 1 - x);
      const cy = Math.min(y - x0, x1 - 1 - y);
      const inCorner = cx < radius && cy < radius && (radius - cx) ** 2 + (radius - cy) ** 2 > radius ** 2;
      if (inCorner) continue;
      set(x, y, TILE);
    }
  }

  // Grid lines at thirds.
  const span = x1 - x0;
  for (let k = 1; k <= 2; k++) {
    const gx = x0 + Math.round((span * k) / 3);
    const gy = x0 + Math.round((span * k) / 3);
    for (let y = x0; y < x1; y++) set(gx, y, LINE);
    for (let x = x0; x < x1; x++) set(x, gy, LINE);
  }

  // Ember cell: middle-centre of the grid, inset by a couple of pixels.
  const cell = Math.round(span * 0.22);
  const ex = x0 + Math.round(span / 3) + 3;
  const ey = x0 + Math.round(span / 3) + 3;
  for (let y = ey; y < ey + cell; y++) for (let x = ex; x < ex + cell; x++) set(x, y, ACCENT);

  // Border hairline.
  for (let x = x0; x < x1; x++) {
    set(x, x0, LINE);
    set(x, x1 - 1, LINE);
  }
  for (let y = x0; y < x1; y++) {
    set(x0, y, LINE);
    set(x1 - 1, y, LINE);
  }

  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const [name, size, maskable] of [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
]) {
  writeFileSync(join(ROOT, name), png(size, maskable));
  console.log(`wrote ${name}`);
}
