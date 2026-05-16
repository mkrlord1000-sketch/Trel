/**
 * Генератор иконки для лаунчера (build/icon.ico + build/icon.png).
 *
 * Без внешних зависимостей: PNG-кодер и ICO-сборка реализованы вручную через
 * node:zlib (deflate IDAT) и node:buffer (CRC32, заголовки).
 *
 * Дизайн: скруглённый квадрат с диагональным градиентом (фиолет → циан) и
 * белой стилизованной "T" по центру. Анти-алиасинг — только на скруглённых
 * углах (внутри T рисуется по точным пиксельным границам).
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

// ---------- CRC32 (для PNG-чанков) ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)) >>> 0;
  }
  return (c ^ 0xffffffff) >>> 0;
}

// ---------- PNG ----------
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(rgba, w, h) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.writeUInt8(8, 8);    // bit depth
  ihdr.writeUInt8(6, 9);    // colour type 6 = RGBA
  ihdr.writeUInt8(0, 10);   // compression
  ihdr.writeUInt8(0, 11);   // filter
  ihdr.writeUInt8(0, 12);   // interlace

  const stride = w * 4;
  const raw = Buffer.alloc(h * (1 + stride));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + stride)] = 0; // filter type 0 (None)
    rgba.copy(raw, y * (1 + stride) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- Drawing ----------
const PURPLE = [124, 58, 237];   // #7c3aed
const CYAN   = [  6, 182, 212];  // #06b6d4

function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function drawIcon(size) {
  const buf = Buffer.alloc(size * size * 4);
  const radius = size * 0.172; // 44px @ 256

  // Пропорции монограммы
  const tWidth   = size * 0.58;
  const tBarH    = size * 0.16;
  const tStrokeW = size * 0.16;
  const tHeight  = size * 0.58;

  const cxC = size / 2;
  const cyC = size / 2;
  const tBarTop    = cyC - tHeight / 2;
  const tBarBottom = tBarTop + tBarH;
  const tBottom    = cyC + tHeight / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;

      // SDF скруглённого квадрата
      const cx = Math.min(Math.max(x + 0.5, radius), size - radius);
      const cy = Math.min(Math.max(y + 0.5, radius), size - radius);
      const dx = (x + 0.5) - cx;
      const dy = (y + 0.5) - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const sdf = dist - radius;

      if (sdf > 1) {
        buf[i] = 0; buf[i + 1] = 0; buf[i + 2] = 0; buf[i + 3] = 0;
        continue;
      }

      // AA на границе скруглённого края
      const alpha = Math.round(255 * (1 - smoothstep(-1, 1, sdf)));

      // Диагональный градиент: top-left → bottom-right
      const t = (x + y) / (2 * (size - 1));
      let r = Math.round(PURPLE[0] + (CYAN[0] - PURPLE[0]) * t);
      let g = Math.round(PURPLE[1] + (CYAN[1] - PURPLE[1]) * t);
      let b = Math.round(PURPLE[2] + (CYAN[2] - PURPLE[2]) * t);

      // Белая монограмма "T"
      const px = x + 0.5, py = y + 0.5;
      const inBar    = px >= cxC - tWidth   / 2 && px < cxC + tWidth   / 2 &&
                       py >= tBarTop          && py < tBarBottom;
      const inStroke = px >= cxC - tStrokeW / 2 && px < cxC + tStrokeW / 2 &&
                       py >= tBarBottom       && py < tBottom;

      if (inBar || inStroke) {
        r = 255; g = 255; b = 255;
      }

      buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = alpha;
    }
  }
  return buf;
}

// ---------- ICO ----------
function buildIco(images) {
  // ICONDIR
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);                  // reserved
  header.writeUInt16LE(1, 2);                  // type 1 = icon
  header.writeUInt16LE(images.length, 4);

  const entries = [];
  let offset = 6 + images.length * 16;
  for (const img of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(img.size === 256 ? 0 : img.size, 0);  // width  (0 = 256)
    e.writeUInt8(img.size === 256 ? 0 : img.size, 1);  // height (0 = 256)
    e.writeUInt8(0, 2);                                 // palette
    e.writeUInt8(0, 3);                                 // reserved
    e.writeUInt16LE(1, 4);                              // colour planes
    e.writeUInt16LE(32, 6);                             // bits per pixel
    e.writeUInt32LE(img.png.length, 8);                 // image size
    e.writeUInt32LE(offset, 12);                        // image offset
    entries.push(e);
    offset += img.png.length;
  }

  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

// ---------- Main ----------
const sizes = [16, 24, 32, 48, 64, 128, 256];
const buildDir = path.resolve(__dirname, '..', 'build');
fs.mkdirSync(buildDir, { recursive: true });

const images = sizes.map((size) => {
  const rgba = drawIcon(size);
  const png = encodePNG(rgba, size, size);
  return { size, png };
});

const png256 = images.find((i) => i.size === 256).png;
fs.writeFileSync(path.join(buildDir, 'icon.png'), png256);

const ico = buildIco(images);
fs.writeFileSync(path.join(buildDir, 'icon.ico'), ico);

console.log(
  `Wrote build/icon.ico (${ico.length} bytes), build/icon.png (${png256.length} bytes), ` +
  `${images.length} sizes embedded`,
);
