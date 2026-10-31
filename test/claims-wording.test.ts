import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (doc: string) => readFileSync(join(root, doc), "utf8");
const CAVEAT = "(recorded 31 Oct self-comparison; would be REVIEW today)";

test("wording 1 (SC2r): every 31 Oct agent RELEASE in SUBMISSION and CLAIMS_AUDIT carries the self-comparison caveat on the same line", () => {
  const lines = [
    ...read("SUBMISSION.md").split("\n").map((l) => ["SUBMISSION.md", l] as const),
    ...read("CLAIMS_AUDIT.md").split("\n").map((l) => ["CLAIMS_AUDIT.md", l] as const),
  ];
  const claims = lines.filter(([, l]) =>
    /Resolved: 2 of 2|got both to RELEASE|REFUSE → RELEASE|2 of 2 with replacement and the label signal|^\| (Pink polo|Mustard kurta, re-run).*\*\*RELEASE\*\*/.test(l),
  );
  assert.equal(claims.length, 7, "the 7 places PS-SC2r listed");
  for (const [doc, l] of claims) assert.ok(l.includes(CAVEAT), `${doc}: ${l.slice(0, 80)}`);
});

test("wording 2 (Grok 21:52): the SUBMISSION opening says evidence-checking agent that requests missing evidence, not 'evidence-recovery', 'analyzes images' or 'checks photos'", () => {
  const sub = read("SUBMISSION.md");
  const form = sub.split("**Long description:**")[0]!;
  const firstLong = sub.split("**Long description:**")[1]!.split("\n\n").filter((p) => p.trim())[1]!;
  assert.match(form, /\*\*Tagline:\*\* An evidence-checking agent/);
  assert.match(form, /segment.*render.*verify.*request missing evidence from the seller, or refuse/s);
  assert.match(firstLong, /^ProofShot is an evidence-checking agent/);
  for (const part of [form, firstLong]) assert.doesNotMatch(part, /evidence-recovery|recover missing/i);
  assert.doesNotMatch(form, /analy[sz]es images|checks photos|checks a candidate/i);
});

test("wording 6 (Grok 21:52): the beat 3 composite v2 breakdown is stated in evidence/tryon/SUMMARY.md and cited in the beat's source column", () => {
  assert.match(read("evidence/tryon/SUMMARY.md"), /composite v2 1 RELEASE, 3 REVIEW, 1 REFUSE/);
  const beat3 = read("docs/DEMO.md").split("\n").find((l) => l.startsWith("| 3 Results"))!;
  const source = beat3.split("|").map((c) => c.trim())[5]!;
  assert.match(source, /evidence\/tryon\/SUMMARY\.md.*composite v2 1 RELEASE, 3 REVIEW, 1 REFUSE/);
});

