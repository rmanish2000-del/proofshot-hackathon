// Judge-review fix 1 (Codex, 29 Oct): every figure README.md and SUBMISSION.md
// quote is computed here from committed evidence, and written between markers
// `<!--f:key-->value<!--/f-->` by `npm run figures`, so the prose cannot drift
// from the evidence. A test fails when a committed doc and this disagree.
//
// Sources: evidence/pack/summary.json (receipts, per-stage call counts, copy),
// evidence/calibration-jobs-2026-10-29.json (the latest calibration report),
// evidence/ms4-summary.json, data/jobs and evidence/tryon receipts (try-on renders), and the test
// files (the number of top-level `test(` calls, which is what `npm test` runs).

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

type Json = Record<string, any>;
const readJson = (p: string): Json => JSON.parse(readFileSync(p, "utf8")) as Json;
const of = (n: number, d: number) => `${n} of ${d}`;

export const CALIBRATION_FILE = "evidence/calibration-jobs-2026-10-29.json";

/** Top-level `test(` calls in test/*.test.ts: the count `npm test` reports, without running it. */
export function testCount(root: string): number {
  const dir = join(root, "test");
  return readdirSync(dir)
    .filter((n) => n.endsWith(".test.ts"))
    .reduce((n, f) => n + (readFileSync(join(dir, f), "utf8").match(/^test\(/gm)?.length ?? 0), 0);
}

export function computeFigures(root: string): Record<string, string> {
  const pack = readJson(join(root, "evidence/pack/summary.json"));
  const stage = (prefix: string) => (pack.stages as Json[]).find((s) => String(s.stage).startsWith(prefix));
  const calls = (prefix: string) => String(stage(prefix)?.calls ?? 0);
  const answered = (prefix: string) => String(stage(prefix)?.answered ?? 0);

  const cal = readJson(join(root, CALIBRATION_FILE));
  const x1 = (cal.gate as Json[]).find((g) => g.name === "x1")!;
  const recorded = (cal.cases as Json[]).filter((c) => c.recorded);
  const reproduced = recorded.filter((c) => (x1.cases as Json[]).find((k) => k.id === c.id)?.decision === c.recorded).length;

  const ms4 = readJson(join(root, "evidence/ms4-summary.json"));
  const changed = ms4.by_expected.changed;

  // SUB26: Pruna calls on Replicate are counted from the receipts' render entries (attempts per render).
  // NUM6 (31 Oct): two committed sets, kept apart so every sentence can name the one it means:
  // the 28–29 Oct kurta jobs (data/jobs/*) and the 31 Oct try-on run (evidence/tryon/<garment>/<renderer>/).
  const kurta = tryonSet(readdirSync(join(root, "data/jobs"))
    .filter((job) => !job.startsWith("upload-"))
    .map((job) => join(root, "data/jobs", job, "receipt.jsonl")));
  const runDir = join(root, "evidence/tryon");
  const run31 = tryonSet(existsSync(runDir)
    ? readdirSync(runDir, { withFileTypes: true }).filter((d) => d.isDirectory())
      .flatMap((g) => readdirSync(join(runDir, g.name)).map((r) => join(runDir, g.name, r, "receipt.jsonl")))
    : []);
  // AGW5 (31 Oct): the 31 Oct run's garments are the evidence/tryon folders with a receipt (not logs/).
  // garments_all adds them to the receipt garments by name; figures 5 checks the two sets share no photo.
  const run31Garments = existsSync(runDir)
    ? readdirSync(runDir, { withFileTypes: true }).filter((d) => d.isDirectory())
      .map((d) => d.name)
      .filter((g) => readdirSync(join(runDir, g)).some((r) => existsSync(join(runDir, g, r, "receipt.jsonl"))))
    : [];

  const r = pack.receipts as Json;
  return {
    tests: String(testCount(root)),
    sam_calls: calls("segment: SAM"),
    muse13_calls: calls("verify: muse-spark-1.3"),
    muse13_answered: answered("verify: muse-spark-1.3"),
    fireworks_calls: calls("copy: accounts/fireworks/models/muse-spark-open"),
    baseten_calls: calls("verify: meta-models/muse-spark-open-1026"),
    llama_calls: calls("copy: accounts/fireworks/models/llama"),
    jobs: String(r.jobs),
    renders: String(r.renders),
    chains: of(r.chains_ok, r.jobs),
    live_renders: String(r.live_renders),
    fixture_renders: String(r.renders - r.live_renders),
    garments: String((r.garments_with_receipts as string[]).length),
    tryon_run31_garments: String(run31Garments.length),
    garments_all: String(new Set([...(r.garments_with_receipts as string[]), ...run31Garments]).size),
    cal_cases: String(x1.same + x1.different),
    cal_same: String(x1.same),
    cal_different: String(x1.different),
    cal_false_match: String(x1.false_match),
    cal_false_refuse: String(x1.false_refuse),
    cal_unmeasured: String(x1.unmeasured),
    cal_reproduced: of(reproduced, recorded.length),
    cal_skipped: String((cal.skipped as unknown[]).length),
    ms4_pairs: String(ms4.pairs),
    ms4_runs: String(ms4.runs),
    ms4_wrong_refused: of(ms4.mismatch_catch.refused, ms4.mismatch_catch.answered),
    ms4_same_released: of(ms4.by_expected.same.correct, ms4.by_expected.same.answered),
    ms4_changed_held: of(changed.correct, changed.answered),
    ms4_changed_passed: of(changed.answered - changed.correct, changed.answered),
    ms4_consistent: of(ms4.consistency.same_decision_all_reps, ms4.consistency.pairs_scored),
    // tryon_* and pruna_* without "all": the 28–29 Oct kurta jobs only.
    tryon_total: String(kurta.total),
    pruna_calls: String(kurta.calls),
    pruna_usd_est: kurta.usd.toFixed(3),
    tryon_refuse: String(kurta.by.REFUSE ?? 0),
    tryon_review: String(kurta.by.REVIEW ?? 0),
    tryon_release: String(kurta.by.RELEASE ?? 0),
    tryon_run31_total: String(run31.total),
    tryon_run31_refuse: String(run31.by.REFUSE ?? 0),
    tryon_all_total: String(kurta.total + run31.total),
    tryon_all_refuse: String((kurta.by.REFUSE ?? 0) + (run31.by.REFUSE ?? 0)),
    tryon_all_review: String((kurta.by.REVIEW ?? 0) + (run31.by.REVIEW ?? 0)),
    tryon_all_release: String((kurta.by.RELEASE ?? 0) + (run31.by.RELEASE ?? 0)),
    pruna_all_calls: String(kurta.calls + run31.calls),
    pruna_all_usd_est: (kurta.usd + run31.usd).toFixed(3),
    copy_texts: String(pack.copy.texts),
    copy_model: String(pack.copy.by_model),
    copy_template: String(pack.copy.template),
  };
}

/** Pruna try-on renders in these receipts (missing files skipped): count, calls, estimated USD, gate decisions. */
export function tryonSet(receipts: string[]): { total: number; calls: number; usd: number; by: Record<string, number> } {
  const set = { total: 0, calls: 0, usd: 0, by: {} as Record<string, number> };
  for (const p of receipts) {
    if (!existsSync(p)) continue;
    const lines = readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as Json);
    for (const r of lines.filter((l) => l.kind === "render" && l.payload.provider === "replicate-pruna-tryon")) {
      const g = lines.find((l) => l.kind === "gate" && l.payload.render_id === r.payload.render_id)?.payload.decision ?? "none";
      set.total++;
      set.calls += typeof r.payload.attempts === "number" ? r.payload.attempts : 1;
      set.usd += typeof r.payload.cost_estimated_usd === "number" ? r.payload.cost_estimated_usd : 0;
      set.by[g] = (set.by[g] ?? 0) + 1;
    }
  }
  return set;
}

const MARKER =/<!--f:([a-z0-9_]+)-->([\s\S]*?)<!--\/f-->/g;

/** The text with every marked figure set to its computed value; unknown keys are reported, never guessed. */
export function applyFigures(text: string, figures: Readonly<Record<string, string>>): { text: string; unknown: string[]; count: number } {
  const unknown: string[] = [];
  let count = 0;
  const out = text.replace(MARKER, (whole, key: string) => {
    count++;
    if (!(key in figures)) {
      unknown.push(key);
      return whole;
    }
    return `<!--f:${key}-->${figures[key]}<!--/f-->`;
  });
  return { text: out, unknown, count };
}

export const FIGURE_DOCS = ["README.md", "SUBMISSION.md", "CLAIMS_AUDIT.md"] as const;
