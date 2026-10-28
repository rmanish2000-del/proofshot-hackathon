import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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
  assert.equal(beats.get(2), 14, "beat 2 is 0:08-0:22");
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
  assert.ok(voice.get(4)!.startsWith("Wi-Fi is off."), "beat 4 voiceover");
  assert.ok(voice.get(1)!.includes("TBD"), "beat 1 is still TBD");
  const narration = shotNarration(DEMO_SHOTS, voice);
  const narrated = DEMO_SHOTS.filter((s) => narration.get(s.id));
  assert.ok(narrated.length > 0);
  assert.equal(narration.get("S1"), null, "a TBD line gives no cue");
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

test("DEMO1b: the S4 log page shows the replay lines and one line per receipt entry, with no key and no home path", () => {
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

test("DEMO1b: the S5/S7 bytes page highlights the same byte S6 changes", () => {
  const text = readFileSync(join(root, "web/shop/kurta-01/receipt.jsonl"), "utf8");
  const spot = tamperSpot(text)!;
  const bad = tamperOneByte(text)!;
  assert.equal(text[spot.offset], spot.before);
  assert.equal(bad[spot.offset], spot.after);
  assert.equal(spot.line, 1);
  const both = bytesHtml("web/shop/kurta-01/receipt.jsonl", text, "both");
  assert.ok(both.includes(`<mark>${spot.before}</mark>`) && both.includes(`<mark>${spot.after}</mark>`));
  assert.ok(both.includes(`byte ${spot.offset}`) && both.includes("entry 1"));
  const before = bytesHtml("web/shop/kurta-01/receipt.jsonl", text, "before");
  assert.ok(before.includes(`<mark>${spot.before}</mark>`) && !before.includes("After"));
  assert.throws(() => bytesHtml("x", "{}", "both"));
});

test("DEMO1: the tampered receipt differs by one byte and fails the chain check; the original passes", () => {
  const text = readFileSync(join(root, "web/shop/kurta-01/receipt.jsonl"), "utf8");
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