test("wording 7 (Grok 21:57, 22:10): no 'Evidence Recovery' name in SUBMISSION, README, CLAIMS_AUDIT, docs/*.md or the seller-pairs README (beat 1's recorded narration aside); the plan doc's new path is the one linked; beat 1 keeps the recorded narration and carries the agent caption", () => {
  const md = read("docs/DEMO.md");
  const v7 = md.slice(md.indexOf("## Re-render script v7"), md.indexOf("## Rules for record day"));
  const beat1 = v7.split("\n").find((l) => l.startsWith("| 1 Problem"))!;
  const docs = readdirSync(join(root, "docs")).filter((f) => f.endsWith(".md")).map((f) => `docs/${f}`);
  assert.ok(docs.includes("docs/EVIDENCE_CHECKING_PLAN.md") && !docs.includes("docs/EVIDENCE_RECOVERY_PLAN.md"));
  for (const doc of ["SUBMISSION.md", "README.md", "CLAIMS_AUDIT.md", "data/seller-pairs/README.md", ...docs]) {
    const text = doc === "docs/DEMO.md" ? md.replace(beat1.split("|")[4]!, "") : read(doc);
    assert.doesNotMatch(text, /evidence[- ]recovery/i, doc);
    assert.doesNotMatch(text, /EVIDENCE_RECOVERY_PLAN/, `${doc} links the old plan path`);
  }
  for (const doc of ["README.md", "SUBMISSION.md", "src/agent/vocab.ts"]) assert.match(read(doc), /docs\/EVIDENCE_CHECKING_PLAN\.md/, doc);
  assert.match(beat1, /the agent caption \(below\) over the last sentence/);
  assert.match(beat1.split("|")[4]!, /ProofShot is an evidence-recovery agent that catches that/);
  assert.match(v7, /verbatim from Manish's recorded voiceover/);
  assert.ok(v7.includes("\nEvidence-checking agent: it asks the seller for missing evidence, or refuses.\n"));
});

test("wording 3: the DEMO.md v7 re-render script keeps the corrected claims, the prior-work card and each beat's word cap", () => {
  const md = read("docs/DEMO.md");
  const v7 = md.slice(md.indexOf("## Re-render script v7"), md.indexOf("## Rules for record day"));
  assert.ok(v7.length > 0, "the v7 section sits before the v6 rules");
  assert.match(v7, /0 of 5 AI try-ons released; every one held for review or refused, with the reason on the receipt/);
  assert.match(v7, /Pruna \(via Replicate\)/);
  assert.match(v7, /one RELEASE, three REVIEW and one REFUSE/);
  assert.match(v7, /npm run agent:demo/);
  assert.ok(v7.includes("Prior work: spec document only. Everything you see running was coded 27–31 Oct (first commit 15658a4). git log is public."));
  const rows = v7.split("\n").filter((l) => /^\| \d [A-Z]/.test(l));
  assert.equal(rows.length, 5, "five narrated beats");
  for (const row of rows) {
    const cells = row.split("|").map((c) => c.trim());
    const cap = Number(/cap (\d+)/.exec(cells[2]!)![1]);
    const said = cells[4]!;
    assert.ok(said.split(/\s+/).length <= cap, `${cells[1]}: ${said.split(/\s+/).length} words, cap ${cap}`);
    assert.doesNotMatch(said, /5\/5|5 REFUSED/);
  }
});

test("wording 5 (SC2g + EX1r): SC2 and intake are worded to what they do, with the limits beside them", () => {
  const sub = read("SUBMISSION.md");
  const audit = read("CLAIMS_AUDIT.md");
  const readme = read("README.md");
  assert.doesNotMatch(sub, /SC2 closes/);
  assert.doesNotMatch(audit, /cannot pass either/);
  const sc2 = sub.slice(sub.indexOf("SC2 narrows"), sub.indexOf("**Keyless demo**"));
  assert.match(sc2, /within the grid threshold, is moved to REVIEW/);
  for (const miss of ["crop", "rotation", "mirror", "more than 2%", "neither JPEG nor PNG", "new photo taken of the"]) assert.ok(sc2.includes(miss), `SUBMISSION SC2 lists '${miss}' as not caught`);
  assert.match(sub, /byte for byte \(SC1; SC2, below, adds near-copies\)/);
  assert.doesNotMatch(readme, /# garment photos in: strips metadata/);
  assert.match(readme, /applies EXIF orientation, drops Exif\/XMP\/vendor data, keeps JFIF\/ICC/);
  const intake = audit.split("\n").find((l) => l.startsWith("| Intake strips photo metadata"))!;
  assert.doesNotMatch(intake, /there was nothing to strip/);
  assert.match(intake, /grey shirt.*stripped before EX1.*still sideways/);
});

test("wording 4: DEMO v7 runs 170 s or less with the end card, the beats are back to back, and the prior-work line opens beat 1", () => {
  const md = read("docs/DEMO.md");
  const v7 = md.slice(md.indexOf("## Re-render script v7"), md.indexOf("## Rules for record day"));
  const rows = v7.split("\n").filter((l) => /^\| (\d [A-Z]|Card )/.test(l));
  assert.equal(rows.length, 6, "five beats and the end card");
  const secs = (t: string) => Number(t.split(":")[0]) * 60 + Number(t.split(":")[1]);
  let clock = 0;
  for (const row of rows) {
    const [, from, to, len] = /(\d:\d\d) to (\d:\d\d) \((\d+) s/.exec(row)!;
    assert.equal(secs(from!), clock, `${row.slice(0, 20)} starts where the last beat ended`);
    assert.equal(secs(to!) - secs(from!), Number(len), `${row.slice(0, 20)} length`);
    clock = secs(to!);
  }
  assert.ok(clock <= 170, `v7 runs ${clock} s, target 170 s or less`);
  assert.match(rows[0]!, /prior-work caption .* from 0:00 to 0:05/);
});
