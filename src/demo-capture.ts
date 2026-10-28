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

export interface CapturedFrame {
  /** Frame name under out/demo/, e.g. "S06a-verify-valid". */
  readonly name: string;
  /** Served by the capture's local server ("jobs" = data/jobs, "replay" = replayed recordings), or a repo file opened from disk. */
  readonly from: "jobs" | "replay" | "disk";
  /** URL path for a served page, or a repo-relative file for "disk". */
  readonly path: string;
  readonly actions: readonly ShotAction[];
}

export interface Shot {
  readonly id: string;
  readonly beat: number;
  /** Empty when the shot cannot be captured headless; `skip` says why. */
  readonly frames: readonly CapturedFrame[];
  readonly skip?: string;
}

const judge = (job: string) => `/judge?job=${encodeURIComponent(job)}`;
const loaded = { wait: "#chip" } as const;

/** One entry per row of the docs/DEMO.md shot list, in order. */
export const DEMO_SHOTS: readonly Shot[] = [
  { id: "S1", beat: 1, frames: [], skip: "title card: a slide, and its opening line is still [TBD] in DEMO.md beat 1" },
  {
    id: "S2",
    beat: 2,
    frames: [{ name: "S02-kurta-01-photos", from: "jobs", path: judge("kurta-01"), actions: [loaded, { scrollTo: "#h-result" }] }],
  },
  { id: "S3", beat: 2, frames: [{ name: "S03-shop-grid", from: "jobs", path: "/shop.html", actions: [] }] },
  { id: "S4", beat: 3, frames: [], skip: "a terminal running npm run demo:replay: a headless browser cannot film a terminal" },
  { id: "S5", beat: 4, frames: [], skip: "the OS tray with Wi-Fi off: outside the browser" },
  {
    id: "S6",
    beat: 4,
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
  { id: "S7", beat: 5, frames: [], skip: "a text editor changing one byte: outside the browser (S06b shows the result of the same one-byte change)" },
  {
    id: "S8",
    beat: 5,
    frames: [{ name: "S08-gate-input-kurta-01", from: "jobs", path: judge("live-kurta-01-2"), actions: [loaded, { scrollTo: "#h-gate" }] }],
  },
  {
    id: "S9",
    beat: 6,
    frames: [
      { name: "S09a-mismatch-photos", from: "jobs", path: judge("live-kurta-01-mismatch"), actions: [loaded, { scrollTo: "#h-result" }] },
      { name: "S09b-mismatch-refuse", from: "jobs", path: judge("live-kurta-01-mismatch"), actions: [loaded, { scrollTo: "#h-gate" }] },
    ],
  },
  {
    id: "S10",
    beat: 7,
    frames: [{ name: "S10-review", from: "replay", path: "/judge?job=@review", actions: [loaded, { scrollTo: "#h-gate" }] }],
  },
  { id: "S11", beat: 8, frames: [], skip: "end slide: a slide, not a page of the app" },
];

/** The recordings the "replay" server serves; `@<name>` in a frame path is the job id the replay writes. */
export const REPLAYED_RECORDINGS: readonly string[] = ["review"];

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
  const lines = receipt.split("\n");
  const i = lines.length > 2 ? 1 : 0;
  const line = lines[i] ?? "";
  const at = line.search(/\d/);
  if (at < 0) return null;
  const d = line[at]!;
  lines[i] = line.slice(0, at) + (d === "9" ? "0" : String(Number(d) + 1)) + line.slice(at + 1);
  return lines.join("\n");
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
