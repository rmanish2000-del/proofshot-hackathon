import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { parseReceipt, verifyChain } from "../src/receipt.ts";
import {
  DEMO_SHOTS,
  MAX_TOTAL_SECONDS,
  REPLAYED_RECORDINGS,
  beatSecondsFromDemoMd,
  browserCandidates,
  bytesHtml,
  captionsSrt,
  cardHtml,
  concatList,
  narrationFromDemoMd,
  redactLine,
  replayLogLines,
  shotIdsFromDemoMd,
  shotNarration,
  srtTime,
  tamperOneByte,
  tamperSpot,
  terminalHtml,
} from "../src/demo-capture.ts";

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
      if (f.from === "disk" || f.from === "page") assert.ok(existsSync(join(root, f.path)), `${f.name}: ${f.path} exists`);
      assert.equal(f.from === "page", f.page !== undefined, `${f.name}: a page frame has a page and only it`);
      if (f.page?.kind === "log") {
        assert.ok(REPLAYED_RECORDINGS.includes(f.page.recording), `${f.name} names a replayed recording`);
        assert.equal(f.path, `demo/recordings/${f.page.recording}`);
      }
      for (const a of f.actions)
        if ("verify" in a) for (const p of [a.verify.receipt, a.verify.image]) assert.ok(existsSync(join(root, p)), `${f.name}: ${p} exists`);
    }
  }
  for (const name of REPLAYED_RECORDINGS) assert.ok(existsSync(join(root, "demo/recordings", name, "manifest.json")), `recording ${name}`);
});

test("DEMO1b: no shot is skipped; title cards show only text that is in docs/DEMO.md, and no [TBD]", () => {
  const md = readFileSync(join(root, "docs/DEMO.md"), "utf8");
  for (const shot of DEMO_SHOTS) {
    assert.ok(shot.frames.length > 0, `${shot.id} has frames`);
    assert.equal(shot.skip, undefined, `${shot.id} is not skipped`);
    for (const f of shot.frames) {
      if (f.page?.kind !== "card") continue;
      assert.equal(f.path, "docs/DEMO.md");
      for (const line of [f.page.title, ...f.page.lines]) {
        assert.ok(md.includes(line), `${f.name}: "${line}" is in DEMO.md`);
        assert.ok(!line.includes("TBD"), `${f.name}: no [TBD] on screen`);
      }
      if (f.page.licence) assert.ok(readFileSync(join(root, "LICENSE"), "utf8").includes(`${f.page.licence} License`), `${f.name}: LICENSE is ${f.page.licence}`);
    }
  }
  const html = cardHtml({ title: "A <b>", lines: ["x & y"], licence: "MIT" });
  assert.ok(html.includes("A &lt;b&gt;") && html.includes("x &amp; y") && html.includes("Licence: MIT"));
  assert.ok(!cardHtml({ title: "T", lines: [] }).includes("Licence"));
});

test("DEMO1b: every shot has seconds, each beat's shots fit its DEMO.md timecode, and the total is under 115 s", () => {
  const beats = beatSecondsFromDemoMd(readFileSync(join(root, "docs/DEMO.md"), "utf8"));
  assert.equal(beats.get(2), 12, "beat 2 is 0:06-0:18");
  const perBeat = new Map<number, number>();
  for (const s of DEMO_SHOTS) {
    assert.ok(Number.isInteger(s.seconds) && s.seconds > 0, `${s.id} seconds`);
    perBeat.set(s.beat, (perBeat.get(s.beat) ?? 0) + s.seconds);
  }
  for (const [beat, sec] of perBeat) {
    assert.ok(beats.has(beat), `beat ${beat} is in the timecode table`);
    assert.ok(sec <= beats.get(beat)!, `beat ${beat}: shots ${sec} s fit in ${beats.get(beat)} s`);
  }
  const total = DEMO_SHOTS.reduce((n, s) => n + s.seconds, 0);
  assert.equal(MAX_TOTAL_SECONDS, 115);
  assert.ok(total < MAX_TOTAL_SECONDS, `total ${total} s`);
  assert.equal(concatList([{ file: "a.png", seconds: 7 }, { file: "b.png", seconds: 3.5 }]), "file 'a.png'\nduration 7\nfile 'b.png'\nduration 3.5\nfile 'b.png'\n");
  assert.equal(concatList([]), "");
});

