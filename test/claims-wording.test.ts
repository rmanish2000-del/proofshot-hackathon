import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseReceipt } from "../src/core.js";
import { computeFigures } from "../src/figures.ts";
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
  assert.match(v7, /The narration audio is the recorded voiceover; nothing is re-recorded or generated\./);
  const row = read("CLAIMS_AUDIT.md").split("\n").find((l) => l.startsWith("| No new paid call was made for the video"))!;
  assert.match(row, /beat 1 is the recorded voiceover \(`docs\/DEMO\.md`\); which voice the rest of the submitted v7 uses is \*\*UNVERIFIED\*\*/);
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
  assert.match(gate, /two settings at two times/);
  assert.doesNotMatch(gate, /cannot catch verifier misses like length changes alone/);
});
