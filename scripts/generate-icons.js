const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

function makeChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function rgb(hex) {
  const clean = hex.replace('#', '');
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16)
  };
}

function createCanvas(size, color) {
  const data = Buffer.alloc(size * size * 3);
  for (let i = 0; i < data.length; i += 3) {
    data[i] = color.r;
    data[i + 1] = color.g;
    data[i + 2] = color.b;
  }
  return data;
}

function setPixel(data, size, x, y, color) {
  if (x < 0 || x >= size || y < 0 || y >= size) return;
  const offset = (Math.floor(y) * size + Math.floor(x)) * 3;
  data[offset] = color.r;
  data[offset + 1] = color.g;
  data[offset + 2] = color.b;
}

function drawCircle(data, size, cx, cy, radius, color) {
  const r2 = radius * radius;
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) {
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) setPixel(data, size, x, y, color);
    }
  }
}

function drawRoundedRect(data, size, x, y, w, h, radius, color) {
  for (let py = y; py < y + h; py++) {
    for (let px = x; px < x + w; px++) {
      const left = px < x + radius;
      const right = px >= x + w - radius;
      const top = py < y + radius;
      const bottom = py >= y + h - radius;
      let inside = true;

      if (left && top) inside = (px - (x + radius)) ** 2 + (py - (y + radius)) ** 2 <= radius ** 2;
      if (right && top) inside = (px - (x + w - radius - 1)) ** 2 + (py - (y + radius)) ** 2 <= radius ** 2;
      if (left && bottom) inside = (px - (x + radius)) ** 2 + (py - (y + h - radius - 1)) ** 2 <= radius ** 2;
      if (right && bottom) inside = (px - (x + w - radius - 1)) ** 2 + (py - (y + h - radius - 1)) ** 2 <= radius ** 2;

      if (inside) setPixel(data, size, px, py, color);
    }
  }
}

function drawRing(data, size, cx, cy, outerRadius, innerRadius, color) {
  const outer = outerRadius * outerRadius;
  const inner = innerRadius * innerRadius;
  for (let y = Math.floor(cy - outerRadius); y <= Math.ceil(cy + outerRadius); y++) {
    for (let x = Math.floor(cx - outerRadius); x <= Math.ceil(cx + outerRadius); x++) {
      const d = (x - cx) ** 2 + (y - cy) ** 2;
      if (d <= outer && d >= inner) setPixel(data, size, x, y, color);
    }
  }
}

function createBabyIcon(size, outputPath) {
  const purple = rgb('#7F77DD');
  const lavender = rgb('#EEEDFE');
  const face = rgb('#FFE1C2');
  const cheek = rgb('#F7A7A7');
  const ink = rgb('#2E2B45');
  const white = rgb('#FFFFFF');
  const pacifier = rgb('#6EC6C4');
  const hair = rgb('#6B4B3E');

  const data = createCanvas(size, purple);
  const s = size / 512;

  drawCircle(data, size, 256 * s, 256 * s, 214 * s, lavender);
  drawCircle(data, size, 148 * s, 266 * s, 45 * s, face);
  drawCircle(data, size, 364 * s, 266 * s, 45 * s, face);
  drawCircle(data, size, 256 * s, 265 * s, 150 * s, face);

  drawRing(data, size, 252 * s, 156 * s, 38 * s, 22 * s, hair);
  drawCircle(data, size, 228 * s, 177 * s, 18 * s, hair);

  drawCircle(data, size, 205 * s, 252 * s, 14 * s, ink);
  drawCircle(data, size, 307 * s, 252 * s, 14 * s, ink);
  drawCircle(data, size, 200 * s, 246 * s, 4 * s, white);
  drawCircle(data, size, 302 * s, 246 * s, 4 * s, white);

  drawCircle(data, size, 177 * s, 305 * s, 20 * s, cheek);
  drawCircle(data, size, 335 * s, 305 * s, 20 * s, cheek);

  drawCircle(data, size, 256 * s, 316 * s, 34 * s, pacifier);
  drawCircle(data, size, 256 * s, 316 * s, 15 * s, white);
  drawRoundedRect(data, size, 211 * s, 332 * s, 90 * s, 28 * s, 14 * s, pacifier);

  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData.writeUInt8(8, 8);
  ihdrData.writeUInt8(2, 9);
  ihdrData.writeUInt8(0, 10);
  ihdrData.writeUInt8(0, 11);
  ihdrData.writeUInt8(0, 12);

  const rowSize = size * 3 + 1;
  const rawData = Buffer.alloc(rowSize * size);
  for (let y = 0; y < size; y++) {
    const rowOffset = y * rowSize;
    rawData[rowOffset] = 0;
    data.copy(rawData, rowOffset + 1, y * size * 3, (y + 1) * size * 3);
  }

  const png = Buffer.concat([
    signature,
    makeChunk('IHDR', ihdrData),
    makeChunk('IDAT', zlib.deflateSync(rawData)),
    makeChunk('IEND', Buffer.alloc(0))
  ]);

  fs.writeFileSync(outputPath, png);
  console.log(`Created baby icon ${size}x${size}: ${outputPath}`);
}

const publicDir = path.join(__dirname, '..', 'public');

createBabyIcon(180, path.join(publicDir, 'icon-180.png'));
createBabyIcon(192, path.join(publicDir, 'icon-192.png'));
createBabyIcon(512, path.join(publicDir, 'icon-512.png'));

console.log('Baby Johnson PWA icons generated.');