test("DEMO1c: captions.srt has one cue per narrated shot, verbatim from DEMO.md, timed like frames.txt, ending at the total", () => {
  const md = readFileSync(join(root, "docs/DEMO.md"), "utf8");
  const voice = narrationFromDemoMd(md);
  assert.ok(voice.get(6)!.startsWith("Every decision is written into a hash-chained receipt."), "beat 6 voiceover");
  const narration = shotNarration(DEMO_SHOTS, voice);
  const narrated = DEMO_SHOTS.filter((s) => narration.get(s.id));
  assert.ok(narrated.length > 0);
  for (const s of narrated) {
    const text = narration.get(s.id)!;
    assert.ok(voice.get(s.beat)!.includes(text), `${s.id}: cue text is verbatim from beat ${s.beat}`);
    assert.ok(!text.includes("TBD") && !text.includes("["), `${s.id}: no TBD on screen`);
  }
  // A beat's shots together carry its whole line, in order.
  for (const [beat, line] of voice) {
    const parts = DEMO_SHOTS.filter((s) => s.beat === beat).map((s) => narration.get(s.id));
    if (parts.every((p) => p)) assert.equal(parts.join(" "), line, `beat ${beat} shared whole`);
  }
  const srt = captionsSrt(DEMO_SHOTS, narration);
  const cues = srt.trim().split("\n\n");
  assert.equal(cues.length, narrated.length);
  const total = DEMO_SHOTS.reduce((n, s) => n + s.seconds, 0);
  let at = 0;
  const startOf = new Map<string, number>();
  for (const s of DEMO_SHOTS) {
    startOf.set(s.id, at);
    at += s.seconds;
  }
  cues.forEach((cue, i) => {
    const [n, times, ...text] = cue.split("\n");
    assert.equal(n, String(i + 1));
    assert.match(times!, /^\d\d:\d\d:\d\d,\d{3} --> \d\d:\d\d:\d\d,\d{3}$/);
    const s = narrated[i]!;
    assert.equal(times, `${srtTime(startOf.get(s.id)!)} --> ${srtTime(startOf.get(s.id)! + s.seconds)}`);
    assert.equal(text.join("\n"), narration.get(s.id));
  });
  assert.equal(DEMO_SHOTS[DEMO_SHOTS.length - 1]!.id, narrated[narrated.length - 1]!.id, "the last shot is narrated");
  assert.ok(cues[cues.length - 1]!.split("\n")[1]!.endsWith(`--> ${srtTime(total)}`), `last cue ends at ${total} s`);
  assert.equal(srtTime(101), "00:01:41,000");
  assert.equal(srtTime(3661.5), "01:01:01,500");
  // Synthetic: a TBD beat gives no cue, a two-shot beat shares its sentences, the cue is timed after it.
  const shots = [
    { id: "A", beat: 1, seconds: 3, frames: [] },
    { id: "B", beat: 2, seconds: 2, frames: [] },
    { id: "C", beat: 2, seconds: 4, frames: [] },
  ];
  const syn = shotNarration(shots, new Map([[1, "[TBD: later]"], [2, "One. Two. Three."]]));
  assert.deepEqual([...syn], [["A", null], ["B", "One."], ["C", "Two. Three."]]);
  assert.equal(captionsSrt(shots, syn), "1\n00:00:03,000 --> 00:00:05,000\nOne.\n\n2\n00:00:05,000 --> 00:00:09,000\nTwo. Three.\n");
  const piped = narrationFromDemoMd("| # | Screen | Voiceover |\n|---|---|---|\n| 3 | a \\| b | Said. |\n");
  assert.equal(piped.get(3), "Said.");
});

