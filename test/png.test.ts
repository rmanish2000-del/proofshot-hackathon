import assert from "node:assert/strict";
import { test } from "node:test";

import { PngError, decodePng, maskFromPng, rgbFromPng } from "../src/png.ts";
import { encodePng } from "./helpers.ts";

const pixels = (n: number, seed: number) => Uint8Array.from({ length: n }, (_, i) => (i * 37 + seed * 11 + ((i * i) % 7)) & 0xff);

test("every supported colour type round-trips under all five row filters", () => {
  for (const channels of [1, 2, 3, 4] as const) {
    for (const filter of [0, 1, 2, 3, 4]) {
      const data = pixels(5 * 4 * channels, filter);
      const png = decodePng(encodePng(5, 4, channels, data, { filter }));
      assert.deepEqual([png.width, png.height, png.channels], [5, 4, channels]);
      assert.deepEqual(png.data, data, `channels ${channels}, filter ${filter}`);
    }
  }
});

test("unsupported PNGs throw with the reason", () => {
  const data = pixels(4 * 4 * 3, 1);
  const cases: [Uint8Array, RegExp][] = [
    [Buffer.from("not a png at all"), /bad signature/],
    [encodePng(4, 4, 3, data, { depth: 16 }), /bit depth 16/],
    [encodePng(4, 4, 3, data, { colorType: 3 }), /colour type 3/],
    [encodePng(4, 4, 3, data, { interlace: 1 }), /interlaced/],
    [encodePng(4, 4, 3, data, { filter: 9 }), /bad filter type 9/],
  ];
  for (const [bytes, reason] of cases) assert.throws(() => decodePng(bytes), (e: unknown) => e instanceof PngError && reason.test(e.message));
});

test("a corrupted or truncated file throws instead of decoding garbage", () => {
  const good = encodePng(4, 4, 3, pixels(48, 2));
  const flipped = Buffer.from(good);
  flipped[40] = flipped[40]! ^ 0xff;
  assert.throws(() => decodePng(flipped), /bad CRC/);
  assert.throws(() => decodePng(good.subarray(0, good.length - 12)), /no IEND/);
  assert.throws(() => decodePng(good.subarray(0, 40)), /truncated/);
});

test("a mask pixel is garment only when brightness and alpha are both at least 128", () => {
  const grey = decodePng(encodePng(3, 1, 1, Uint8Array.from([127, 128, 255])));
  assert.deepEqual(maskFromPng(grey).data, Uint8Array.from([0, 1, 1]));
  const greyAlpha = decodePng(encodePng(3, 1, 2, Uint8Array.from([255, 127, 255, 128, 100, 255])));
  assert.deepEqual(maskFromPng(greyAlpha).data, Uint8Array.from([0, 1, 0]));
  const rgba = decodePng(encodePng(3, 1, 4, Uint8Array.from([255, 255, 255, 255, 0, 0, 255, 255, 255, 255, 255, 0])));
  assert.deepEqual(maskFromPng(rgba).data, Uint8Array.from([1, 0, 0]));
});

test("rgbFromPng keeps RGB, drops alpha from RGBA, and refuses greyscale", () => {
  const rgb = Uint8Array.from([1, 2, 3, 4, 5, 6]);
  assert.deepEqual(rgbFromPng(decodePng(encodePng(2, 1, 3, rgb))).data, rgb);
  assert.deepEqual(rgbFromPng(decodePng(encodePng(2, 1, 4, Uint8Array.from([1, 2, 3, 9, 4, 5, 6, 9])))).data, rgb);
  assert.throws(() => rgbFromPng(decodePng(encodePng(2, 1, 1, Uint8Array.from([1, 2])))), /needs RGB/);
});
