import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