test("DEMO1f: captions.srt has no TBD cue: every shot is narrated, beats 1, 3 and 5 carry the v6 lines, and S1's card shows beat 1", () => {
  const voice = narrationFromDemoMd(readFileSync(join(root, "docs/DEMO.md"), "utf8"));
  assert.equal(voice.get(1), "Build for Your World. An Indian boutique seller lists a shirt online.");
  assert.equal(
    voice.get(3),
    "A pipeline smoke example first: the seller's own photo as the candidate. All nine attributes match, and the gate says RELEASE.",
  );
  assert.equal(
    voice.get(5),
    "Then a different shirt. The verifier finds a hard colour mismatch and the gate says REFUSE, so this image is not released.",
  );
  assert.equal(voice.get(7), "ProofShot. Every image ships with its receipt. The code is on GitHub.");
  // DM7 review: no absolute promise, in the voiceover or on a card.
  const cards = DEMO_SHOTS.flatMap((s) => s.frames.flatMap((f) => (f.page?.kind === "card" ? f.page.lines : [])));
  for (const line of [...voice.values(), ...cards]) assert.ok(!/cannot ship/i.test(line), `no "cannot ship" in: ${line}`);
  for (const [beat, line] of voice) assert.ok(!line.includes("TBD") && !line.includes("["), `beat ${beat} voiceover has no TBD`);
  const narration = shotNarration(DEMO_SHOTS, voice);
  for (const s of DEMO_SHOTS) assert.ok(narration.get(s.id), `${s.id} has a cue`);
  const srt = captionsSrt(DEMO_SHOTS, narration);
  assert.ok(!srt.includes("TBD") && !srt.includes("["), "no TBD in captions.srt");
  assert.equal(srt.trim().split("\n\n").length, DEMO_SHOTS.length);
  const s1 = DEMO_SHOTS.find((s) => s.id === "S1")!.frames[0]!.page;
  assert.ok(s1?.kind === "card");
  assert.equal(s1.lines.join(" "), voice.get(1));
});

test("DEMO1g: the DEMO.md beat table has no [TBD], its timecodes are the cumulative shot seconds, and the last one ends at the shots.json total", () => {
  const md = readFileSync(join(root, "docs/DEMO.md"), "utf8");
  const table = md.split("## Timecode table")[1]!.split("\n## ")[0]!;
  const rows = table.split("\n").filter((l) => /^\|\s*\d+\s*\|/.test(l));
  assert.equal(rows.length, new Set(DEMO_SHOTS.map((s) => s.beat)).size, "one row per beat");
  for (const row of rows) assert.ok(!row.includes("TBD"), `no [TBD] in: ${row.slice(0, 40)}`);
  const sec = (t: string) => Number(t.split(":")[0]) * 60 + Number(t.split(":")[1]);
  let at = 0;
  for (const row of rows) {
    const [, beat, from, to] = /^\|\s*(\d+)\s*\|\s*(\d+:\d\d)-(\d+:\d\d)\s*\|/.exec(row)!;
    const shots = DEMO_SHOTS.filter((s) => s.beat === Number(beat)).reduce((n, s) => n + s.seconds, 0);
    assert.equal(sec(from!), at, `beat ${beat} starts where the one before ends`);
    assert.equal(sec(to!) - sec(from!), shots, `beat ${beat} lasts its shots' ${shots} s`);
    at = sec(to!);
  }
  assert.equal(at, DEMO_SHOTS.reduce((n, s) => n + s.seconds, 0), "last timecode is the shots.json total");
  assert.equal(at, 76, "1:16 (v6: the 14 s try-on beat dropped from the 90 s v5 cut)");
});

