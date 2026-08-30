// Generate minimal PNG icons from SVG-converted raster data using node's built-in zlib
// Creates a teal gradient square with rounded corners + bus silhouette
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../public/icons');

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = (crc >>> 8) ^ table[(crc ^ b) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function makeIcon(size) {
  const w = size, h = size;
  const radius = Math.floor(size * 0.22);
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = [0]; // filter byte
    for (let x = 0; x < w; x++) {
      // bg gradient teal
      const t = (x + y) / (w + h);
      const r = Math.round(20 * (1 - t) + 15 * t);
      const g = Math.round(184 * (1 - t) + 118 * t);
      const b = Math.round(166 * (1 - t) + 110 * t);

      // rounded corner mask
      const inCorner = (cx, cy) => {
        const dx = Math.max(0, Math.abs(x - cx) - (w - radius));
        const dy = Math.max(0, Math.abs(y - cy) - (h - radius));
        return dx * dx + dy * dy > radius * radius;
      };
      const mask =
        !inCorner(radius, radius) &&
        !inCorner(w - radius, radius) &&
        !inCorner(radius, h - radius) &&
        !inCorner(w - radius, h - radius);

      let R = r, G = g, B = b, A = 255;
      if (!mask) { A = 0; }

      // bus body
      const bx0 = w * 0.22, bx1 = w * 0.74, by0 = h * 0.28, by1 = h * 0.66;
      const wheelR = size * 0.055;
      const wheelCY = h * 0.72;
      const inBody = x >= bx0 && x <= bx1 && y >= by0 && y <= by1;
      const inWheelL = Math.hypot(x - w * 0.31, y - wheelCY) < wheelR;
      const inWheelR = Math.hypot(x - w * 0.66, y - wheelCY) < wheelR;
      const inWindow =
        (x >= w * 0.29 && x <= w * 0.45 && y >= h * 0.32 && y <= h * 0.45) ||
        (x >= w * 0.51 && x <= w * 0.67 && y >= h * 0.32 && y <= h * 0.45);
      const inMidStripe = y >= h * 0.5 && y <= h * 0.51 && inBody;
      if (inBody || inWheelL || inWheelR) {
        R = 255; G = 255; B = 255;
      }
      if (inWindow) {
        R = 204; G = 251; B = 241;
      }
      if (inMidStripe) {
        R = 255; G = 255; B = 255;
      }
      // pin dot accent (top-right)
      const pinR = size * 0.07;
      if (Math.hypot(x - w * 0.75, y - h * 0.30) < pinR) {
        R = 251; G = 146; B = 60;
      }

      row.push(R, G, B, A);
    }
    rows.push(Buffer.from(row));
  }
  const raw = Buffer.concat(rows);
  const compressed = zlib.deflateSync(raw);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
writeFileSync(resolve(OUT, 'icon-192.png'), makeIcon(192));
writeFileSync(resolve(OUT, 'icon-512.png'), makeIcon(512));
writeFileSync(resolve(OUT, 'apple-touch-icon.png'), makeIcon(180));
console.log('Icons generated in', OUT);