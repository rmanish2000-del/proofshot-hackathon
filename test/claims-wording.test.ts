import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseReceipt } from "../src/core.js";
import { FIGURE_DOCS, computeFigures } from "../src/figures.ts";
import { verifyChain } from "../src/receipt.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (doc: string) => readFileSync(join(root, doc), "utf8");
const CAVEAT = "(recorded 31 Oct self-comparison; would be REVIEW today)";

test("wording 1 (SC2r): every 31 Oct agent RELEASE in SUBMISSION and CLAIMS_AUDIT carries the self-comparison caveat on the same line", () => {
  const lines = [
    ...read("SUBMISSION.md").split("\n").map((l) => ["SUBMISSION.md", l] as const),
    ...read("CLAIMS_AUDIT.md").split("\n").map((l) => ["CLAIMS_AUDIT.md", l] as const),
  ];
  const claims = lines.filter(([, l]) =>
    /Resolved: 2 of 2|Recorded 31 Oct: 2 of 2 RELEASE|got both to RELEASE|REFUSE → RELEASE|2 of 2 with replacement and the label signal|^\| (Pink polo|Mustard kurta, re-run).*\*\*RELEASE\*\*/.test(l),
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
  assert.match(v7, /verbatim from the recorded voiceover/);
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
  // RV10: v8 is the video to submit; its reported length is UNVERIFIED and the v7 script is named superseded.
  const claim = `The v7 re-render script (its script runs ${without}, or ${withCard} with the optional end card) is superseded`;
  for (const doc of ["README.md", "SUBMISSION.md"]) {
    const text = read(doc).replace(/\s+/g, " ");
    assert.ok(text.includes(claim), `${doc} names the v7 script superseded`);
    // RV17: no committed file gives the length, so it is UNVERIFIED, not attributed to a reporter.
    assert.match(text, /167\.9 s \(about 2:48\); the rendered file is not committed and no committed file gives that length, so it is UNVERIFIED here/, doc);
    assert.doesNotMatch(text, /as reported by Grok/, doc);
    assert.doesNotMatch(text, /about 2\.5 minutes|Demo script \(76 s\)/, doc);
    for (const m of text.matchAll(/76 s/g)) {
      const around = text.slice(Math.max(0, m.index! - 160), m.index! + 40);
      assert.match(around, /v6|clone \+ `npm ci`/, `${doc}: '76 s' not labelled v6: ${around}`);
    }
  }
  assert.match(md.replace(/\s+/g, " "), /v6 capture timing 76 s \(the video to submit is v9, above: 172\.1 s, UNVERIFIED here\)/); // FIN1
  assert.doesNotMatch(md, /as reported by Grok/);
});

test("wording 11 (Grok 23:45, AGW9): the v7 prior-work caption says what SUBMISSION says; beat 3 shows a replicate-pruna-tryon receipt entry before Pruna is named; the plan doc says check_photo_quality is built", () => {
  const md = read("docs/DEMO.md");
  const v7 = md.slice(md.indexOf("## Re-render script v7"), md.indexOf("## Rules for record day"));
  // DOC3 (2 Nov): SUBMISSION now names every prior-work item; the v7 caption below is kept as history.
  assert.match(read("SUBMISSION.md"), /Prior work: a written specification; two config files/);
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

test("wording 12 (Grok 05:40 1 Nov, VO1): no doc says whose voice the recorded voiceover is; the rest-of-v7 voice stays UNVERIFIED; the SUBMISSION header is current", () => {
  const skip = new Set(["node_modules", "out", ".git"]);
  const walk = (dir: string): string[] =>
    readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) => {
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) return skip.has(e.name) ? [] : walk(rel);
      return e.name.endsWith(".md") ? [rel] : [];
    });
  const docs = walk("");
  assert.ok(docs.includes("docs/DEMO.md") && docs.includes("CLAIMS_AUDIT.md"));
  for (const doc of docs) {
    const text = read(doc).replace(/\s+/g, " ");
    assert.doesNotMatch(text, /manish.{0,20}(voice|narrat)|\b(his|own) voice\b|voice: manish/i, doc);
  }
  const v7 = read("docs/DEMO.md").replace(/\s+/g, " ");
  // RV10: the voice is named for what it is, a generated Edge TTS voice; the rules question stays UNVERIFIED.
  assert.match(v7, /The narration audio is the recorded voiceover \(a generated Edge TTS voice, en-IN-PrabhatNeural\); nothing new is recorded for it\./);
  const row = read("CLAIMS_AUDIT.md").split("\n").find((l) => l.startsWith("| No new paid call was made for the video"))!;
  assert.match(row, /the v9 narration .* is the recorded voiceover, a generated Edge TTS voice \(en-IN-PrabhatNeural\), not a model API in this project; .* whether the rules allow a generated voice is \*\*UNVERIFIED\*\*/);
  // RV15 4: scoped to model and project API calls; the voice's cost is not in the repo, so it is not claimed.
  assert.match(row, /scoped: no new paid model or project API call/);
  assert.match(row, /whether that voice cost anything is not recorded in this repo \(\*\*UNVERIFIED\*\*\)/);
  assert.doesNotMatch(row, /not a paid call/);
  assert.doesNotMatch(row, /v3\/v3d/);
  const sub = read("SUBMISSION.md");
  assert.doesNotMatch(sub, /Updated 29 Oct 2026 from the Codex\s+review, on master after 7de2c9c/);
  assert.match(sub, /updated 1 Nov 2026, on master after 3d2f94e/);
});

