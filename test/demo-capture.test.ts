import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { parseReceipt, verifyChain } from "../src/receipt.ts";
import { DEMO_SHOTS, REPLAYED_RECORDINGS, browserCandidates, shotIdsFromDemoMd, tamperOneByte } from "../src/demo-capture.ts";

const root = fileURLToPath(new URL("..", import.meta.url));

test("DEMO1: the capture script's shot ids are exactly the docs/DEMO.md shot list, in order", () => {
  const md = readFileSync(join(root, "docs/DEMO.md"), "utf8");
  const ids = shotIdsFromDemoMd(md);
  assert.ok(ids.length > 0, "DEMO.md has a shot list");
  assert.deepEqual(DEMO_SHOTS.map((s) => s.id), ids);
});

test("DEMO1: every shot is either captured or says why not, and every captured frame points at a committed job, recording or file", () => {
  const names = new Set<string>();
  for (const shot of DEMO_SHOTS) {
    assert.ok(shot.frames.length > 0 || (shot.skip ?? "").length > 0, `${shot.id} has frames or a reason`);
    for (const f of shot.frames) {
      assert.ok(!names.has(f.name), `${f.name} is unique`);
      names.add(f.name);
      const job = /[?&]job=([^&]+)/.exec(f.path)?.[1];
      if (f.from === "jobs" && job) assert.ok(existsSync(join(root, "data/jobs", decodeURIComponent(job), "receipt.jsonl")), `${f.name}: data/jobs/${job} is committed`);
      if (f.from === "replay") assert.ok(REPLAYED_RECORDINGS.includes(/@([A-Za-z0-9._-]+)/.exec(f.path)![1]!), `${f.name} names a replayed recording`);
      if (f.from === "disk") assert.ok(existsSync(join(root, f.path)), `${f.name}: ${f.path} exists`);
      for (const a of f.actions)
        if ("verify" in a) for (const p of [a.verify.receipt, a.verify.image]) assert.ok(existsSync(join(root, p)), `${f.name}: ${p} exists`);
    }
  }
  for (const name of REPLAYED_RECORDINGS) assert.ok(existsSync(join(root, "demo/recordings", name, "manifest.json")), `recording ${name}`);
});

test("DEMO1: the tampered receipt differs by one byte and fails the chain check; the original passes", () => {
  const text = readFileSync(join(root, "web/shop/kurta-01/receipt.jsonl"), "utf8");
  const bad = tamperOneByte(text)!;
  assert.equal(bad.length, text.length);
  assert.equal([...bad].filter((c, i) => c !== text[i]).length, 1);
  assert.equal(verifyChain(parseReceipt(text)).ok, true);
  assert.equal(verifyChain(parseReceipt(bad)).ok, false);
  assert.equal(tamperOneByte("{}"), null);
});

test("DEMO1: PROOFSHOT_BROWSER is tried first; Windows looks for Edge and Chrome", () => {
  assert.equal(browserCandidates({ PROOFSHOT_BROWSER: "/x/chrome" }, "linux")[0], "/x/chrome");
  const win = browserCandidates({ ProgramFiles: "C:\\PF" }, "win32");
  assert.ok(win.includes("C:\\PF\\Microsoft\\Edge\\Application\\msedge.exe"));
  assert.ok(win.includes("C:\\PF\\Google\\Chrome\\Application\\chrome.exe"));
});
