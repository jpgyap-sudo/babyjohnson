const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Minimal PNG generator - creates a solid purple (#7F77DD) square icon
function createPNG(size, outputPath) {
  const width = size;
  const height = size;
  const color = { r: 127, g: 119, b: 221 }; // #7F77DD

  // PNG signature
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

  // Helper: create chunk
  function createChunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crc = require('crypto').createHash('md5').update(Buffer.concat([typeBuf, data])).digest(); // Not proper CRC but works for placeholder
    // Actually, let me use proper CRC32
    return Buffer.concat([length, typeBuf, data]);
  }

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8);  // bit depth
  ihdrData.writeUInt8(2, 9);  // color type: RGB
  ihdrData.writeUInt8(0, 10); // compression
  ihdrData.writeUInt8(0, 11); // filter method
  ihdrData.writeUInt8(0, 12); // interlace

  // Create raw image data
  const rowSize = width * 3 + 1; // 3 bytes per pixel + 1 filter byte
  const rawData = Buffer.alloc(rowSize * height);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    rawData[rowOffset] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const pixelOffset = rowOffset + 1 + x * 3;
      rawData[pixelOffset] = color.r;
      rawData[pixelOffset + 1] = color.g;
      rawData[pixelOffset + 2] = color.b;
    }
  }

  // Compress with zlib
  const compressed = zlib.deflateSync(rawData);

  // Build chunks properly with CRC32
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
    const crcVal = crc32(Buffer.concat([typeBuf, data]));
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crcVal, 0);
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);
    return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
  }

  const ihdrChunk = makeChunk('IHDR', ihdrData);
  const idatChunk = makeChunk('IDAT', compressed);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  const png = Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
  fs.writeFileSync(outputPath, png);
  console.log(`✅ Created ${size}x${size} icon: ${outputPath}`);
}

const publicDir = path.join(__dirname, '..', 'public');

// Create icons
createPNG(192, path.join(publicDir, 'icon-192.png'));
createPNG(512, path.join(publicDir, 'icon-512.png'));

console.log('');
console.log('🎉 PWA icons generated!');
console.log('Note: These are placeholder purple icons. For production, replace them');
console.log('with branded icons using tools like Figma, Canva, or PWABuilder.');