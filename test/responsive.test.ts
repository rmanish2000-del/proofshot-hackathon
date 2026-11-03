import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { RESPONSIVE_PAGES, RESPONSIVE_VIEWPORTS, layoutProblems, type ControlBox, type PageMeasure } from "../src/responsive.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const EVIDENCE = join(ROOT, "evidence", "responsive-2026-11-03");

const box = (left: number, right: number, extra: Partial<ControlBox> = {}): ControlBox => ({ found: true, display: "block", visibility: "visible", left, right, width: right - left, height: 40, ...extra });

test("responsive 1: layoutProblems passes a page that fits and names each way a page can fail", () => {
  assert.deepEqual(layoutProblems({ innerWidth: 375, scrollWidth: 375, controls: { submit: box(16, 359) } }), []);
  const bad: PageMeasure = {
    innerWidth: 375,
    scrollWidth: 420,
    controls: {
      missing: { found: false, display: "", visibility: "", left: 0, right: 0, width: 0, height: 0 },
      hidden: box(16, 359, { display: "none" }),
      wide: box(16, 410),
    },
  };
  const problems = layoutProblems(bad);
  assert.equal(problems.length, 4);
  assert.match(problems[0]!, /^horizontal overflow: scrollWidth 420 > innerWidth 375$/);
  assert.match(problems[1]!, /^missing: not found$/);
  assert.match(problems[2]!, /^hidden: not rendered$/);
  assert.match(problems[3]!, /^wide: outside the width \(16 to 410 of 375\)$/);
});

test("responsive 2: the committed RV31 check covers upload and verify at 375, 768 and 1280 px, every row passes, and the rules re-derive the pass", () => {
  const r = JSON.parse(readFileSync(join(EVIDENCE, "results.json"), "utf8")) as { passed: boolean; browser: string; results: { page: string; viewport: string; width: number; screenshot: string; measure: PageMeasure; problems: string[] }[] };
  assert.equal(r.passed, true);
  assert.match(r.browser, /^Edg\/157\./);
  assert.deepEqual(RESPONSIVE_VIEWPORTS.map((v) => v.width), [375, 768, 1280]);
  const want = RESPONSIVE_PAGES.flatMap((p) => RESPONSIVE_VIEWPORTS.map((v) => `${p.name}-${v.label}`));
  assert.deepEqual(r.results.map((x) => `${x.page}-${x.viewport}`), want);
  for (const x of r.results) {
    assert.deepEqual(x.problems, [], `${x.page} ${x.viewport}`);
    assert.equal(x.measure.innerWidth, x.width);
    assert.deepEqual(layoutProblems(x.measure), [], `${x.page} ${x.viewport} re-derived`);
    const page = RESPONSIVE_PAGES.find((p) => p.name === x.page)!;
    assert.deepEqual(Object.keys(x.measure.controls).sort(), Object.keys(page.controls).sort());
    assert.ok(existsSync(join(EVIDENCE, x.screenshot)), x.screenshot);
  }
});
