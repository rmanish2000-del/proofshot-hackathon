// DEMO1 (Grok 29 Oct 00:30): the shot list of docs/DEMO.md as data, so
// `npm run demo:capture` (scripts/demo-capture.ts) can record the shots a
// headless browser can see, and say why it skips the rest. Pure: no browser,
// no server, no file system beyond what the caller passes in.

/** A step the browser runs on a loaded page before the frame is taken. */
export type ShotAction =
  /** Wait until the page script has filled this element (non-empty text). */
  | { readonly wait: string }
  | { readonly click: string; readonly waitText?: { readonly selector: string } }
  | { readonly scrollTo: string }
  /** Pick the option whose value is `value` in a <select> and fire change. */
  | { readonly select: string; readonly value: string }
  /** verify.html only: load a receipt (pasted text) and image (file input), then Check. */
  | { readonly verify: { readonly receipt: string; readonly image: string; readonly tamper: boolean } };

/**
 * DEMO1b: a page the capture writes itself (out/demo/pages/) for a shot no app
 * page shows: a title card, the replay's terminal lines, or the bytes of the
 * one-byte tamper. Its text comes only from the committed file in `path`.
 */
export type DemoPage =
  /** Text read from docs/DEMO.md (the test checks each line is there verbatim); `licence` only when LICENSE says so. */
  | { readonly kind: "card"; readonly title: string; readonly lines: readonly string[]; readonly licence?: string }
  /** What `npm run demo:replay` prints for this recording, then one line per receipt entry. */
  | { readonly kind: "log"; readonly recording: string }
  /** The byte tamperOneByte changes in `path`: the original only, or before and after. */
  | { readonly kind: "bytes"; readonly show: "before" | "both" };

export interface CapturedFrame {
  /** Frame name under out/demo/, e.g. "S06a-verify-valid". */
  readonly name: string;
  /**
   * Served by the capture's local server ("jobs" = data/jobs, "replay" = replayed recordings), a repo
   * file opened from disk, or a page the capture writes from the committed file in `path`.
   */
  readonly from: "jobs" | "replay" | "disk" | "page";
  /** URL path for a served page, or a repo-relative file for "disk" and "page". */
  readonly path: string;
  readonly actions: readonly ShotAction[];
  readonly page?: DemoPage;
}

export interface Shot {
  readonly id: string;
  readonly beat: number;
  /** How long the shot stays on screen; the frames share it equally. Fits inside its beat in DEMO.md's timecode table. */
  readonly seconds: number;
  /** Empty when the shot cannot be captured headless; `skip` says why. */
  readonly frames: readonly CapturedFrame[];
  readonly skip?: string;
}

/** Grok 29 Oct 00:45: the shots together stay under this. */
export const MAX_TOTAL_SECONDS = 115;

const judge = (job: string) => `/judge?job=${encodeURIComponent(job)}`;
const loaded = { wait: "#chip" } as const;
const TAMPERED_RECEIPT = "web/shop/kurta-01/receipt.jsonl";

