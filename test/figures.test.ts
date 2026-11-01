import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { FIGURE_DOCS, applyFigures, computeFigures, runLogDirs, testCount } from "../src/figures.ts";

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

test("figures 6 (NUM10): run-folder call logs and receipts without a render are counted, and the docs say so", () => {
  const f = computeFigures(root);
  // The 30–31 Oct agent and try-on runs: evidence/{agent-real-2026-10-30,agent-replace-2026-10-31,agent-replace-2026-10-31-label,tryon}/logs.
  assert.deepEqual(runLogDirs(root).map((d) => d.split(/[\\/]/).at(-2)).sort(), ["agent-real-2026-10-30", "agent-replace-2026-10-31", "agent-replace-2026-10-31-label", "tryon"]);
  assert.ok(Number(f.sam_calls_runs) > 0 && Number(f.muse13_calls_runs) > 0);
  assert.equal(Number(f.sam_calls_all), Number(f.sam_calls) + Number(f.sam_calls_runs));
  assert.equal(Number(f.muse13_calls_all), Number(f.muse13_calls) + Number(f.muse13_calls_runs));
  // Receipts: every committed one verifies, and the agent evaluation read exactly these.
  assert.equal(f.receipt_chains, `${f.receipts} of ${f.receipts}`);
  assert.equal(Number(f.receipts), Number(f.jobs) + Number(f.receipts_no_render));
  const evalReport = JSON.parse(readFileSync(join(root, "evidence/agent-eval-2026-10-30.json"), "utf8"));
  assert.equal(evalReport.jobs, Number(f.receipts), "agent-eval counts every committed receipt");
  const sub = readFileSync(join(root, "SUBMISSION.md"), "utf8").replace(/\s+/g, " ");
  assert.doesNotMatch(sub, /committed jobs plus the fixture job/, "the fixture job is one of the jobs, not an extra one");
  assert.doesNotMatch(sub, /In (my|our) live try-on calls, long kurtas came back shorter/, "the shortening was seen on the 28–29 Oct kurta set, not on all 12");
  for (const doc of FIGURE_DOCS) {
    const text = readFileSync(join(root, doc), "utf8");
    if (text.includes("<!--f:sam_calls-->")) assert.ok(text.includes("<!--f:sam_calls_runs-->"), `${doc}: a SAM count names the run-log calls too`);
    if (text.includes("<!--f:muse13_calls-->")) assert.ok(text.includes("<!--f:muse13_calls_runs-->"), `${doc}: a Muse Spark 1.3 count names the run-log calls too`);
  }
  const readme = readFileSync(join(root, "README.md"), "utf8").replace(/\s+/g, " ");
  assert.doesNotMatch(readme, /held all of them only because the fidelity check/, "the gate cited the verifier for 3 of the 7");
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
