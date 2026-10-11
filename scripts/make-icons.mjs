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

// 上昇する折れ線（マスカブル対応のため中央 60% に収める）
const pts = [[0.24, 0.66], [0.40, 0.52], [0.52, 0.60], [0.76, 0.34]];
const segDist = (px, py, [ax, ay], [bx, by]) => {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
};
const BG = [30, 64, 120], BG2 = [20, 44, 90], FG = [255, 255, 255], ACC = [120, 220, 170];
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

function pixel(x, y, px) {
  let c = mix(BG, BG2, y);
  // 折れ線の下の塗り
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    if (x >= ax && x <= bx) {
      const ly = ay + ((x - ax) / (bx - ax)) * (by - ay);
      if (y > ly && y < 0.74) c = mix(c, ACC, 0.22);
    }
  }
  let d = Infinity;
  for (let i = 0; i < pts.length - 1; i++) d = Math.min(d, segDist(x, y, pts[i], pts[i + 1]));
  const w = 0.03;
  const a = Math.max(0, Math.min(1, (w - d) / px + 0.5));
  c = mix(c, FG, a);
  const dot = Math.hypot(x - pts[3][0], y - pts[3][1]);
  c = mix(c, ACC, Math.max(0, Math.min(1, (0.055 - dot) / px + 0.5)));
  return c;
}

for (const s of [192, 512, 180]) writeFileSync(join(OUT, `icon-${s}.png`), png(s, pixel));
console.log("icons written");