/** One entry per row of the docs/DEMO.md shot list, in order. */
export const DEMO_SHOTS: readonly Shot[] = [
  {
    id: "S1",
    beat: 1,
    seconds: 5,
    // DEMO1f: the card shows beat 1's voiceover line from DEMO.md, one sentence per line.
    frames: [
      {
        name: "S01-title",
        from: "page",
        path: "docs/DEMO.md",
        actions: [],
        page: { kind: "card", title: "ProofShot", lines: ["A wrong image can sink a seller.", "ProofShot proves what was checked."] },
      },
    ],
  },
  {
    id: "S2",
    beat: 2,
    seconds: 7,
    frames: [{ name: "S02-kurta-01-photos", from: "jobs", path: judge("kurta-01"), actions: [loaded, { scrollTo: "#h-result" }] }],
  },
  { id: "S3", beat: 2, seconds: 7, frames: [{ name: "S03-shop-grid", from: "jobs", path: "/shop.html", actions: [] }] },
  {
    id: "S4",
    beat: 3,
    seconds: 12,
    frames: [{ name: "S04-replay-log", from: "page", path: "demo/recordings/live-kurta-01-2", actions: [], page: { kind: "log", recording: "live-kurta-01-2" } }],
  },
  {
    id: "S5",
    beat: 4,
    seconds: 4,
    frames: [{ name: "S05-receipt-byte", from: "page", path: TAMPERED_RECEIPT, actions: [], page: { kind: "bytes", show: "before" } }],
  },
  {
    id: "S6",
    beat: 4,
    seconds: 14,
    frames: [
      {
        name: "S06a-verify-valid",
        from: "disk",
        path: "web/verify.html",
        actions: [{ verify: { receipt: "web/shop/kurta-01/receipt.jsonl", image: "web/shop/kurta-01/kurta-01-r0.jpg", tamper: false } }],
      },
      {
        name: "S06b-verify-tampered",
        from: "disk",
        path: "web/verify.html",
        actions: [{ verify: { receipt: "web/shop/kurta-01/receipt.jsonl", image: "web/shop/kurta-01/kurta-01-r0.jpg", tamper: true } }],
      },
    ],
  },
  {
    id: "S7",
    beat: 5,
    seconds: 6,
    frames: [{ name: "S07-tamper-one-byte", from: "page", path: TAMPERED_RECEIPT, actions: [], page: { kind: "bytes", show: "both" } }],
  },
  {
    id: "S8",
    beat: 5,
    seconds: 10,
    frames: [{ name: "S08-gate-input-kurta-01", from: "jobs", path: judge("live-kurta-01-2"), actions: [loaded, { scrollTo: "#h-gate" }] }],
  },
  {
    id: "S9",
    beat: 6,
    seconds: 16,
    frames: [
      { name: "S09a-mismatch-photos", from: "jobs", path: judge("live-kurta-01-mismatch"), actions: [loaded, { scrollTo: "#h-result" }] },
      { name: "S09b-mismatch-refuse", from: "jobs", path: judge("live-kurta-01-mismatch"), actions: [loaded, { scrollTo: "#h-gate" }] },
    ],
  },
  {
    id: "S10",
    beat: 7,
    seconds: 12,
    frames: [{ name: "S10-review", from: "replay", path: "/judge?job=@review", actions: [loaded, { scrollTo: "#h-gate" }] }],
  },
  {
    id: "S11",
    beat: 8,
    seconds: 8,
    frames: [
      {
        name: "S11-end",
        from: "page",
        path: "docs/DEMO.md",
        actions: [],
        page: { kind: "card", title: "ProofShot", lines: ["A wrong image cannot ship.", "github.com/rmanish2000-del/proofshot-hackathon"], licence: "MIT" },
      },
    ],
  },
];

/** The recordings the capture replays; `@<name>` in a "replay" frame path is the job id the replay writes. */
export const REPLAYED_RECORDINGS: readonly string[] = ["review", "live-kurta-01-2"];

/** Seconds per beat from the "## Timecode table" of docs/DEMO.md (`| 2 | 0:08-0:22 |` gives beat 2 = 14). */
export function beatSecondsFromDemoMd(md: string): Map<number, number> {
  const out = new Map<number, number>();
  const sec = (t: string) => {
    const [m, s] = t.split(":");
    return Number(m) * 60 + Number(s);
  };
  for (const line of md.split("\n")) {
    const m = /^\|\s*(\d+)\s*\|\s*(\d+:\d\d)-(\d+:\d\d)\s*\|/.exec(line);
    if (m) out.set(Number(m[1]), sec(m[3]!) - sec(m[2]!));
  }
  return out;
}

/** The cells of one markdown table row; an escaped `\|` stays inside its cell. */
const tableCells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, "|"));