test("DEMO1h: every beat's voiceover is within its word cap (seconds x 2.5), the Words cell is the real count, and beats 2, 4 and 6 carry the v6 lines", () => {
  const md = readFileSync(join(root, "docs/DEMO.md"), "utf8");
  const voice = narrationFromDemoMd(md);
  const beats = beatSecondsFromDemoMd(md);
  const table = md.split("## Timecode table")[1]!.split("\n## ")[0]!;
  const rows = table.split("\n").filter((l) => /^\|\s*\d+\s*\|/.test(l));
  assert.equal(rows.length, 7);
  for (const row of rows) {
    const beat = Number(/^\|\s*(\d+)/.exec(row)![1]);
    const words = voice.get(beat)!.split(/\s+/).filter(Boolean).length;
    const cap = Math.floor(beats.get(beat)! * 2.5);
    assert.ok(words <= cap, `beat ${beat}: ${words} words, cap ${cap}`);
    assert.match(row, new RegExp(`\\| ${words} / ${cap} \\|`), `beat ${beat}: Words cell says ${words} / ${cap}`);
  }
  assert.equal(
    voice.get(2),
    "The seller uploads their own phone photos of the shirt. ProofShot checks every candidate listing image against those photos before it goes on sale.",
  );
  assert.equal(
    voice.get(4),
    "Next, a ghost-mannequin composite of the plaid shirt. The brand label is matched below its confidence floor, so the gate says REVIEW.",
  );
  assert.equal(
    voice.get(6),
    "Every decision is written into a hash-chained receipt. The verify page checks every hash in the browser, with no server: VALID. Change one byte, and it says TAMPERED.",
  );
  assert.ok(!table.includes("wait on Grok"), "no open note under the table");
});

test("DEMO1i: DEMO.md claims no Wi-Fi or offline state that no frame shows; S7 is the receipt bytes, the checklist asks for verify.html from disk", () => {
  const md = readFileSync(join(root, "docs/DEMO.md"), "utf8");
  assert.ok(!/wi-?fi/i.test(md), "no Wi-Fi in DEMO.md");
  assert.ok(!/offline/i.test(md), "no offline claim in DEMO.md");
  const s7 = md.split("\n").find((l) => /^\|\s*S7\s*\|/.test(l))!;
  assert.match(s7, /receipt bytes around the byte that will change/);
  assert.ok(md.includes("- [ ] verify.html opened from disk (file:// URL visible), no server running."));
});

