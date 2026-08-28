// Test helper: generate a small valid PNG "chart screenshot" for the dry run.
// Pure Node (zlib) — no external deps. Produces a 320x200 dark image with a
// simple line pattern, large enough to pass the 1 KB minimum-size check.
const zlib = require("zlib");
const fs = require("fs");

const W = 320, H = 200;

function crc32(buf) {
  let c, table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 2;  // color type RGB
// scanlines: filter byte 0 + RGB
const raw = Buffer.alloc(H * (1 + W * 3));
for (let y = 0; y < H; y++) {
  const row = y * (1 + W * 3);
  raw[row] = 0;
  for (let x = 0; x < W; x++) {
    const i = row + 1 + x * 3;
    raw[i] = 20;   // dark bg
    raw[i + 1] = 24;
    raw[i + 2] = 34;
    // draw a fake "price line"
    if (Math.abs(y - (100 + Math.round(60 * Math.sin(x / 40)))) < 2) {
      raw[i] = 16;
      raw[i + 1] = 185;
      raw[i + 2] = 129;
    }
  }
}
const idat = zlib.deflateSync(raw, { level: 9 });
const png = Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
fs.writeFileSync(process.argv[2] || "/tmp/mock-chart.png", png);
console.log("wrote", png.length, "bytes");