test("CA1 1 (Grok 08:15 1 Nov): one byte of an entry's content breaks the chain, file layout does not; SUBMISSION, the pack README and CLAIMS_AUDIT say so", () => {
  const text = read("data/jobs/fixture-shirt-01/receipt.jsonl");
  assert.equal(verifyChain(parseReceipt(text)).ok, true);
  // Content: one byte of the first entry's time.
  const content = text.replace('"at":"2026-10-27T15:00:00.000Z"', '"at":"2026-10-27T15:00:01.000Z"');
  assert.notEqual(content, text);
  const broken = verifyChain(parseReceipt(content));
  assert.equal(broken.ok, false);
  assert.equal(broken.ok === false && broken.index, 0);
  // Layout: whitespace between tokens, key order, a blank line and an extra top-level field all still verify.
  const lines = text.split("\n");
  const first = JSON.parse(lines[0]!) as Record<string, unknown>;
  const reordered = JSON.stringify({ hash: first.hash, prev: first.prev, payload: first.payload, kind: first.kind, at: first.at, seq: first.seq, note: "added" });
  for (const layout of [text.replace('"seq":0,', '"seq": 0 ,'), [reordered, ...lines.slice(1)].join("\n"), text.replace("\n", "\n\n")]) {
    assert.notEqual(layout, text);
    assert.equal(verifyChain(parseReceipt(layout)).ok, true);
  }
  const scoped = /one byte of an entry's content/;
  assert.match(read("SUBMISSION.md"), scoped);
  assert.doesNotMatch(read("SUBMISSION.md"), /Change one byte of the receipt/);
  assert.match(read("evidence/pack/README.md"), /Change one byte of an entry's content/);
  const row = read("CLAIMS_AUDIT.md").split("\n").find((l) => l.startsWith("| Change one byte and it says TAMPERED"))!;
  assert.match(row, /\*\*weak, scoped \(CA1\)\*\*/);
  assert.match(row, /whitespace between JSON tokens, key order, blank lines/);
});

test("CA1 2: CLAIMS_AUDIT does not lean on the gitignored judge-run file or a stale line range", () => {
  const audit = read("CLAIMS_AUDIT.md");
  for (const l of audit.split("\n").filter((l) => l.includes("out/final/JUDGE_RUN.md"))) {
    assert.match(l, /gitignored local build folder/, l.slice(0, 80));
  }
  assert.doesNotMatch(audit, /`src\/gate\.ts` lines 39-48/);
  assert.match(audit, /`src\/gate\.ts` `decide\(\)` \(lines 44-55/);
  assert.match(read("src/gate.ts").split("\n")[43]!, /^export function decide\(/);
  assert.doesNotMatch(audit, /was not observed in our committed runs/);
});

test("RM2 1 (Grok 12:15 1 Nov): README names the verifier each env var selects, and says serve wires only Baseten, as the scripts do", () => {
  const readme = read("README.md");
  assert.doesNotMatch(readme, /Live verifier: Muse Spark Open on Baseten/);
  assert.doesNotMatch(readme, /With `BASETEN_API_KEY` set\s+the verifier is Muse Spark Open/);
  assert.match(readme, /Live verifier today: Muse Spark 1\.3 on the Meta Model API/);
  assert.match(readme, /`VERIFIER_PROVIDER=meta` with `MODEL_API_KEY`: the verifier today/);
  assert.match(readme, /First verifier: Muse Spark Open on Baseten/);
  // The claims hold only while the scripts do this: job:live gives the Meta verifier a fetch, serve does not.
  assert.match(read("scripts/live-job.ts"), /metaVerifierFetch:/);
  assert.doesNotMatch(read("scripts/serve.ts"), /metaVerifierFetch/);
  assert.match(read("src/serve.ts"), /env\.VERIFIER_PROVIDER/);
});

test("RM2 2: README says openai-images, fal and meta need an injected transport, and serve and job:live default to stand-in", () => {
  const readme = read("README.md");
  assert.doesNotMatch(readme, /`openai-images` \(the default\), `fal`/);
  assert.match(readme, /`openai-images`,\s+`fal` and `meta` need an injected transport today/);
  assert.match(read("src/serve.ts"), /\|\| "stand-in";/);
  assert.match(read("src/render.ts"), /\|\| "openai-images";/);
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

test("RM4 (Grok 18:30 1 Nov): README cites call logs, names the demo jobs, says what the keyless capture proves; no private-issue cite in SUBMISSION; DEMO.md says v7 is current", () => {
  const readme = read("README.md");
  const flat = readme.replace(/\s+/g, " ");
  assert.doesNotMatch(flat, /no generative render transport exists/);
  assert.match(flat, /only the Pruna try-on is written/);
  assert.doesNotMatch(flat, /No new paid call was made for the video/);
  assert.match(flat, /`providersFromEnv\(\{\}\)` in `scripts\/demo-capture\.ts`/);
  assert.match(read("scripts/demo-capture.ts"), /const providers = providersFromEnv\(\{\}\);/);
  assert.doesNotMatch(flat, /every job in the demo video is one of those/);
  for (const job of ["ms2-shirt-plaid", "live-shirt-plaid-composite-v2-r3", "live-shirt-plaid-mismatch"]) {
    assert.match(flat, new RegExp(`shows three of them: .*\`${job}\``), job);
    assert.ok(readdirSync(join(root, "data/jobs")).includes(job), `${job} is committed`);
  }
  // The cited call logs exist and say what the README says of them.
  const v = read("evidence/verifier-2026-10-28T03-55-00-289Z.json");
  assert.match(v, /"max_tokens": 1500/);
  assert.match(v, /"finish_reason": "length"/);
  assert.match(flat, /`evidence\/verifier-2026-10-28T03-55-00-289Z\.json`/);
  const f = read("evidence/fireworks-2026-10-29T04-39-45-711Z.json");
  assert.match(f, /llama-v3p3-70b-instruct/);
  assert.match(f, /"status": 404/);
  assert.match(flat, /`evidence\/fireworks-2026-10-29T04-39-45-711Z\.json`/);
  const sub = read("SUBMISSION.md");
  assert.doesNotMatch(sub, /SP1 list on #23/);
  assert.match(sub.replace(/\s+/g, " "), /seven of them, cases 2 to 6, 11 and 12, need a real phone photo/);
  assert.match(read("docs/DEMO.md").split("## What exists today")[0]!.replace(/\s+/g, " "), /Current status .* v7 re-render script below .* still drive `npm run demo:capture`/);
});

test("RV2 (Grok 19:50 1 Nov): today's agent verdict beside the recorded one, scoped pack/fidelity sentences, tail truncation qualified, JUDGE_QA_GATE numbers are the figures", () => {
  const sub = read("SUBMISSION.md").replace(/\s+/g, " ");
  const readme = read("README.md").replace(/\s+/g, " ");
  assert.doesNotMatch(sub, /Resolved: 2 of 2/);
  assert.match(sub, /Today's gate: 0 of 2 RELEASE, both REVIEW/);
  assert.match(sub, /same tree SHA before and after/);
  assert.match(sub, /`by_expected\.same` \(`answered` 30, `correct` 24\)/);
  assert.match(sub, /actions\/runs\/\d+\), green on [0-9a-f]{7} at \d+ tests/);
  assert.match(sub, /`test\/render\.test\.ts` "a Muse Image model is refused on every provider before any request"/);
  assert.match(read("test/render.test.ts"), /test\("a Muse Image model is refused on every provider before any request"/);
  assert.match(readme, /every receipt in `data\/jobs` that has a render/);
  assert.match(readme, /on the <!--f:tryon_total-->7<!--\/f--> committed kurta try-on jobs those 21 checks were run on/);
  assert.match(readme, /quote the pack-only counts/);
  // A chain cut short at the end still verifies; no doc says the chain alone catches any deleted entry.
  for (const doc of ["README.md", "docs/JUDGE_QA_TAMPER.md", "docs/JUDGE_QA_GATE.md", "evidence/pack/README.md", "web/verify.html"]) {
    const text = read(doc).replace(/\s+/g, " ");
    assert.doesNotMatch(text, /reordered or deleted (entry|line)|reordering and deleted lines/, doc);
  }
  assert.match(readme, /Entries cut off the end leave a shorter chain that still verifies/);
  assert.match(read("docs/JUDGE_QA_TAMPER.md").replace(/\s+/g, " "), /the recorded voiceover still says/);
  const gate = read("docs/JUDGE_QA_GATE.md").replace(/\s+/g, " ");
  const f = computeFigures(root);
  for (const n of [`${f.muse13_calls} logged calls`, `plus ${f.muse13_calls_runs} in`, `${f.baseten_calls} logged calls`, `${f.cal_cases} labelled renders`, `${f.ms4_changed_passed} checks`, `reproduced ${f.cal_reproduced}`, `${f.cal_false_refuse} false refusals`]) {
    assert.ok(gate.includes(n), `JUDGE_QA_GATE says '${n}'`);
  }
  assert.match(gate, /three settings over time: 1500, then 4096, then 8192 with one retry at 16384/); // RV7 4
  assert.doesNotMatch(gate, /cannot catch verifier misses like length changes alone/);
});

test("RV3 (Grok 20:00 1 Nov): tail cut named with git history, append-only is a convention, receipt counts as figures, try-on and models Q and A cites what exists", () => {
  const tamper = read("docs/JUDGE_QA_TAMPER.md").replace(/\s+/g, " ");
  const readme = read("README.md").replace(/\s+/g, " ");
  assert.match(tamper, /deleting the last entries leaves a shorter file that still verifies, and only the git history shows it/);
  assert.match(readme, /Entries cut off the end leave a shorter chain that still verifies, and only the git history shows the cut/);
  assert.match(tamper, /no enforced append-only store and no external witness \("append-only" in the README is a write convention/);
  assert.match(readme, /append-only by convention/);
  // Q4 reads like the README Receipts row, with the same markers.
  for (const key of ["jobs", "renders", "chains", "receipts_no_render", "receipts", "receipt_chains"]) assert.ok(tamper.includes(`<!--f:${key}-->`), `Q4 marks ${key}`);
  assert.doesNotMatch(tamper, /this file is not wired into figures/);

  const qa = read("docs/JUDGE_QA_TRYON_MODELS.md");
  const flat = qa.replace(/\s+/g, " ");
  assert.match(readme, /`docs\/JUDGE_QA_TAMPER\.md` \(the tamper check and receipt chains\), `docs\/JUDGE_QA_TRYON_MODELS\.md`/);
  // Every README heading the file cites exists.
  const headings = new Set(read("README.md").split("\n").filter((l) => /^#{2,3} /.test(l)).map((l) => l.replace(/^#+ /, "")));
  for (const m of flat.matchAll(/README "([^"]+)"/g)) assert.ok(headings.has(m[1]!), `README has a section "${m[1]}"`);
  // The thresholds quoted are the ones in config/fidelity.json.
  const t = JSON.parse(read("config/fidelity.json")) as Record<string, Record<string, number>>;
  assert.ok(flat.includes(`\`delta_e\` (REVIEW above ${t.delta_e!.review_above}, REFUSE above ${t.delta_e!.refuse_above})`));
  assert.ok(flat.includes(`\`hist\` (REVIEW above ${t.hist!.review_above}, REFUSE above ${t.hist!.refuse_above})`));
  assert.ok(flat.includes(`\`texture\` similarity (REVIEW below ${t.texture!.review_below}, REFUSE below ${t.texture!.refuse_below})`));
  assert.ok(flat.includes(`(REVIEW below ${t.area!.review_below} or above ${t.area!.review_above})`));
  assert.match(read("src/fidelity.ts"), /the garment shrank in frame/, "area is the shrink metric");
  // Cited tests exist with those names.
  assert.match(read("test/render.test.ts"), /test\("a Muse Image model is refused on every provider before any request"/);
  assert.match(read("test/serve.test.ts"), /was REVIEW, not RELEASE/);
  // Pack counts are labelled as pack counts beside the all-logs totals; 21 checks are over the 7 kurta try-ons.
  assert.match(flat, /are evidence-pack counts/);
  assert.ok(qa.includes("<!--f:sam_calls_all-->") && qa.includes("<!--f:muse13_calls_all-->"));
  assert.match(flat, /the 21 checks are over those <!--f:tryon_total-->7<!--\/f--> jobs/);
  assert.match(flat, /first commit was 4aa99f9 before/);
  assert.match(flat, /`15658a4`, on 27 Oct 2026 at 11:10 IST/);
  assert.match(flat, /not a provider bill/);
  assert.match(flat, /not a Replicate invoice/);
});

test("RV4 (Grok 20:10 1 Nov): the public Space is named, no 'No public deploy', the agent log is outside the gate chain, agent:real cost is the report's ledger delta", () => {
  const readme = read("README.md").replace(/\s+/g, " ");
  const sub = read("SUBMISSION.md").replace(/\s+/g, " ");
  const URL_ = "https://rmanish2000-proofshot.hf.space/";
  for (const [name, text] of [["README.md", readme], ["SUBMISSION.md", sub]] as const) {
    assert.doesNotMatch(text, /No public deploy/i, name);
    assert.ok(text.includes(`**Live demo:** ${URL_}`), `${name} names the live demo`);
    assert.match(text, /Which build and which providers the Space runs is not read from the Space repo/, `${name} says what was not checked`);
  }
  assert.ok(readme.indexOf(URL_) < readme.indexOf("## What each Meta model does"), "near the top of README");
  assert.match(readme, /## Keyless static demo \(`out\/static-demo\/`, not hosted\)/);
  // Agent steps: a separate hash-chained agent.jsonl, not the gate receipt; said as a limit.
  assert.match(readme, /go into a separate file per job, `records\/<seller>\/<job>\/agent\.jsonl`/);
  assert.match(readme, /the replacement is not inside the gate's hash chain/);
  assert.match(read("src/agent/store.ts"), /agent\.jsonl\s+the agent section, hash-chained like a receipt/);
  assert.match(read("src/agent/service.ts"), /event: "replaced_primary"/);
  // agent:real cost is the report's own field.
  const real = JSON.parse(read("evidence/agent-real-2026-10-30.json")) as { meta_spend_usd_this_run: number; metrics: { spend_usd: number } };
  assert.ok(readme.includes(`moved the Meta ledger by ${real.meta_spend_usd_this_run} USD`));
  assert.ok(readme.includes(`budget estimate of ${real.metrics.spend_usd} USD`));
  for (const [file, usd] of [["evidence/agent-replace-2026-10-31.json", "0.0756"], ["evidence/agent-replace-2026-10-31-label.json", "0.0433"]] as const) {
    assert.equal(String((JSON.parse(read(file)) as { meta_spend_usd_this_run: number }).meta_spend_usd_this_run), usd, file);
  }
});

test("RV6 (Grok 23:41 1 Nov): README by-eye check names all 4, photo count matches the upload page, suite time is the measured range, the 3-step browser check is dated", () => {
  const readme = read("README.md").replace(/\s+/g, " ");
  const limit = readme.slice(readme.indexOf("**Small sample.**"), readme.indexOf("**Verifier accuracy is not measured"));
  assert.match(limit, /by eye none of the 5 is any of the 4 \(kurta-01, kurta-02, shirt-plaid, shirt-zebra;/);
  assert.doesNotMatch(readme, /none of the 5 is kurta-01 or kurta-02/);
  assert.doesNotMatch(readme, /three or four of them/);
  assert.match(read("web/upload.html"), /const MAX_PHOTOS = 3;/);
  assert.match(readme, /\(up to three; the upload page takes one to three JPEGs, and the server refuses a fourth: `test\/serve\.test\.ts` "RV17: the upload API takes one to three photos and refuses a fourth with 400"\)/);
  assert.doesNotMatch(readme, /about five minutes/);
  assert.match(readme, /measured 316 s to 423 s on one laptop/);
  assert.match(read("SUBMISSION.md"), /`npm test` 316 s to 423 s on the same laptop/);
  assert.match(readme, /through the 3-step form \(the 29 Oct page, before UX-EASY1 made it two steps: Photos, Result;/);
});

test("RV7 (Grok 00:06 2 Nov): two-step upload page and the public Space in README and SUBMISSION; JUDGE_QA_GATE and JUDGE_QA_TAMPER say what the code and tests show", () => {
  const readme = read("README.md").replace(/\s+/g, " ");
  const sub = read("SUBMISSION.md").replace(/\s+/g, " ");
  // 1: the upload paragraph.
  assert.doesNotMatch(readme, /seller upload page with the five-step board/);
  assert.doesNotMatch(readme, /The seller upload page is local only/);
  assert.match(readme, /two steps since UX-EASY1: Photos, then Result/);
  assert.match(readme, /local in this repo \(`npm run serve`\); the public Space is named at the top \("Live demo"\), and what it runs is UNVERIFIED here/);
  // 2 and 3: the no-install option.
  const q = sub.slice(sub.indexOf("*What can I run without a key?*"));
  assert.match(q.slice(0, 400), /With no install, the Live demo Space, https:\/\/rmanish2000-proofshot\.hf\.space\/ \(which build and providers it runs is UNVERIFIED here/);
  const quick = readme.slice(readme.indexOf("## Quick start"), readme.indexOf("## Quick verify"));
  assert.match(quick, /No install: the Live demo line at the top names the public Space \(what it runs is UNVERIFIED here\)/);
  // 4-7: JUDGE_QA_GATE.
  const gate = read("docs/JUDGE_QA_GATE.md").replace(/\s+/g, " ");
  assert.doesNotMatch(gate, /two settings at two times|usable answer/);
  assert.match(gate, /<!--f:ms4_wrong_refused-->153 of 153<!--\/f--> wrong-garment runs and released <!--f:ms4_same_released-->24 of 30<!--\/f--> same-garment runs/);
  assert.match(readme, /refused <!--f:ms4_wrong_refused-->153 of 153<!--\/f--> wrong-garment runs and released <!--f:ms4_same_released-->24 of 30<!--\/f-->/);
  const tamper = read("docs/JUDGE_QA_TAMPER.md").replace(/\s+/g, " ");
  const cut = /NOT RELEASED for that image \(or TAMPERED, in no entry, if its `render` entry is cut too\), never VALID/;
  for (const [name, text] of [["README.md", readme], ["docs/JUDGE_QA_GATE.md", gate], ["docs/JUDGE_QA_TAMPER.md", tamper]] as const) assert.match(text, cut, name);
  // 8: the layout cases are cited to the test that checks them, and that test still names all four.
  assert.match(tamper, /`test\/claims-wording\.test\.ts` "CA1 1" checks each of the four/);
  assert.match(read("test/claims-wording.test.ts"), /Layout: whitespace between tokens, key order, a blank line and an extra top-level field all still verify/);
  // 9: NOT RELEASED needs a render entry; otherwise TAMPERED, as checkImageWith does.
  assert.match(tamper, /NOT RELEASED when a matching `render` entry exists, and TAMPERED otherwise/);
  assert.match(read("src/core.js"), /return no\("this image is in no entry of this record"\)/);
});

test("RV8 (Grok 00:15 2 Nov): upload page says up to 3 and has a fixture-mode findings lead; README 2 of 2 carries today's caveat and the 0.0756 run cost; SUBMISSION gate_head and 0.1058; DEMO try-on row scoped", () => {
  // 1: up to 3 photos, EN and HI, matching MAX_PHOTOS.
  const page = read("web/upload.html");
  assert.match(page, /const MAX_PHOTOS = 3;/);
  assert.match(page, /drop: "Drop up to 3 phone photos of one garment"/);
  assert.match(page, /drop: "एक कपड़े की 3 तक फ़ोन तस्वीरें यहाँ छोड़ें"/);
  // 2: the findings lead follows mode.fixture, as the banner does; both languages have both texts.
  assert.match(page, /readLeadFixture: "The findings recorded on the receipt for each attribute; fixture mode, not judged by a model\."/);
  assert.equal([...page.matchAll(/readLeadFixture: "/g)].length, 2);
  assert.equal([...page.matchAll(/readLead: "/g)].length, 2);
  assert.match(page, /mode && mode\.fixture \? T\(\)\.readLeadFixture : T\(\)\.readLead/);
  // 3, 4: README.
  const readme = read("README.md").replace(/\s+/g, " ");
  assert.match(readme, /That first replace run cost 0\.0756 USD and resolved 1 of 2/);
  assert.doesNotMatch(readme, /missed the verifier's wording \(0\.0756 USD\)/);
  assert.match(readme, /2 of 2 with the label \(recorded 31 Oct against a stand-in render that is the new photo 1; today's gate says REVIEW for both: the SC1 self-comparison check, SUBMISSION\.md "Self-comparison on this path, closed after the run"\)/);
  const sub = read("SUBMISSION.md").replace(/\s+/g, " ");
  assert.match(sub, /\*\*Self-comparison on this path, closed after the run \(SC1, 31 Oct\)\.\*\*/);
  assert.equal(String((JSON.parse(read("evidence/agent-replace-2026-10-31.json")) as { meta_spend_usd_this_run: number }).meta_spend_usd_this_run), "0.0756");
  // 5, 6: SUBMISSION.
  assert.match(sub, /the final gate decision by reference: its final entry copies the last run's decision and names that run's receipt head \(`gate_head`\); it is not a gate receipt entry/);
  assert.match(read("src/agent/runner.ts"), /event: "final".*gate_decision: latestDecision\(\), gate_head:/);
  assert.doesNotMatch(sub, /\b0\.106\b/);
  assert.match(sub, /Cost: 4 live gate runs, 0\.1058 USD on the Meta ledger/);
  assert.match(sub, /\(0\.1058 \+ 0\.0756 \+ 0\.0433 \+ 0\.2277\)/);
  // 7: DEMO.md generated-image row (also checked against the receipts in test/demo-capture.test.ts).
  const gen = read("docs/DEMO.md").split("\n").find((l) => l.startsWith("| A generated on-model image"))!;
  assert.match(gen, /on 29 Oct \(v6\) 7 live try-on receipts were committed/);
  assert.match(gen, /so 12 now \(10 kurta, 2 shirt, as in the Status line above\), all held/);
});

test("RV9 (Grok 00:23 2 Nov): JUDGE_QA_TRYON_MODELS cites config/fidelity.json and its UNCALIBRATED note for the thresholds, the badge text where it is defined, 19 as verifier calls, and scopes the image sources", () => {
  const qa = read("docs/JUDGE_QA_TRYON_MODELS.md").replace(/\s+/g, " ");
  // 1: the numbers' source is the config file, and its note is quoted as it stands.
  const note = (JSON.parse(read("config/fidelity.json")) as { _note: string })._note;
  assert.ok(note.startsWith("Starting values, UNCALIBRATED (SPEC section 10)."));
  assert.match(qa, /the threshold numbers are `config\/fidelity\.json`, whose `_note` marks them "Starting values, UNCALIBRATED \(SPEC section 10\)"/);
  // 2: the badge text is the page's own.
  const page = read("web/upload.html");
  assert.match(page, /REVIEW: "REVIEW: a person must look first", REFUSE: "REFUSE: not released"/);
  assert.match(qa, /`badge` in `web\/upload\.html`: "REVIEW: a person must look first", "REFUSE: not released"/);
  // 3: 19 are verifier calls; the smoke calls are apart.
  assert.match(qa, /<!--f:baseten_calls-->19<!--\/f--> verifier calls in `evidence\/verifier-\*\.json`; the two `npm run call:baseten` smoke calls in `evidence\/baseten-\*\.json` are not among them/);
  // 4: the same scope as README's opening.
  assert.match(qa, /The candidate images in the committed runs come from the composite/);
  assert.match(read("README.md").replace(/\s+/g, " "), /The candidate images in the committed runs come from two paths/);
});

test("RV10 (Grok 07:20 2 Nov): no doc says the voice is not synthesized or is a person's own; v8 is the video, its spoken figures match the generated ones, and the video link is one token", () => {
  // 5: the docs guard, over README, SUBMISSION, CLAIMS_AUDIT and every docs/*.md (DEMO.md among them).
  const docs = ["README.md", "SUBMISSION.md", "CLAIMS_AUDIT.md", ...readdirSync(join(root, "docs")).filter((f) => f.endsWith(".md")).map((f) => `docs/${f}`)];
  assert.ok(docs.includes("docs/DEMO.md"));
  for (const doc of docs) {
    const text = read(doc).replace(/\s+/g, " ");
    assert.doesNotMatch(text, /no synthesi[sz]ed audio|Manish's voice|Manish's recorded|own voice/i, doc);
  }
  // 1: the checklist and the voice line say what the voice is.
  const md = read("docs/DEMO.md");
  assert.ok(md.includes("- [ ] The recorded voiceover: a generated Edge TTS voice (en-IN-PrabhatNeural)."));
  assert.match(md.replace(/\s+/g, " "), /Voice: the recorded voiceover \(a generated Edge TTS voice, en-IN-PrabhatNeural; whether the rules allow it is UNVERIFIED\)/);
  // 2: the v8 section (superseded by v9 on 3 Nov, FIN1) has the 46 spoken lines, and v7 is marked superseded.
  const v8 = md.slice(md.indexOf("## v8 (superseded 3 Nov)"), md.indexOf("## What exists today"));
  assert.ok(md.indexOf("## v9: the video to submit") < md.indexOf("## v8 (superseded 3 Nov)"));
  assert.ok(md.indexOf("## v8 (superseded 3 Nov)") < md.indexOf("## Re-render script v7"));
  const spoken = v8.split("### v8 fact check")[0]!.split("\n").filter((l) => /^\| \d \| /.test(l));
  assert.equal(spoken.length, 46);
  assert.match(md, /## Re-render script v7 \(31 Oct, for the out\/final video\)\n\nSuperseded on 2 Nov by v8 \(above\); kept as history\./);
  // The figures v8 speaks are the generated ones today.
  const f = computeFigures(root);
  const words: Record<string, string> = { "10": "Ten", "12": "twelve", "2": "two", "43": "forty-three" };
  assert.equal(f.tryon_all_total, "12");
  assert.ok(v8.includes(`| 5 | Across our runs, ${words[f.tryon_all_total]} AI try-on images were generated. | Across our runs, ${f.tryon_all_total} AI try-on images were generated. |`));
  assert.ok(v8.includes(`| 5 | ${words[f.tryon_all_refuse!]} refused, ${words[f.tryon_all_review!]} sent for review. | ${f.tryon_all_refuse} refused, ${f.tryon_all_review} sent for review. |`));
  assert.equal(f.receipt_chains, `${f.receipts} of ${f.receipts}`);
  assert.ok(v8.includes(`| 6 | All ${words[f.receipts!]} committed receipts verify. | All ${f.receipts} committed receipts verify. |`));
  assert.match(v8, /matches for the 31 Oct try-on run only; UNVERIFIED as a statement about every committed run/);
  assert.doesNotMatch(v8, /\b\d{3} tests\b/);
  // 3: one token for the link in both files; the voice is no longer TBD.
  const sub = read("SUBMISSION.md");
  assert.match(sub, /\*\*Demo video:\*\* https:\/\/youtu\.be\/JSzJBOU11sA \(v9 final cut, 172\.1 s; replaces v8 https:\/\/youtu\.be\/cOeRYwRZBlA\)\n/); // FIN1, VID3
  assert.doesNotMatch(sub, /YOUTUBE_URL_TBD|which voice the rest of the v7 narration uses/);
  assert.match(read("README.md"), /\*\*Video:\*\* https:\/\/youtu\.be\/JSzJBOU11sA \(v9 final cut, 172\.1 s, 1920x1080;/);
  // VID1: the token is gone everywhere it was.
  for (const doc of ["SUBMISSION.md", "README.md", "docs/SUBMIT_CHECKLIST.md", "docs/DEMO.md"]) {
    assert.doesNotMatch(read(doc), /VIDEO_URL_PENDING/, doc);
  }
  // 4: the tamper weak spot quotes v8.
  const tamper = read("docs/JUDGE_QA_TAMPER.md").replace(/\s+/g, " ");
  assert.match(tamper, /in v8 the recorded voiceover still says "Now change a single byte\." with no scope/);
  assert.ok(v8.includes("| 6 | Now change a single byte. |"));
});

test("RV11 (Grok 07:20 2 Nov): the submit checklist maps each form field to its source, its figures are generated, and README's first 30 lines give the demo, video, offline verify and a 3-command quickstart", () => {
  const list = read("docs/SUBMIT_CHECKLIST.md");
  assert.ok((FIGURE_DOCS as readonly string[]).includes("docs/SUBMIT_CHECKLIST.md"), "figure drift fails figures 2");
  for (const key of ["tests", "receipt_chains", "tryon_all_total", "tryon_all_refuse", "tryon_all_review", "muse13_calls_all", "baseten_calls", "pruna_all_usd_est"]) {
    assert.ok(list.includes(`<!--f:${key}-->`), `the figures table marks ${key}`);
  }
  assert.ok(list.includes("| Demo video | https://youtu.be/JSzJBOU11sA |")); // VID3
  assert.doesNotMatch(list, /v8 upload is a human step/);
  assert.match(list, /\| Live demo \| https:\/\/rmanish2000-proofshot\.hf\.space \| .*UNVERIFIED/);
  assert.match(list, /\| X post \| pending \| a human step/);
  // Every SUBMISSION section the list cites exists, and every bold field it cites is in SUBMISSION.
  const sub = read("SUBMISSION.md");
  const headings = new Set(sub.split("\n").filter((l) => l.startsWith("## ")).map((l) => l.slice(3)));
  for (const m of list.matchAll(/SUBMISSION\.md "([^"]+)"/g)) assert.ok(headings.has(m[1]!), `SUBMISSION has "${m[1]}"`);
  for (const m of list.matchAll(/SUBMISSION\.md(?: "[^"]+",)? \*\*([^*]+)\*\*/g)) assert.ok(sub.includes(`**${m[1]}:**`) || sub.includes(`**${m[1]}**`), `SUBMISSION has **${m[1]}**`);
  // README first screen: moved, not new.
  const top = read("README.md").split("\n").slice(0, 30).join("\n");
  assert.match(top, /\*\*Live demo:\*\* https:\/\/rmanish2000-proofshot\.hf\.space\//);
  assert.match(top, /\*\*Video:\*\* https:\/\/youtu\.be\/JSzJBOU11sA /); // VID3
  assert.match(top, /\*\*Verify a receipt offline:\*\* `web\/verify\.html` makes no network request/);
  assert.match(top, /```\nnpm ci\nnpm run serve\nnpm test +# long-running[^\n]*\n```/); // RV15 2: npm test last, labelled
  assert.equal([...read("README.md").matchAll(/https:\/\/youtu\.be\/cOeRYwRZBlA/g)].length, 1, "the superseded v8 URL once in README");
});

test("RV12 (Grok 07:20 2 Nov, self red-team): SUBMISSION cites no uncommitted file as proof, the v8 on-screen content is UNVERIFIED, and the recording checklist says it is for v6", () => {
  const sub = read("SUBMISSION.md").replace(/\s+/g, " ");
  assert.match(read(".gitignore"), /^out\/$/m, "out/ is not committed");
  // Every SUBMISSION cite of out/final says it is not committed.
  for (const m of sub.matchAll(/`out\/final\/[^`]+`[^|]{0,120}/g)) assert.match(m[0], /not committed/, m[0]);
  assert.match(sub, /what v9, the video to submit, shows on screen is not recorded in this repository, so UNVERIFIED here/); // FIN1
  assert.doesNotMatch(sub, /\(v7 shows the 31 Oct verdict table/);
  const md = read("docs/DEMO.md").replace(/\s+/g, " ");
  assert.match(md, /## Recording checklist For the v6 capture\. For v9, the video to submit, the frames are not in this repository/); // FIN1
  // The v8 section (superseded 3 Nov) names eight beats, as SUBMISSION says.
  const beats = new Set(read("docs/DEMO.md").split("### v8 fact check")[0]!.split("## v8 (superseded 3 Nov)")[1]!.split("\n").filter((l) => /^\| \d \| /.test(l)).map((l) => l[2]));
  assert.equal(beats.size, 8);
  assert.match(sub, /The video to submit is v9 \(`docs\/DEMO\.md` "v9: the video to submit"\)/);
  assert.match(sub, /The v8 video \(eight beats, 167\.9 s/);
});

test("RV13 (Grok 08:05 2 Nov, DeepSeek CA2): CLAIMS_AUDIT scopes the shirts-only demo row to v6, deck and video counts to their date, and the concurrency row to AGENT_SCALING", () => {
  const ca = read("CLAIMS_AUDIT.md");
  const row = ca.split("\n").find((l) => l.includes("shows the two shirts only"));
  assert.ok(row, "demo row present");
  assert.match(row!, /^\| The v6 demo capture shows the two shirts only/);
  assert.match(row!, /\| proven for v6 only \|/);
  assert.match(row!, /What the v9 video \(the one to submit since 3 Nov, final cut, https:\/\/youtu\.be\/JSzJBOU11sA; v8 before it\) shows on screen is \*\*UNVERIFIED\*\* from the repo/); // FIN1, VID3
  assert.match(ca, /none released \(README, SUBMISSION; deck 6 and 7 and video C4 quote the earlier 7 of 7\)/);
  assert.match(ca, /they predate the 30–31 Oct run logs, so they show pack-only counts/);
  assert.match(ca, /held to its concurrent limit \(AGENT_SCALING\) \|/);
});

test("RV14 (Grok 09:00 2 Nov, DeepSeek RM6/SUB7/SC1): composite v2 default, v7 verdict table, port note, three mismatch jobs, SC1 gate wording, CI run, checklist pending", () => {
  const readme = read("README.md");
  assert.doesNotMatch(readme, /places\s+them on a ghost mannequin/);
  assert.match(readme, /by default v2 \(`src\/composite-v2\.ts`\), with no\s+body template, on a plain studio backdrop/);
  assert.match(readme, /`ms2-shirt-plaid`, a pipeline smoke example/);
  assert.match(readme, /the v7 re-render shows their verdict table, not the try-on images/);
  assert.match(readme, /\(Replace 8787 with your port in every step\.\)/);
  assert.doesNotMatch(readme, /One deliberate-mismatch\s+live job is committed/);
  assert.match(readme, /Three deliberate-mismatch\s+live jobs are committed, all \*\*REFUSE\*\*/);
  const jobs = readdirSync(join(root, "data/jobs")).filter((j) => j.includes("mismatch")).sort();
  assert.deepEqual(jobs, ["live-kurta-01-mismatch", "live-shirt-plaid-mismatch", "ms3-live-kurta-01-mismatch"]);
  for (const job of jobs) {
    const entries = read(`data/jobs/${job}/receipt.jsonl`).trim().split("\n");
    assert.match(entries[entries.length - 1]!, /"decision":"REFUSE"/, `${job} ends REFUSE`);
  }
  const sub = read("SUBMISSION.md");
  assert.doesNotMatch(sub, /The thresholds, the\s+gate rules and `src\/fidelity\.ts` are unchanged/);
  assert.match(sub, /the gate runner added this one check \(SC1\/SC2\),\s+which can only lower a RELEASE to REVIEW/);
  assert.doesNotMatch(sub, /41314918190/);
  assert.match(sub, /actions\/runs\/41505831456\), green on 2da6beb at 444 tests/); // RV17 2, RV20 nit, RV22 8: newest cited green run
  assert.doesNotMatch(sub, /41379178357|as reported by Grok/);
  const checklist = read("docs/SUBMIT_CHECKLIST.md");
  assert.doesNotMatch(checklist, /not in this repository \| SUBMISSION\.md \*\*Still TBD\*\*/);
  assert.match(checklist, /\| nothing prepared; SUBMISSION\.md \*\*Still TBD\*\* \|/); // RV16 4: not "pending"
});

test("RV16 (Grok 2 Nov): checklist Live demo names no build until the Space resync, spend has a cutoff, Anything else is not pending; SUBMISSION Still TBD drops the filled video link", () => {
  const checklist = read("docs/SUBMIT_CHECKLIST.md");
  const row = (name: string) => checklist.split("\n").find((l) => l.startsWith(`| ${name} |`))!;
  assert.match(row("Live demo"), /UNVERIFIED here .*the build commit is stated here only after the Space is resynced to the submission commit and the commit it runs is read/); // RV21 5
  assert.doesNotMatch(row("Live demo"), /Baseten|Meta Model API|Replicate|Fireworks|Muse Spark|SAM/);
  assert.match(row("Spend"), /ledger figures read on 29 Oct, .*the 30–31 Oct agent and try-on runs add about 0\.45 USD more/); // RV19 4: same as SUBMISSION
  const anything = row("Anything else (thumbnail, social links)");
  assert.doesNotMatch(anything, /pending/);
  assert.match(anything, /what the official form asks for in this field is not recorded in this repository \(UNVERIFIED\)/);
  assert.doesNotMatch(row("Demo video"), /human step/);
  const tbd = read("SUBMISSION.md").split("\n").find((l) => l.startsWith("**Still TBD:**"))!;
  assert.doesNotMatch(tbd, /video link/); // VID3: the v9 link is filled again
  assert.match(tbd, /whether the rules allow a generated voice is UNVERIFIED/);
});

test("SAMPLE1 (Grok 09:33 2 Nov): every doc paragraph about the sample shirt button calls it a recorded replay and never says it runs live or through the steps", () => {
  const docs = ["README.md", "SUBMISSION.md", "CLAIMS_AUDIT.md", ...readdirSync(join(root, "docs")).filter((f) => f.endsWith(".md")).map((f) => `docs/${f}`)];
  let seen = 0;
  for (const doc of docs) {
    for (const para of read(doc).split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " "))) {
      if (!/sample shirt|sample button/i.test(para)) continue;
      seen++;
      assert.match(para, /recorded/i, `${doc}: ${para.slice(0, 120)}`);
      assert.doesNotMatch(para, /through the same steps|uploads the committed|fixture-mode sample shirt|sample[^.|]{0,60}\b(is|runs) live\b/i, `${doc}: ${para.slice(0, 120)}`);
    }
  }
  assert.ok(seen >= 3, "README, SPEC and DEMO describe the button");
  const readme = read("README.md").replace(/\s+/g, " ");
  assert.match(readme, /"Recorded run from 2026-10-29, not live"/);
  assert.match(readme, /`data\/jobs\/ms2-shirt-zebra`/);
});

test("DOC3 + DOC2 (Grok 2 Nov): prior work names the pre-event model image and the prototype; audience is global; third-party licence texts ship", () => {
  const headline = /Prior work: a written specification; two config files \(`tsconfig\.json`, `\.gitignore`\); one AI-generated synthetic model image \(`data\/models\/synthetic-01\/model\.png`, generated 23 Oct 2026 for MirrorOS, a fictional adult, see its LICENSE\.md\), used only in try-on runs committed on 28 and 31 Oct and in Space jobs made before 2 Nov \(new jobs use `synthetic-02`, made during the event\); and an earlier private prototype \(`rmanish2000-del\/proofshot`, 24–26 Oct; tag `pre-hackathon-baseline`, 1485431\) whose code is not in this repository: the code here was rewritten from the specification from 27 Oct, not copied\./;
  const readme = read("README.md").replace(/\s+/g, " ");
  const sub = read("SUBMISSION.md").replace(/\s+/g, " ");
  assert.match(readme, headline);
  assert.equal([...sub.matchAll(new RegExp(headline.source, "g"))].length, 2, "SUBMISSION form line and Built during the event");
  for (const text of [readme, sub]) {
    assert.doesNotMatch(text, /config boilerplate only/);
    assert.match(text, /- One AI-generated synthetic model image, \[?`data\/models\/synthetic-01\/model\.png`/);
  }
  // The date the disclosure states is the one in the image's own provenance file.
  assert.match(read("data/models/synthetic-01/LICENSE.md"), /Generated 2026-10-23 00:48–00:56 UTC/);
  assert.doesNotMatch(read("CLAIMS_AUDIT.md"), /\| Prior work is the written specification and config boilerplate only/);
  // DOC2: India is an example, not the audience.
  assert.doesNotMatch(sub, /Indian boutique/);
  assert.equal([...sub.matchAll(/A seller anywhere, from a boutique in India to a market stall in Lagos, lists/g)].length, 3);
  assert.match(sub, /\*\*Theme:\*\* Build for Your World \(small sellers' listing images, anywhere; the seller page speaks the seller's own language, English and Hindi today; built and tested in India\)\./); // RV19 3
  // Licences: SAM License 1.b.i asks for a copy of the Agreement; the notices file carries both texts.
  const notices = read("THIRD_PARTY_NOTICES.md");
  assert.match(notices, /SAM License\nLast Updated: November 19, 2025/);
  assert.match(notices, /you shall provide a copy of this Agreement with any such SAM Materials\./);
  assert.match(notices, /8\. Modifications and Amendments\./);
  assert.match(notices, /Copyright \(c\) 2014, Eugene Ware/);
  assert.match(readme, /\[`THIRD_PARTY_NOTICES\.md`\]\(THIRD_PARTY_NOTICES\.md\)/);
  assert.equal(JSON.parse(read("package.json")).license, "MIT");
});

test("SYN2 (Grok 2 Nov): the try-on default is synthetic-02; synthetic-01 is scoped to the runs that name it; garment permission confirmed", () => {
  const readme = read("README.md").replace(/\s+/g, " ");
  assert.match(readme, /\(default `synthetic-02`, an AI-generated fictional adult made during the event/);
  assert.doesNotMatch(readme, /default `synthetic-01`/);
  for (const doc of ["README.md", "SUBMISSION.md"]) {
    assert.match(read(doc).replace(/\s+/g, " "), /since SYN2 the default is `synthetic-02`/, doc);
  }
  for (const g of ["shirt-plaid", "shirt-zebra"]) {
    const why = read(`data/garments/${g}/WHY.txt`);
    assert.doesNotMatch(why, /to confirm wording/, g);
    assert.match(why, /Confirmed by Manish Patel on 2 Nov 2026, 13:17 IST/, g);
  }
});

test("RV15 (Grok 2 Nov): Muse Spark 1.3 count scoped by model, npm test labelled long-running, chain-fix sentence qualified, 4096 cited, v8 receipt and go-live rows", () => {
  const qa = read("docs/JUDGE_QA_TRYON_MODELS.md").replace(/\s+/g, " ");
  assert.match(qa, /only the logs whose model is `muse-spark-1\.3`: `src\/figures\.ts` reads the pack stage `verify: muse-spark-1\.3 \(meta\)`/);
  assert.match(qa, /`verify: meta-models\/muse-spark-open-1026 \(baseten\)`, so none of them is among the <!--f:muse13_calls-->/);
  const stages = (JSON.parse(read("evidence/pack/summary.json")).stages as { stage: string }[]).map((s) => s.stage);
  assert.ok(stages.includes("verify: muse-spark-1.3 (meta)") && stages.includes("verify: meta-models/muse-spark-open-1026 (baseten)"));
  const quick = read("README.md").replace(/\r\n/g, "\n").split("```")[1]!;
  assert.match(quick, /npm ci\nnpm run serve\nnpm test +# long-running/);
  const tamper = read("docs/JUDGE_QA_TAMPER.md").replace(/\s+/g, " ");
  assert.doesNotMatch(tamper, /The chain fixes their order and content once written\./);
  assert.match(tamper, /Within this file, the chain fixes their order and content once written.* it is visible only in git history, with no outside witness\./);
  const gate = read("docs/JUDGE_QA_GATE.md").replace(/\s+/g, " ");
  assert.match(gate, /verifier-2026-10-28T12-30-54-012Z\.json`: its request has `max_tokens` 4096 and the answer `finish_reason` `length`/);
  const log = read("evidence/verifier-2026-10-28T12-30-54-012Z.json");
  assert.match(log, /"max_tokens": 4096/);
  assert.match(log, /"finish_reason": "length"/);
  const demo = read("docs/DEMO.md");
  assert.match(demo, /^\| Every decision is written into a hash-chained receipt \| matches for jobs run through `runJob` \|/m);
  assert.match(demo, /^\| Beat 8 closing line: an image whose truth is not proven does not go live \| design rule, not measured accuracy \|/m);
  const decisions: Record<string, string> = { "ms2-shirt-plaid": "RELEASE", "live-shirt-plaid-composite-v2-r3": "REVIEW", "live-shirt-plaid-mismatch": "REFUSE" };
  for (const [job, decision] of Object.entries(decisions)) {
    const entry = JSON.parse(read(`data/jobs/${job}/receipt.jsonl`).trim().split("\n")[5]!);
    assert.equal(entry.seq, 5, job);
    assert.equal(entry.kind, "gate", job);
    assert.equal(entry.payload.decision, decision, job);
  }
});

test("RV18 (Grok 2 Nov): SPEC 12 says intake, not the API, ends a non-JPEG job; prior-work lists name the prototype; Still TBD names the X post like the checklist", () => {
  const spec = read("docs/SPEC.md").replace(/\s+/g, " ");
  assert.match(spec, /a file that is not a JPEG is not checked by `POST \/api\/jobs`, which answers 202, so it is intake that ends the job, before the pipeline, with no receipt/);
  const qa = read("docs/JUDGE_QA_TRYON_MODELS.md").replace(/\s+/g, " ");
  assert.match(qa, /an earlier private prototype \(`rmanish2000-del\/proofshot`, 24–26 Oct 2026\), code not copied/);
  const sub = read("SUBMISSION.md").replace(/\s+/g, " ");
  assert.doesNotMatch(sub, /\*What was carried over\?\* Only `docs\/SPEC\.md`/);
  assert.match(sub, /\*What was carried over\?\* The only prior-work items in this repo are `docs\/SPEC\.md`.*the earlier private prototype's code is not here\./);
  const tbd = read("SUBMISSION.md").split("\n").find((l) => l.startsWith("**Still TBD:**"))!;
  assert.match(tbd, /the X post \(a human step;/);
  assert.match(read("docs/SUBMIT_CHECKLIST.md"), /^\| X post \| pending \| a human step/m);
});

test("RV19 (Grok 2 Nov): composite v2 is never a mannequin in SUBMISSION, SAM log locations, theme claims only EN+HI, checklist spend matches SUBMISSION, gate weak spot never reads as RELEASE", () => {
  const sub = read("SUBMISSION.md").replace(/\s+/g, " ");
  assert.doesNotMatch(sub, /mannequin/i);
  assert.equal(sub.match(/on a plain studio backdrop, no body template/g)?.length, 3, "long description, What it does, Built with");
  const readme = read("README.md").replace(/\s+/g, " ");
  assert.doesNotMatch(readme, /Every SAM call is logged under/);
  assert.match(readme, /SAM calls in the evidence pack are logged under `evidence\/sam-\*\.json`, and the 30-31 Oct run calls under `evidence\/<run>\/logs\/`\./);
  const theme = read("SUBMISSION.md").split("\n").find((l) => l.startsWith("**Theme:**"))!;
  assert.match(theme, /the seller page speaks the seller's own language, English and Hindi today; built and tested in India/);
  for (const doc of ["SUBMISSION.md", "README.md", "docs/SUBMIT_CHECKLIST.md"]) {
    assert.doesNotMatch(read(doc), /for example,? English and Hindi/i, doc);
  }
  const spendRow = (doc: string) => read(doc).split("\n").find((l) => l.startsWith("| Spend |"))!;
  const extra = "the 30–31 Oct agent and try-on runs add about 0.45 USD more (0.1058 + 0.0756 + 0.0433 + 0.2277)";
  assert.ok(spendRow("SUBMISSION.md").includes(extra));
  assert.ok(spendRow("docs/SUBMIT_CHECKLIST.md").includes(extra));
  assert.doesNotMatch(spendRow("docs/SUBMIT_CHECKLIST.md"), /later calls not included/);
  const gate = read("docs/JUDGE_QA_GATE.md").replace(/\s+/g, " ");
  assert.doesNotMatch(gate, /costs a RELEASE, not safety/);
  assert.match(gate, /a failed or cut-off call never releases an image; the cost is a lost release for the seller \(REFUSE\), not safety/);
});

test("RV20 (Grok 2 Nov): SPEC 12 states the serve.ts limits and routes, matching the code; DEMO prior-work row names the prototype", () => {
  const spec = read("docs/SPEC.md").replace(/\s+/g, " ");
  for (const claim of [
    /a request body over 40 MiB \(`MAX_BODY_BYTES`\) is 413/,
    /`parseUpload` refuses a note longer than 300 characters/,
    /optional `scenes` field names 1 to 3 scenes and defaults to `studio` \(`DEFAULT_SCENES`\)/,
    /`VERIFIER_PROVIDER=meta` with `MODEL_API_KEY` puts Muse Spark 1\.3 on the Meta Model API in place of Baseten/,
    /`PROOFSHOT_RENDER` wins over `RENDER_PROVIDER`/,
    /`GET \/api\/receipts` and `\/api\/receipts\/<id>`, with `\/verify`, `\/tamper` and `\/source\/<n>`/,
    /`GET` and `POST \/api\/jobs\/<id>\/correction`/,
    /`GET \/judge` \(`web\/judge\.html`\); and `\/shop\/\.\.\.`/,
  ]) assert.match(spec, claim);
  // The figures the paragraph states are the code's own.
  const serve = read("src/serve.ts");
  assert.match(serve, /export const MAX_BODY_BYTES = 40 \* 1024 \* 1024;/);
  assert.match(serve, /garment_note\.length > 300/);
  assert.match(serve, /scenes\.length > 3/);
  assert.match(serve, /DEFAULT_SCENES: readonly string\[\] = \["studio"\]/);
  assert.match(serve, /env\.PROOFSHOT_RENDER \?\? ""\)\.trim\(\) \|\| \(env\.RENDER_PROVIDER/);
  const row = read("docs/DEMO.md").split("\n").find((l) => l.startsWith("| Built during this hackathon, from 27 October"))!;
  assert.match(row, /the earlier private prototype \(`rmanish2000-del\/proofshot`, code not copied; RV20\)/);
});

test("RV21 (Grok 3 Nov): README installs with npm ci everywhere, SAM price and Muse Image policy reason UNVERIFIED, two-step page has its own browser row; checklist Live demo waits for the submission commit", () => {
  const readme = read("README.md");
  assert.doesNotMatch(readme, /^npm install$/m);
  assert.doesNotMatch(readme, /2\.50 USD/);
  assert.match(readme.replace(/\s+/g, " "), /SAM 3\.1 price UNVERIFIED/);
  assert.match(readme.replace(/\s+/g, " "), /The policy reason \(Meta's Geographic Use Policy excluding India\) is UNVERIFIED here/);
  const twoStep = readme.split("\n").find((l) => l.startsWith("| Two-step upload page (Photos, Result) in a real browser |"))!;
  assert.match(twoStep, /\*\*UNVERIFIED\*\*/);
  assert.doesNotMatch(twoStep, /\*\*checked\*\*/);
  const live = read("docs/SUBMIT_CHECKLIST.md").split("\n").find((l) => l.startsWith("| Live demo |"))!;
  assert.doesNotMatch(live, /67fda16/);
});

test("RV22 (Grok 3 Nov, DeepSeek CA4/RM10/SC6): synthetic-01 scope matches, Muse Image is the only policy refusal, steps qualified, verifier reads the chips, no intake entry, static demo needs an HTTP server, CLAIMS_AUDIT gaps", () => {
  const readme = read("README.md").replace(/\s+/g, " ");
  assert.doesNotMatch(readme, /remains only as the model named in the committed 31 Oct shirt receipts/);
  assert.match(readme, /`synthetic-01` remains only as the model named in the try-on receipts committed on 28 Oct \(kurtas\) and 31 Oct \(shirts\) and in Space jobs made before 2 Nov/);
  assert.doesNotMatch(readme, /Only that one model is not used/);
  assert.match(readme, /Muse Image is the only model refused by policy; the `openai-images`, `fal` and `meta` render transports are a separate gap: they are not written yet/);
  assert.doesNotMatch(readme, /as the providers actually return/);
  assert.match(readme, /stand-in renderer and fixture providers unless live keys are set/);
  assert.doesNotMatch(readme, /the agent reads nine attributes/);
  assert.match(readme, /the verifier \(Muse Spark in a live run; recorded, not judged, in fixture mode\) reads nine attributes/);
  // The receipt has no intake entry kind; intake hashes live in the job entry.
  for (const doc of ["README.md", "SUBMISSION.md", "CLAIMS_AUDIT.md"]) {
    assert.doesNotMatch(read(doc).replace(/\s+/g, " "), /(step|Every step) from intake to the gate/, doc);
  }
  assert.match(readme, /the intake photo hashes are recorded in the `job` entry's `source_images`/);
  assert.match(read("src/pipeline.ts"), /source_images,/);
  assert.doesNotMatch(readme, /It needs no server and no API key/);
  assert.match(readme, /no application server and no API key \(any static HTTP server works\)/);
  const audit = read("CLAIMS_AUDIT.md");
  assert.doesNotMatch(audit, /needs no server and no key/);
  assert.match(audit, /needs no application server and no API key \(any static HTTP server works/);
  assert.match(audit, /same garment released <!--f:ms4_same_released-->24 of 30<!--\/f-->; 65 of 68/);
  assert.equal([...audit.matchAll(/two chains, not linked into one|a separate chain from the gate receipt, not linked into one/g)].length, 2);
  assert.match(audit, /`test\/sample-replay\.test\.ts` \(zero provider calls counted/);
  assert.match(audit, /\| <!--f:tests-->\d+<!--\/f--> tests; CI runs them and gitleaks on every push \(README, SUBMISSION\) \|/);
});

test("FIN1 (Grok 3 Nov, Manish's decision): judge-facing texts lead with what was built during the event; v9 is the video to submit, v8 superseded", () => {
  const lead = "**All of ProofShot's code was written during the event, from 27 Oct 2026 (first commit [`15658a4`](https://github.com/rmanish2000-del/proofshot-hackathon/commit/15658a495f0f7469cc1de6fe025fec3bd7cf327e), 11:10 IST; the hackathon opened 26 Oct 2026, 21:30 IST).** The gate, the receipt chain, the verify page, the pipeline and the upload, judge and shop pages are all code in this repository. Disclosed prior work, listed below: the written specification the code was rewritten from (pre-event text published unchanged in `docs/prior-work/`), two config files (`tsconfig.json`, `.gitignore`), and one AI-generated sample model image (`synthetic-01`, used only in try-on runs committed on 28 and 31 Oct and in Space jobs made before 2 Nov; the final demo uses `synthetic-02`, made 28 Oct, during the event). An earlier private prototype's code is not in this repository.";
  const readme = read("README.md");
  const sub = read("SUBMISSION.md");
  const md = read("docs/DEMO.md");
  // 1a, 1f: under the title.
  assert.ok(readme.startsWith(`# ProofShot (hackathon build)\n\n${lead}\n\n**Live demo:**`));
  assert.ok(md.startsWith(`# ProofShot demo script v9 (proofshot-hackathon)\n\n${lead}\n\n`));
  // 1b, 1d: first paragraph of the built-during sections, the old text kept after it.
  assert.ok(readme.includes(`## Built during the event\n\n${lead}\n\nWork in this repository starts`));
  assert.ok(readme.includes("### Prior work used"));
  assert.ok(sub.includes(`## Built during the event and prior work\n\n${lead}\n\nWork in this`));
  // 1c: the paragraph leads with it and keeps the history note through the *(event)* sentence.
  const para = sub.split("\n").find((l) => l.startsWith("**Built during the hackathon:**"))!;
  assert.ok(para.startsWith(`**Built during the hackathon:** ${lead} (History was re-authored on 30 Oct 2026`));
  assert.ok(para.endsWith("changes made during the event are marked *(event)* in `docs/SPEC.md`."));
  // 1e.
  assert.match(sub, /\*What is the first commit, and is pre-event code in it\?\* All of ProofShot's code was written during the event: `15658a4`, 27 Oct/);
  // 2: v9 everywhere, v8 links only where marked superseded, the draft6b link nowhere.
  for (const doc of ["README.md", "SUBMISSION.md", "docs/DEMO.md", "docs/SUBMIT_CHECKLIST.md", "CLAIMS_AUDIT.md"]) {
    const text = read(doc);
    assert.doesNotMatch(text, new RegExp(["1zhGu", "NVFlJA"].join("")), doc); // split so a repo grep for it stays empty (VID3 2)
    assert.doesNotMatch(text, /"v8: the video to submit"/, doc);
    for (const line of text.split("\n").filter((l) => l.includes("cOeRYwRZBlA"))) assert.match(line, /superseded|replaces v8/, `${doc}: ${line}`);
  }
  assert.match(md, /^Current status \(3 Nov 2026\): the video to submit is v9, in the next section; v8 below is superseded and kept as history\.$/m);
  const v9 = md.slice(md.indexOf("## v9: the video to submit"), md.indexOf("## v8 (superseded 3 Nov)"));
  assert.match(v9, /172\.1 s, 1920x1080, 30 fps/);
  assert.match(v9, /`upload-20261103-003600-8e63` \(synthetic-02, gate REFUSE\)/);
  const rows = v9.split("\n").filter((l) => /^\| \d:\d\d \| /.test(l));
  assert.equal(rows.length, 37);
  assert.equal(rows[0], "| 0:01 | Hello. |");
  assert.equal(rows.at(-1), "| 2:44 | But the rule is simple: if we cannot prove the photo is true, it does not go live. |");
  assert.doesNotMatch(v9, /\| [^|]*Everything you will see was written fresh/);
  assert.match(sub, /the video is v9 \(`docs\/DEMO\.md` "v9: the video to submit"\)/);
  assert.match(readme, /The video to submit is v9 \(`docs\/DEMO\.md` "v9: the video to submit"\); v8 below is superseded\./);
  assert.doesNotMatch(read("docs/SUBMIT_CHECKLIST.md"), /checked by Grok on 2 Nov/);
});

test("VID3 (Grok 3 Nov): the final v9 link replaces the FIN1 placeholder; no pending-upload wording; draft6b link nowhere; v8 link only where superseded", () => {
  const link = "https://youtu.be/JSzJBOU11sA";
  // Split so a repo grep for the placeholder or the draft6b id stays empty (VID3 2).
  const gone = new RegExp(["VIDEO_LINK", "_TBD|1zhGu", "NVFlJA"].join(""));
  for (const doc of ["README.md", "SUBMISSION.md", "docs/DEMO.md", "docs/SUBMIT_CHECKLIST.md", "CLAIMS_AUDIT.md"]) {
    const text = read(doc);
    assert.doesNotMatch(text, gone, doc);
    assert.doesNotMatch(text, /link is added after the upload|link pending upload|after upload\)/, doc);
    assert.ok(text.includes(link), `${doc} has the v9 link`);
  }
  assert.ok(read("docs/DEMO.md").includes(`Link: ${link}.`));
  const list = read("docs/SUBMIT_CHECKLIST.md");
  assert.ok(list.includes(`| Demo video | ${link} | the v9 final cut (172.1 s) on YouTube (link checked by Grok on 3 Nov 2026);`));
  assert.ok(list.includes(`| Demo video | SUBMISSION.md **Demo video** | ${link}; the video is the v9 final cut (172.1 s)`));
  const tbd = read("SUBMISSION.md").split("\n").find((l) => l.startsWith("**Still TBD:**"))!;
  assert.doesNotMatch(tbd, /video link/);
});
