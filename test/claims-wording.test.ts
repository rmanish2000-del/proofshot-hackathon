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

test("wording 8 (Grok 22:25, AGW4): the README 'Public repo' row says every commit carries the noreply address since the 30 Oct re-authoring, not 'from 28 Oct'", () => {
  const readme = read("README.md");
  const row = readme.split("\n").find((l) => l.startsWith("| Public repo |"))!;
  assert.match(row, /since the 30 Oct history re-authoring every commit's author and committer email is a GitHub noreply address/);
  assert.match(row, /docs\/HISTORY\.md/);
  assert.doesNotMatch(readme, /noreply address from 28 Oct/);
  assert.match(read("docs/HISTORY.md"), /30 Oct history\s+re-authoring \(emails only/);
});

test("wording 9 (Grok 22:40 AGW5, 22:58 AGW6): README Limits and the SUBMISSION evidence paragraph scope the 4 garments and the 5 of the 31 Oct run, and give 9 only beside the no-shared-photo and by-eye checks", () => {
  const readme = read("README.md").replace(/\s+/g, " ");
  const limit = readme.slice(readme.indexOf("**Small sample.**"), readme.indexOf("**Verifier accuracy is not measured"));
  assert.match(limit, /cover <!--f:garments-->4<!--\/f--> real garments \(two women's kurtas, two shirts: kurta-01, kurta-02, shirt-plaid, shirt-zebra\)/);
  assert.match(limit, /31 Oct try-on run .* used <!--f:tryon_run31_garments-->5<!--\/f--> other real garments \(pink polo, mustard kurta, pink patchwork kurta, red floral kurta, grey shirt/);
  assert.match(limit, /No photo is shared between the two sets .* <!--f:garments_all-->9<!--\/f--> real garments in all/);
  const sub = read("SUBMISSION.md");
  assert.doesNotMatch(sub, /That is <!--f:garments-->4<!--\/f--> garments/);
  assert.match(sub, /on <!--f:garments-->4<!--\/f--> garments \(kurta-01, kurta-02, shirt-plaid, shirt-zebra\), all the owner's own; the 31 Oct run is on <!--f:tryon_run31_garments-->5<!--\/f--> other real garments; no photo is shared between the two sets \(sha256\) and by eye none of the 5 is one of the 4, so <!--f:garments_all-->9<!--\/f--> garments in all/);
  assert.doesNotMatch(sub, /with no photo shared between the two sets, so/);
  // AGW6: the try-on summary's handoff folder kurta-01 must not read as data/garments/kurta-01.
  assert.match(read("evidence/tryon/SUMMARY.md"), /The handoff folder named `kurta-01` above is kurta-red-floral, not `data\/garments\/kurta-01` \(different sha256\)\./);
  // AGW7: CLAIMS_AUDIT keeps a row for the 9 total, with both proofs and its scope.
  const audit = read("CLAIMS_AUDIT.md").split("\n");
  const row = audit.find((l) => l.startsWith('| "<!--f:garments_all-->9<!--/f--> real garments in all"'));
  assert.ok(row, "CLAIMS_AUDIT has a row for the 9-garment claim");
  assert.match(row, /\| proven, scoped \|/);
  assert.match(row, /"figures 5"/);
  assert.match(row, /by-eye check of the front photos was done by Claude Code \(autorun\)/);
  assert.match(row, /not a general accuracy sample/);
  assert.ok(audit.some((l) => l.startsWith("| On 5 real garments (pink polo, mustard kurta, pink patchwork kurta, red floral kurta, grey shirt)")), "the 5-garment row still names the 5");
  assert.ok(audit.some((l) => l.includes("4 garments, all the owner's own")), "the 4-garment calibration row still reads 4");
});

test("wording 10 (Grok 23:25, AGW8): README, SUBMISSION and DEMO.md give one video length, the v7 script's, labelled as script length; 76 s appears only as the v6 capture timing", () => {
  const md = read("docs/DEMO.md");
  const v7 = md.slice(md.indexOf("## Re-render script v7"), md.indexOf("## Rules for record day"));
  const rows = v7.split("\n").filter((l) => /^\| (\d [A-Z]|Card )/.test(l));
  const end = (row: string) => /to (\d:\d\d) \(/.exec(row)![1]!;
  const withCard = end(rows.at(-1)!);
  const without = end(rows.at(-2)!);
  assert.deepEqual([without, withCard], ["2:45", "2:50"]);
  assert.match(v7, new RegExp(`${withCard} in all with the optional end card\\s+\\(${without} without it\\)`));
  const claim = `script runs ${without}, or ${withCard} with the optional end card. That is the script length`;
  for (const doc of ["README.md", "SUBMISSION.md"]) {
    const text = read(doc).replace(/\s+/g, " ");
    assert.ok(text.includes(claim), `${doc} states the v7 script length`);
    assert.doesNotMatch(text, /about 2\.5 minutes|Demo script \(76 s\)/, doc);
    for (const m of text.matchAll(/76 s/g)) {
      const around = text.slice(Math.max(0, m.index! - 160), m.index! + 40);
      assert.match(around, /v6|clone \+ `npm ci`/, `${doc}: '76 s' not labelled v6: ${around}`);
    }
  }
  assert.match(md.replace(/\s+/g, " "), /v6 capture timing 76 s \(the video to submit is the v7 re-render below: script length 2:45, or 2:50 with the optional end card\)/);
});

test("wording 11 (Grok 23:45, AGW9): the v7 prior-work caption says what SUBMISSION says; beat 3 shows a replicate-pruna-tryon receipt entry before Pruna is named; the plan doc says check_photo_quality is built", () => {
  const md = read("docs/DEMO.md");
  const v7 = md.slice(md.indexOf("## Re-render script v7"), md.indexOf("## Rules for record day"));
  assert.match(read("SUBMISSION.md"), /the written specification and config boilerplate only/);
  assert.match(v7, /\nPrior work: the written specification and config boilerplate only\. Everything you see running was coded during the hackathon, from 27 Oct \(first commit 15658a4\)\. git log is public\.\n/);
  assert.doesNotMatch(md, /spec document only/);
  // AGW10 (Grok 00:05 1 Nov): the build range stays open-ended, like SUBMISSION ("from 15658a4 on"), so 1 Nov+ commits cannot make it untrue.
  assert.doesNotMatch(v7, /27\s*[–-]\s*31 Oct|by 31 Oct/);
  assert.match(read("SUBMISSION.md"), /from 15658a4 on/);
  const beat3 = v7.split("\n").find((l) => l.startsWith("| 3 Results"))!;
  const cells = beat3.split("|").map((c) => c.trim());
  assert.match(cells[3]!, /^From 1:10, before Pruna is named: the receipt caption \(below\)/);
  assert.match(cells[3]!, /No try-on image, no person in frame/);
  assert.match(cells[4]!, /Pruna \(via Replicate\)/);
  const caption = /\nReceipt (evidence\/tryon\/[^ ,]+), entry (\d+): render, provider replicate-pruna-tryon, model ([^,]+), prediction ([a-z0-9]+)\. Gate: (\w+) \((\w+)\)\.\n/.exec(v7);
  assert.ok(caption, "the beat 3 receipt caption is in the v7 section");
  const entries = read(caption[1]!).trim().split("\n").map((l) => JSON.parse(l));
  const render = entries[Number(caption[2])];
  assert.equal(render.kind, "render");
  assert.equal(render.payload.provider, "replicate-pruna-tryon");
  assert.equal(render.payload.model, caption[3]);
  assert.equal(render.payload.prediction_id, caption[4]);
  const gate = entries.find((e) => e.kind === "gate");
  assert.equal(gate.payload.decision, caption[5]);
  assert.equal(gate.payload.cited.rule, caption[6]);
  const plan = read("docs/EVIDENCE_CHECKING_PLAN.md").replace(/\s+/g, " ");
  assert.doesNotMatch(plan, /Nothing measures blur or resolution today/);
  assert.match(plan, /Built since: the agent's local `check_photo_quality` \(`src\/agent\/quality\.ts`/);
  assert.match(plan, /Still plan: crop, which needs a garment mask/);
  assert.match(read("src/agent/quality.ts"), /crop: "not checked \(no garment mask\)"/);
});

test("wording 3: the DEMO.md v7 re-render script keeps the corrected claims, the prior-work card and each beat's word cap", () => {
  const md = read("docs/DEMO.md");
  const v7 = md.slice(md.indexOf("## Re-render script v7"), md.indexOf("## Rules for record day"));
  assert.ok(v7.length > 0, "the v7 section sits before the v6 rules");
  assert.match(v7, /0 of 5 AI try-ons released; every one held for review or refused, with the reason on the receipt/);
  assert.match(v7, /Pruna \(via Replicate\)/);
  assert.match(v7, /one RELEASE, three REVIEW and one REFUSE/);
  assert.match(v7, /npm run agent:demo/);
  assert.ok(v7.includes("Prior work: the written specification and config boilerplate only. Everything you see running was coded during the hackathon, from 27 Oct (first commit 15658a4). git log is public."));
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
