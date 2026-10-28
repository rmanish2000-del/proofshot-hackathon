import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { concatList } from "../src/demo-capture.ts";
import { STAGED_LISTS, concatFiles, isLocalName, stageDemo, stagingStamp } from "../src/demo-stage.ts";

/** A fake capture folder: two 1280 frames (one repeated last, as concatList does), a 360 frame, and the three lists. */
function fakeCapture(dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "S1-1280.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1]));
  writeFileSync(join(dir, "S2-1280.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 2, 2]));
  writeFileSync(join(dir, "S1-360.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 3]));
  writeFileSync(join(dir, "frames.txt"), concatList([{ file: "S1-1280.png", seconds: 4 }, { file: "S2-1280.png", seconds: 6 }]));
  writeFileSync(join(dir, "shots.json"), JSON.stringify({ total_seconds: 10, shots: [] }) + "\n");
  writeFileSync(join(dir, "captions.srt"), "1\n00:00:00,000 --> 00:00:04,000\nHello.\n");
}

const tmp = () => mkdtempSync(join(tmpdir(), "ps-stage-"));

test("DEMO1d: staging copies the listed 1280 frames and the lists, and manifest hashes and sizes match the copied files", () => {
  const base = tmp();
  try {
    const from = join(base, "out-demo");
    const to = join(base, "staged", "20261029T000000Z");
    fakeCapture(from);
    const m = stageDemo(from, to);
    assert.deepEqual(m.files.map((f) => f.file), ["S1-1280.png", "S2-1280.png", ...STAGED_LISTS]);
    assert.ok(!existsSync(join(to, "S1-360.png")), "360 px frames are not staged");
    const written = JSON.parse(readFileSync(join(to, "manifest.json"), "utf8"));
    assert.deepEqual(written, m);
    for (const f of m.files) {
      const bytes = readFileSync(join(to, f.file));
      assert.equal(f.bytes, bytes.length, f.file);
      assert.equal(f.sha256, createHash("sha256").update(bytes).digest("hex"), f.file);
      assert.deepEqual(bytes, readFileSync(join(from, f.file)), `${f.file} is a byte copy`);
    }
    assert.deepEqual(readdirSync(to).sort(), [...m.files.map((f) => f.file), "manifest.json"].sort());
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("DEMO1d: frames.txt in the staged folder resolves every frame relative to itself", () => {
  const base = tmp();
  try {
    const from = join(base, "out-demo");
    const to = join(base, "elsewhere", "deeper");
    fakeCapture(from);
    stageDemo(from, to);
    const listed = concatFiles(readFileSync(join(to, "frames.txt"), "utf8"));
    assert.deepEqual(listed, ["S1-1280.png", "S2-1280.png"]);
    for (const f of listed) {
      assert.ok(isLocalName(f), `${f} is a bare name`);
      assert.ok(existsSync(join(to, f)), `${f} is next to frames.txt`);
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("DEMO1d: concatList writes bare file names, so the list is relative to its own folder", () => {
  const list = concatList([{ file: "S2a-1280.png", seconds: 3 }]);
  assert.deepEqual(concatFiles(list), ["S2a-1280.png"]);
  assert.ok(concatFiles(list).every(isLocalName));
  for (const bad of ["C:\\out\\demo\\S1.png", "/tmp/S1.png", "out/demo/S1.png", "..", ""]) assert.equal(isLocalName(bad), false, bad);
});

test("DEMO1d: staging refuses with no shots.json, a path in frames.txt, a missing frame, or a non-empty target", () => {
  const base = tmp();
  try {
    const empty = join(base, "empty");
    mkdirSync(empty);
    assert.throws(() => stageDemo(empty, join(base, "t0")), /no shots\.json/);
    assert.ok(!existsSync(join(base, "t0")), "nothing staged");

    const pathy = join(base, "pathy");
    fakeCapture(pathy);
    writeFileSync(join(pathy, "frames.txt"), concatList([{ file: join(pathy, "S1-1280.png"), seconds: 4 }]));
    assert.throws(() => stageDemo(pathy, join(base, "t1")), /must be a file next to it/);

    const gap = join(base, "gap");
    fakeCapture(gap);
    rmSync(join(gap, "S2-1280.png"));
    assert.throws(() => stageDemo(gap, join(base, "t2")), /S2-1280\.png, which is not in/);

    const ok = join(base, "ok");
    fakeCapture(ok);
    const busy = join(base, "busy");
    mkdirSync(busy);
    writeFileSync(join(busy, "x"), "x");
    assert.throws(() => stageDemo(ok, busy), /not empty/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("DEMO1d: the staged folder name is a UTC timestamp", () => {
  assert.equal(stagingStamp(new Date("2026-10-28T19:45:07.123Z")), "20261028T194507Z");
});
