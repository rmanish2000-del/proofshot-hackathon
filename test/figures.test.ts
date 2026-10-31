import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { FIGURE_DOCS, applyFigures, computeFigures, testCount } from "../src/figures.ts";

const root = fileURLToPath(new URL("..", import.meta.url));

test("figures 1: marked values are replaced from the figures; unknown keys are reported and left as they were", () => {
  const out = applyFigures("SAM <!--f:sam-->117<!--/f--> calls, <!--f:nope-->x<!--/f-->.", { sam: "122" });
  assert.equal(out.text, "SAM <!--f:sam-->122<!--/f--> calls, <!--f:nope-->x<!--/f-->.");
  assert.deepEqual(out.unknown, ["nope"]);
  assert.equal(out.count, 2);
});

test("figures 2: README.md and SUBMISSION.md quote the figures the committed evidence gives (run npm run figures if this fails)", () => {
  const figures = computeFigures(root);
  assert.equal(Number(figures.tests), testCount(root));
  assert.match(figures.cal_reproduced!, /^(\d+) of \1$/, "calibration reproduces every recorded decision");
  for (const doc of FIGURE_DOCS) {
    const text = readFileSync(join(root, doc), "utf8");
    const { text: fresh, unknown, count } = applyFigures(text, figures);
    assert.deepEqual(unknown, [], `${doc}: every marker names a known figure`);
    assert.ok(count > 0, `${doc} has marked figures`);
    assert.equal(text, fresh, `${doc} is out of date: run npm run figures`);
  }
});

test("figures 3 (SUB26): Pruna calls are counted from the try-on render entries, at least one per try-on image", () => {
  const f = computeFigures(root);
  assert.ok(Number(f.pruna_calls) >= Number(f.tryon_total), `${f.pruna_calls} calls for ${f.tryon_total} try-on images`);
  assert.match(f.pruna_usd_est!, /^\d+\.\d{3}$/);
});

test("figures 4 (NUM6): the 31 Oct try-on run is counted, all = 28–29 Oct kurta set + 31 Oct run, and no doc calls the kurta set 'all committed'", () => {
  const f = computeFigures(root);
  assert.equal(Number(f.tryon_run31_total), 5, "evidence/tryon has the 5 Pruna try-ons of 31 Oct");
  assert.equal(Number(f.tryon_all_total), Number(f.tryon_total) + Number(f.tryon_run31_total));
  assert.equal(Number(f.tryon_all_release), 0);
  assert.ok(Number(f.pruna_all_calls) >= Number(f.tryon_all_total));
  for (const doc of FIGURE_DOCS) {
    const text = readFileSync(join(root, doc), "utf8").replace(/\s+/g, " ");
    assert.doesNotMatch(text, /all <!--f:tryon_total-->\d+<!--\/f--> (committed|try-on|AI)|<!--f:tryon_total-->\d+<!--\/f--> of <!--f:tryon_total-->\d+<!--\/f--> committed/i, `${doc}: the kurta set is named, not 'all committed'`);
  }
});

test("figures 5 (AGW5): the 4 receipt garments and the 5 garments of the 31 Oct run share no photo, so garments_all adds them", () => {
  const f = computeFigures(root);
  assert.equal(f.garments, "4");
  assert.equal(f.tryon_run31_garments, "5");
  assert.equal(f.garments_all, "9");
  const pack = JSON.parse(readFileSync(join(root, "evidence/pack/summary.json"), "utf8"));
  const hashes = (dir: string): string[] =>
    (JSON.parse(readFileSync(join(root, dir, "intake.json"), "utf8")).files as { sha256: string; source_sha256: string }[])
      .flatMap((x) => [x.sha256, x.source_sha256]);
  const four = new Set((pack.receipts.garments_with_receipts as string[]).flatMap((g) => hashes(join("data/garments", g))));
  const run31 = readdirSync(join(root, "evidence/tryon"), { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== "logs").map((d) => d.name);
  assert.equal(run31.length, 5);
  for (const g of run31) {
    for (const h of hashes(join("data/seller-pairs", g))) assert.ok(!four.has(h), `${g} photo ${h.slice(0, 8)} is also a receipt-garment photo`);
  }
});
