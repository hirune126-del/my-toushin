// アプリアイコン(PNG)を生成する。依存ライブラリなし。 `node scripts/make-icons.mjs`
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "icons");

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(x / size, y / size, 1 / size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// NAVIGATOR の「N」＋上向き矢印。N の文字が画像のちょうど中央に来るよう配置（マスカブル対応で中央 60% に収める）
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * Math.max(0, Math.min(1, t)));
const segDist = (px, py, [ax, ay], [bx, by]) => {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
};
const inPoly = (x, y, P) => {
  let s = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, yi] = P[i], [xj, yj] = P[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) s = !s;
  }
  return s;
};
const L = 0.34, R = 0.66, T = 0.34, B = 0.66; // 線の太さ込みで 0.295〜0.705 → 中心 0.5
const N = [[L, B], [L, T], [R, B], [R, T]];
const ARROW = [[R, T - 0.14], [R + 0.1, T + 0.01], [R - 0.1, T + 0.01]];

function shade(x, y) {
  let c = mix(hex("#0f766e"), hex("#1e3a8a"), (x + y) / 2);
  let d = Infinity;
  for (let i = 0; i < N.length - 1; i++) d = Math.min(d, segDist(x, y, N[i], N[i + 1]));
  if (d < 0.045 || inPoly(x, y, ARROW)) c = hex("#ffffff");
  return c;
}

// 4x4 のスーパーサンプリングで輪郭をなめらかにする
function pixel(x, y, px) {
  const SS = 4;
  let acc = [0, 0, 0];
  for (let i = 0; i < SS; i++)
    for (let j = 0; j < SS; j++) {
      const c = shade(x + ((i + 0.5) / SS) * px, y + ((j + 0.5) / SS) * px);
      acc = acc.map((v, k) => v + c[k]);
    }
  return acc.map((v) => Math.round(v / (SS * SS)));
}

for (const s of [192, 512, 180]) writeFileSync(join(OUT, `icon-${s}.png`), png(s, pixel));
console.log("icons written");