test("DEMO1j: DEMO.md has no stale rows: the try-on transport exists, the upload page was browser-checked, no pinned test count or commit, the RELEASE is a pipeline smoke example, and the demo shows shirts only: no kurta job, no try-on beat", () => {
  const md = readFileSync(join(root, "docs/DEMO.md"), "utf8");
  for (const stale of ["no generative render transport", "not checked in a real browser", "214", "c4feb75", "generated on-model image exists"]) {
    assert.ok(!md.includes(stale), `no "${stale}" in DEMO.md`);
  }
  const s4 = md.split("\n").find((l) => /^\|\s*S4\s*\|/.test(l))!;
  assert.match(s4, /pipeline smoke example/);
  const release = md.split("\n").find((l) => l.startsWith("| Pipeline smoke example (RELEASE)"))!;
  assert.match(release, /owner's own front photo/);
  assert.match(release, /\*\*not\*\* accuracy/);
  // v6 (Manish): shirts only. No shot opens a kurta job, and the timecode and shot tables name none.
  for (const shot of DEMO_SHOTS) for (const f of shot.frames) assert.ok(!f.path.includes("kurta"), `${f.name}: no kurta job`);
  const tables = md.split("## Timecode table")[1]!.split("## Recording checklist")[0]!;
  assert.ok(!/kurta|try-on/i.test(tables), "no kurta or try-on in the timecode or shot table");
  assert.ok(!md.includes("| AI try-on held by the fidelity check"), "no try-on row");
  const gen = md.split("\n").find((l) => l.startsWith("| A generated on-model image"))!;
  assert.match(gen, /no generated image has been released/);
  // The call count is read from the committed receipts, never typed from memory.
  const jobs = join(root, "data/jobs");
  const tryons = readdirSync(jobs).filter((d) => {
    const p = join(jobs, d, "receipt.jsonl");
    return existsSync(p) && readFileSync(p, "utf8").includes(`"provider":"replicate-pruna-tryon"`);
  });
  assert.match(gen, new RegExp(`the ${tryons.length} live try-on calls committed so far \\(${tryons.length} receipts`));
  // The try-on beat was dropped, not swapped, because no committed shirt job has a try-on render.
  assert.ok(tryons.length > 0 && tryons.every((d) => d.includes("kurta")), "every committed try-on is a kurta job");
  assert.match(gen, /there is no shirt try-on, so this video has no try-on beat/);
});

test("DEMO1b: the replay log page shows the replay lines and one line per receipt entry, with no key and no home path", () => {
  const receipt = readFileSync(join(root, "data/jobs/live-kurta-01-2/receipt.jsonl"), "utf8");
  const lines = replayLogLines({
    recording: "live-kurta-01-2",
    recordedJob: "live-kurta-01-2",
    recordedHead: "6a0c5a9d",
    dir: "out/demo/replay-jobs/x",
    head: "abc",
    refused: null,
    renders: [{ render_id: "x-r0", decision: "REVIEW", cited: { rule: "fidelity" } }],
    receipt,
  });
  assert.equal(lines[0], "$ npm run demo:replay -- demo/recordings/live-kurta-01-2 out/replay");
  assert.ok(lines.includes("x-r0: REVIEW (fidelity)"));
  const entries = receipt.trim().split("\n").length;
  assert.equal(lines.filter((l) => /^ ?\d+ {2}\w/.test(l)).length, entries);
  assert.ok(lines.some((l) => l.includes("gate") && l.endsWith("REVIEW")));
  // Redaction: the fake values below are placeholders, not keys.
  assert.equal(redactLine(`"api_key":"xxxx-placeholder"`), `"api_key":"[REDACTED]"`); // gitleaks:allow
  assert.equal(redactLine("Authorization: Bearer xxxxplaceholder"), "Authorization: Bearer [REDACTED]"); // gitleaks:allow
  assert.equal(redactLine(`"prompt_tokens":6918`), `"prompt_tokens":6918`);
  const html = terminalHtml("Replay of a recorded run", ["$ cmd", `token=xxxx`]);
  assert.ok(html.includes("token=[REDACTED]") && !html.includes("xxxx"));
  assert.ok(!html.includes("C:\\Users") && !html.includes("/home/"));
});

test("DEMO1b: the S8 bytes page highlights the same byte S9 changes", () => {
  const text = readFileSync(join(root, "web/shop/ms2-shirt-plaid/receipt.jsonl"), "utf8");
  const spot = tamperSpot(text)!;
  const bad = tamperOneByte(text)!;
  assert.equal(text[spot.offset], spot.before);
  assert.equal(bad[spot.offset], spot.after);
  assert.equal(spot.line, 1);
  const both = bytesHtml("web/shop/ms2-shirt-plaid/receipt.jsonl", text, "both");
  assert.ok(both.includes(`<mark>${spot.before}</mark>`) && both.includes(`<mark>${spot.after}</mark>`));
  assert.ok(both.includes(`byte ${spot.offset}`) && both.includes("entry 1"));
  const before = bytesHtml("web/shop/ms2-shirt-plaid/receipt.jsonl", text, "before");
  assert.ok(before.includes(`<mark>${spot.before}</mark>`) && !before.includes("After"));
  assert.throws(() => bytesHtml("x", "{}", "both"));
});

test("DEMO1: the tampered receipt differs by one byte and fails the chain check; the original passes", () => {
  const text = readFileSync(join(root, "web/shop/ms2-shirt-plaid/receipt.jsonl"), "utf8");
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

test("DEMO1k: the judge page opens a linked job even when it is not among the 20 newest (an older job, e.g. a try-on), instead of showing the newest", () => {
  const html = readFileSync(join(root, "web/judge.html"), "utf8");
  assert.match(html, /\(older job\)/);
  assert.match(html, /if \(want && \[\.\.\.sel\.options\]\.some\(\(o\) => o\.value === want\)\) sel\.value = want;/);
});