/** The Voiceover cell per beat from the "## Timecode table" of docs/DEMO.md. */
export function narrationFromDemoMd(md: string): Map<number, string> {
  const out = new Map<number, string>();
  let col = -1;
  for (const line of md.split("\n")) {
    if (!line.startsWith("|")) {
      col = -1;
      continue;
    }
    const cells = tableCells(line);
    if (cells[0] === "#" && cells.includes("Voiceover")) col = cells.indexOf("Voiceover");
    else if (col >= 0 && /^\d+$/.test(cells[0]!)) out.set(Number(cells[0]), cells[col] ?? "");
  }
  return out;
}

/**
 * DEMO1c: each shot's narration. DEMO.md narrates per beat, so a beat's
 * voiceover sentences are shared in order between that beat's shots (verbatim,
 * never reworded). A beat whose line is empty or still has a [TBD] gives its
 * shots no narration rather than invented text.
 */
export function shotNarration(shots: readonly Shot[], narration: ReadonlyMap<number, string>): Map<string, string | null> {
  const out = new Map<string, string | null>();
  const beats = [...new Set(shots.map((s) => s.beat))];
  for (const beat of beats) {
    const mine = shots.filter((s) => s.beat === beat);
    const line = (narration.get(beat) ?? "").trim();
    const sentences = line && !line.includes("TBD") ? line.split(/(?<=[.!?])\s+(?=\S)/) : [];
    mine.forEach((s, j) => {
      const part = sentences.slice(Math.floor((j * sentences.length) / mine.length), Math.floor(((j + 1) * sentences.length) / mine.length));
      out.set(s.id, part.length ? part.join(" ") : null);
    });
  }
  return out;
}

