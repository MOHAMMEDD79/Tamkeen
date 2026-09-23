/**
 * Distinct cover art for listings that have no photo of their own.
 *
 * The site falls back to a small set of stock photos, so eight charity projects share two images
 * and most jobs land on the same one. These covers are generated instead: the hue is stepped by
 * the golden angle from the listing's position, so no two are near each other on the wheel, and
 * the motif is chosen from the listing's own key. Nothing is a photograph, which is deliberate —
 * an invented project should not carry a real picture of a real place.
 *
 * PNG is written by hand (zlib is in Node), because site media refuses SVG and the workspace has
 * no image library of its own.
 */

import { Buffer } from 'node:buffer';
import { deflateSync } from 'node:zlib';

const CRC = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = -1;
  for (const byte of buffer) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** 8-bit truecolour PNG from a width*height*3 RGB buffer. */
function encodePng(width, height, rgb) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/** Deterministic: the same key always produces the same cover. */
function hashOf(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i += 1) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));


/** Small deterministic PRNG, so a key always lays its shapes out the same way. */
function mulberry32(a) {
  return function next() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * One cover.
 *
 * Poster geometry rather than soft haze: a two-tone ground, then two or three large shapes with
 * hard edges, drawn from one analogous palette so the blend never turns to mud. `index` steps the
 * hue by the golden angle, `key` decides the shapes and where they sit, and `tone` shifts the whole
 * family so charity, work and investment cards do not read as one wall of colour.
 */
export function makeCover({ key, index, tone = 'charity', width = 1200, height = 675 }) {
  const seed = hashOf(key);
  const rand = mulberry32(seed);
  const base = tone === 'work' ? 150 : tone === 'invest' ? 250 : 8;
  const hue = (base + index * 137.508) % 360;

  // One family, walked in one direction: deep ground, two mid tones, one bright.
  const ground = hslToRgb(hue, 0.58, 0.14);
  const ground2 = hslToRgb(hue + 12, 0.55, 0.26);
  const palette = [
    hslToRgb(hue + 18, 0.62, 0.38),
    hslToRgb(hue + 34, 0.68, 0.52),
    hslToRgb(hue + 52, 0.78, 0.64),
    hslToRgb(hue - 16, 0.55, 0.30)
  ];

  // Two or three shapes, kept apart so they overlap without covering each other.
  const kinds = ['circle', 'semi', 'quarter', 'ring', 'triangle'];
  const count = 2 + (seed % 2);
  // Colours are dealt without replacement, so no cover repeats one fill twice.
  const deck = palette.map((colour, i) => ({ colour, order: ((seed >>> (i * 4)) & 0xff) }))
    .sort((a, b) => a.order - b.order).map(entry => entry.colour);
  const shapes = [];
  for (let i = 0; i < count; i += 1) {
    shapes.push({
      kind: kinds[(seed >>> (i * 3)) % kinds.length],
      cx: width * (0.18 + rand() * 0.66),
      cy: height * (0.18 + rand() * 0.64),
      r: height * (0.28 + rand() * 0.34),
      rotation: rand() * Math.PI * 2,
      colour: deck[i % deck.length],
      alpha: 0.80 + rand() * 0.18
    });
  }

  const rgb = Buffer.alloc(width * height * 3);
  const edge = 1.6; // anti-aliasing width, in pixels

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      // Ground: diagonal two-tone, lit slightly from the top corner.
      const t = smooth((x / width) * 0.35 + (y / height) * 0.65);
      let r = ground[0] + (ground2[0] - ground[0]) * t;
      let g = ground[1] + (ground2[1] - ground[1]) * t;
      let b = ground[2] + (ground2[2] - ground[2]) * t;

      for (const shape of shapes) {
        const dx = x - shape.cx, dy = y - shape.cy;
        const rx = dx * Math.cos(shape.rotation) - dy * Math.sin(shape.rotation);
        const ry = dx * Math.sin(shape.rotation) + dy * Math.cos(shape.rotation);
        const dist = Math.sqrt(dx * dx + dy * dy);
        let inside;

        if (shape.kind === 'circle') {
          inside = 1 - smooth((dist - shape.r) / edge + 0.5);
        } else if (shape.kind === 'semi') {
          inside = (1 - smooth((dist - shape.r) / edge + 0.5)) * (1 - smooth(-ry / edge + 0.5));
        } else if (shape.kind === 'quarter') {
          inside = (1 - smooth((dist - shape.r) / edge + 0.5)) * (1 - smooth(-ry / edge + 0.5)) * (1 - smooth(-rx / edge + 0.5));
        } else if (shape.kind === 'ring') {
          const band = shape.r * 0.22;
          inside = (1 - smooth((dist - shape.r) / edge + 0.5)) * smooth((dist - (shape.r - band)) / edge + 0.5);
        } else {
          // Triangle: three half-planes, pointing up before rotation.
          const h = shape.r * 1.5, half = shape.r * 0.95;
          const a1 = (ry + h / 2) / edge + 0.5;
          const a2 = (half * (1 - (ry + h / 2) / h) - rx) / edge + 0.5;
          const a3 = (half * (1 - (ry + h / 2) / h) + rx) / edge + 0.5;
          inside = smooth(a1) * smooth(a2) * smooth(a3) * (1 - smooth((ry - h / 2) / edge + 0.5));
        }

        const a = inside * shape.alpha;
        if (a > 0) {
          r += (shape.colour[0] - r) * a;
          g += (shape.colour[1] - g) * a;
          b += (shape.colour[2] - b) * a;
        }
      }

      // Corner light, a gentle vignette, and a touch of grain against banding.
      const light = 1 + 0.10 * (1 - (x / width) * 0.5 - (y / height) * 0.5);
      const vx = x / width - 0.5, vy = y / height - 0.5;
      const vignette = 1 - (vx * vx + vy * vy) * 0.42;
      const grain = (((x * 7 + y * 13 + seed) % 9) - 4) * 0.5;
      const o = (y * width + x) * 3;
      rgb[o] = clamp(r * light * vignette + grain);
      rgb[o + 1] = clamp(g * light * vignette + grain);
      rgb[o + 2] = clamp(b * light * vignette + grain);
    }
  }
  return encodePng(width, height, rgb);
}
