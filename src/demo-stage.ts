// DEMO1d (Grok 29 Oct 01:10): `npm run demo:stage` (scripts/demo-stage.ts)
// copies what a demo:capture run left in out/demo (the 1280 px frames that
// frames.txt lists, shots.json, frames.txt, captions.srt) into a staging folder
// outside the repo and writes manifest.json there with each file's sha256 and
// byte size, so the mp4 can be assembled on another box from known bytes.
// Nothing staged is committed.

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

/** The files every staged folder has besides the frames. */
export const STAGED_LISTS = ["shots.json", "frames.txt", "captions.srt"] as const;

export interface StagedFile {
  readonly file: string;
  readonly sha256: string;
  readonly bytes: number;
}

export interface StageManifest {
  readonly staged_from: string;
  readonly files: readonly StagedFile[];
}

/** The `file '...'` entries of an ffmpeg concat list, each once, in order. */
export function concatFiles(list: string): string[] {
  const out: string[] = [];
  for (const line of list.split("\n")) {
    const m = /^file '(.*)'\s*$/.exec(line.trim());
    if (m && !out.includes(m[1]!)) out.push(m[1]!);
  }
  return out;
}

/** A concat entry that resolves inside the list's own folder: a bare file name, no path. */
export const isLocalName = (file: string): boolean =>
  file.length > 0 && !isAbsolute(file) && !/[\\/]/.test(file) && file !== "." && file !== "..";

/** UTC, `YYYYMMDDTHHMMSSZ`, for the staged folder's name. */
export function stagingStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/**
 * Copies a capture's frames and lists from `fromDir` into `toDir` (which must
 * not exist yet, or be empty) and writes `toDir/manifest.json`. Refuses when
 * there is no shots.json (no capture ran), when frames.txt names a path rather
 * than a file next to it, or when a listed frame is missing.
 */
export function stageDemo(fromDir: string, toDir: string, stagedFrom = "out/demo"): StageManifest {
  if (!existsSync(join(fromDir, "shots.json"))) throw new Error(`no shots.json in ${stagedFrom}: run npm run demo:capture first`);
  for (const f of STAGED_LISTS) if (!existsSync(join(fromDir, f))) throw new Error(`no ${f} in ${stagedFrom}: run npm run demo:capture again`);
  const frames = concatFiles(readFileSync(join(fromDir, "frames.txt"), "utf8"));
  if (!frames.length) throw new Error(`frames.txt in ${stagedFrom} lists no frame`);
  const notLocal = frames.find((f) => !isLocalName(f));
  if (notLocal !== undefined) throw new Error(`frames.txt names ${notLocal}; every entry must be a file next to it`);
  const missing = frames.find((f) => !existsSync(join(fromDir, f)));
  if (missing !== undefined) throw new Error(`frames.txt lists ${missing}, which is not in ${stagedFrom}`);
  if (existsSync(toDir) && readdirSync(toDir).length) throw new Error(`${toDir} is not empty`);

  mkdirSync(toDir, { recursive: true });
  const files: StagedFile[] = [];
  for (const f of [...frames, ...STAGED_LISTS]) {
    copyFileSync(join(fromDir, f), join(toDir, f));
    const bytes = readFileSync(join(toDir, f));
    files.push({ file: f, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length });
  }
  const manifest: StageManifest = { staged_from: stagedFrom, files };
  writeFileSync(join(toDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}
