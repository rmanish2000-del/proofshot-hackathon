// Test-only helpers.

import { crc32, deflateSync } from "node:zlib";

const COLOR_TYPE = { 1: 0, 2: 4, 3: 2, 4: 6 } as const;

function chunk(type: string, body: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}

/** A minimal PNG encoder that applies the given filter type to every row. The header options exist to build bad files. */
export function encodePng(
  width: number,
  height: number,
  channels: 1 | 2 | 3 | 4,
  data: Uint8Array,
  opts: { filter?: number; depth?: number; colorType?: number; interlace?: number } = {},
): Buffer {
  const filter = opts.filter ?? 0;
  const stride = width * channels;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = filter;
    for (let x = 0; x < stride; x++) {
      const cur = data[y * stride + x]!;
      const a = x >= channels ? data[y * stride + x - channels]! : 0;
      const b = y > 0 ? data[(y - 1) * stride + x]! : 0;
      const c = x >= channels && y > 0 ? data[(y - 1) * stride + x - channels]! : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const predictor = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter] ?? 0;
      raw[y * (stride + 1) + 1 + x] = (cur - predictor) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = opts.depth ?? 8;
  ihdr[9] = opts.colorType ?? COLOR_TYPE[channels];
  ihdr[12] = opts.interlace ?? 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array(0)),
  ]);
}