/** An SRT timestamp, `HH:MM:SS,mmm`. */
export function srtTime(seconds: number): string {
  const ms = Math.round(seconds * 1000);
  const p = (n: number, w: number) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3600000), 2)}:${p(Math.floor(ms / 60000) % 60, 2)}:${p(Math.floor(ms / 1000) % 60, 2)},${p(ms % 1000, 3)}`;
}

/** One SRT cue per narrated shot; start and end are the cumulative shot seconds, as in frames.txt. */
export function captionsSrt(shots: readonly Shot[], narration: ReadonlyMap<string, string | null>): string {
  const cues: string[] = [];
  let at = 0;
  for (const s of shots) {
    const text = narration.get(s.id);
    if (text) cues.push(`${cues.length + 1}\n${srtTime(at)} --> ${srtTime(at + s.seconds)}\n${text}\n`);
    at += s.seconds;
  }
  return cues.join("\n");
}

/** An ffmpeg concat list of the 1280 px frames in shot order, each shot's seconds shared by its frames. */
export function concatList(entries: readonly { readonly file: string; readonly seconds: number }[]): string {
  if (!entries.length) return "";
  const body = entries.map((e) => `file '${e.file}'\nduration ${e.seconds}`).join("\n");
  // The concat demuxer ignores the last duration unless the last file is listed again.
  return `${body}\nfile '${entries[entries.length - 1]!.file}'\n`;
}

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);

/** Replaces the value after a key-like name, and any Bearer token, with [REDACTED]. */
export function redactLine(line: string): string {
  return line
    .replace(/\b(Bearer|Api-Key)\s+(?!\[REDACTED\])[A-Za-z0-9._~+/=-]+/g, "$1 [REDACTED]")
    .replace(/((?:api[_-]?key|token|authorization|secret|password)"?\s*[:=]\s*"?)(?!Bearer\b|Api-Key\b|\[REDACTED\])([^"\s,}]+)/gi, "$1[REDACTED]");
}

const pageShell = (title: string, style: string, body: string) =>
  `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>${style}</style></head><body>${body}</body></html>\n`;

/** A plain title card: name, lines, and a licence line only when given. */
export function cardHtml(card: { readonly title: string; readonly lines: readonly string[]; readonly licence?: string }): string {
  const style =
    "html,body{margin:0;height:100%;background:#fff;color:#111;font-family:system-ui,sans-serif}body{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 6vw;box-sizing:border-box}h1{font-size:clamp(40px,9vw,96px);margin:0 0 .4em}p{font-size:clamp(18px,3.4vw,34px);margin:.25em 0}p.small{font-size:clamp(14px,2.2vw,22px);color:#555}";
  const lines = card.lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("");
  const licence = card.licence ? `<p class="small">Licence: ${escapeHtml(card.licence)}</p>` : "";
  return pageShell(card.title, style, `<h1>${escapeHtml(card.title)}</h1>${lines}${licence}`);
}

/** A terminal-looking page; every line goes through redactLine. */
export function terminalHtml(label: string, lines: readonly string[]): string {
  const style =
    "html,body{margin:0;min-height:100%;background:#111;color:#e6e6e6;font:14px/1.5 ui-monospace,Consolas,monospace}.bar{background:#2b2b2b;color:#fff;padding:8px 14px;font-family:system-ui,sans-serif;font-weight:600}pre{margin:0;padding:14px;white-space:pre-wrap;word-break:break-all}.cmd{color:#7fd17f}";
  const body = lines.map((l) => (l.startsWith("$ ") ? `<span class="cmd">${escapeHtml(redactLine(l))}</span>` : escapeHtml(redactLine(l)))).join("\n");
  return pageShell(label, style, `<div class="bar">${escapeHtml(label)}</div><pre>${body}</pre>`);
}

/** The lines `npm run demo:replay` prints (scripts/replay.ts), then `seq kind hash` per receipt entry. */
export function replayLogLines(r: {
  readonly recording: string;
  readonly recordedJob: string;
  readonly recordedHead: string;
  /** Repo-relative, so no home path is shown. */
  readonly dir: string;
  readonly head: string;
  readonly refused: { readonly rule: string; readonly reason: string } | null;
  readonly renders: readonly { readonly render_id: string; readonly decision: string; readonly cited: { readonly rule: string } | null }[];
  readonly receipt: string;
}): string[] {
  const lines = [
    `$ npm run demo:replay -- demo/recordings/${r.recording} out/replay`,
    `replay of ${r.recording} (recorded job ${r.recordedJob}, head ${r.recordedHead})`,
    `written: ${r.dir}`,
    `head: ${r.head}`,
  ];
  if (r.refused) lines.push(`refused: ${r.refused.rule}: ${r.refused.reason}`);
  for (const x of r.renders) lines.push(`${x.render_id}: ${x.decision}${x.cited ? ` (${x.cited.rule})` : ""}`);
  lines.push("", `receipt entries (seq, kind, hash chained to prev):`);
  for (const text of r.receipt.split("\n")) {
    if (!text.trim()) continue;
    const e = JSON.parse(text) as { seq: number; kind: string; hash: string; prev: string; payload?: { decision?: string } };
    const decision = e.payload?.decision ? ` ${e.payload.decision}` : "";
    lines.push(`${String(e.seq).padStart(2)}  ${e.kind.padEnd(9)} ${e.hash.slice(0, 16)}  prev ${e.prev.slice(0, 16)}${decision}`);
  }
  return lines;
}

/** Where tamperOneByte changes the receipt: entry line, column, byte offset in the file, and the two characters. */
export interface TamperSpot {
  readonly line: number;
  readonly column: number;
  readonly offset: number;
  readonly before: string;
  readonly after: string;
}

/** The first digit of the second entry (or the first if there is one); null when there is none. */
export function tamperSpot(receipt: string): TamperSpot | null {
  const lines = receipt.split("\n");
  const i = lines.length > 2 ? 1 : 0;
  const line = lines[i] ?? "";
  const at = line.search(/\d/);
  if (at < 0) return null;
  const d = line[at]!;
  const offset = lines.slice(0, i).reduce((n, l) => n + l.length + 1, 0) + at;
  return { line: i, column: at, offset, before: d, after: d === "9" ? "0" : String(Number(d) + 1) };
}

/** The bytes around the tampered one, highlighted: the original only, or before and after. */
export function bytesHtml(file: string, receipt: string, show: "before" | "both"): string {
  const spot = tamperSpot(receipt);
  if (!spot) throw new Error(`no byte to change in ${file}`);
  const line = receipt.split("\n")[spot.line]!;
  const from = Math.max(0, spot.column - 30);
  const to = Math.min(line.length, spot.column + 31);
  const row = (label: string, ch: string) =>
    `<tr><th>${label}</th><td><code>${from > 0 ? "…" : ""}${escapeHtml(line.slice(from, spot.column))}<mark>${escapeHtml(ch)}</mark>${escapeHtml(line.slice(spot.column + 1, to))}${to < line.length ? "…" : ""}</code></td></tr>`;
  const hex = (ch: string) => `0x${ch.charCodeAt(0).toString(16).padStart(2, "0")}`;
  const style =
    "html,body{margin:0;background:#fff;color:#111;font-family:system-ui,sans-serif}main{padding:24px 4vw}h1{font-size:22px;margin:0 0 4px}p{color:#444;margin:4px 0 18px}table{border-collapse:collapse;width:100%}th{text-align:left;padding:10px 12px 10px 0;vertical-align:top;white-space:nowrap}td{padding:10px 0}code{font:15px/1.5 ui-monospace,Consolas,monospace;word-break:break-all}mark{background:#ffd54a;outline:2px solid #b8860b;padding:0 1px}";
  const where = `${escapeHtml(file)}, entry ${spot.line} (line ${spot.line + 1}), byte ${spot.offset}`;
  const rows =
    show === "both"
      ? row(`Before ${hex(spot.before)}`, spot.before) + row(`After ${hex(spot.after)}`, spot.after)
      : row(`Byte ${hex(spot.before)}`, spot.before);
  const title = show === "both" ? "One byte changed" : "The receipt as released";
  return pageShell(title, style, `<main><h1>${title}</h1><p>${where}</p><table>${rows}</table></main>`);
}

/** The shot ids of the "## Shot list" table in docs/DEMO.md, in order. */
export function shotIdsFromDemoMd(md: string): string[] {
  const start = md.indexOf("\n## Shot list");
  if (start < 0) return [];
  const rest = md.slice(start + 1);
  const next = rest.indexOf("\n## ");
  const section = next < 0 ? rest : rest.slice(0, next);
  const ids: string[] = [];
  for (const line of section.split("\n")) {
    const m = /^\|\s*(S\d+)\s*\|/.exec(line);
    if (m) ids.push(m[1]!);
  }
  return ids;
}

/**
 * The receipt text with one byte changed inside the second entry (or the first
 * if there is one), so the chain check names that entry. Null when no digit
 * is there to change.
 */
export function tamperOneByte(receipt: string): string | null {
  const spot = tamperSpot(receipt);
  if (!spot) return null;
  return receipt.slice(0, spot.offset) + spot.after + receipt.slice(spot.offset + 1);
}

/** Where a Chromium-family browser is likely installed; PROOFSHOT_BROWSER wins. */
export function browserCandidates(env: Readonly<Record<string, string | undefined>>, platform: string): string[] {
  const own = (env.PROOFSHOT_BROWSER ?? "").trim();
  const list: string[] = own ? [own] : [];
  if (platform === "win32") {
    for (const base of [env["ProgramFiles(x86)"], env.ProgramFiles, env.LOCALAPPDATA]) {
      if (!base) continue;
      list.push(`${base}\\Microsoft\\Edge\\Application\\msedge.exe`, `${base}\\Google\\Chrome\\Application\\chrome.exe`);
    }
  } else if (platform === "darwin") {
    list.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge");
  } else {
    list.push("/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge");
  }
  return list;
}

/** The two widths every frame is taken at (mobile first, then desktop). */
export const VIEWPORTS = [
  { label: "360", width: 360, height: 780, scale: 2 },
  { label: "1280", width: 1280, height: 800, scale: 1 },
] as const;
