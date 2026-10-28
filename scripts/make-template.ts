// npm run make:template
//
// Writes templates/mannequin-01/ (base.png, anchors.json, LICENSE.txt) from
// src/mannequin.ts. The output is the same bytes on every run, and
// test/composite.test.ts checks the committed files against it.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { MANNEQUIN_LICENSE, drawMannequin, mannequinAnchors } from "../src/mannequin.ts";
import { encodeRgbPng } from "../src/png.ts";
import { sha256Hex } from "../src/util.ts";

const dir = join(fileURLToPath(new URL("../templates/", import.meta.url)), "mannequin-01");
mkdirSync(dir, { recursive: true });
const img = drawMannequin();
const png = encodeRgbPng(img.width, img.height, img.data);
writeFileSync(join(dir, "base.png"), png);
writeFileSync(join(dir, "anchors.json"), mannequinAnchors());
writeFileSync(join(dir, "LICENSE.txt"), MANNEQUIN_LICENSE);
console.log(`${dir}: base.png ${img.width}x${img.height} sha256 ${sha256Hex(png)}`);
