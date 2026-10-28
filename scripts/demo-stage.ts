// npm run demo:stage [-- --from out/demo] [-- --to <folder>]
//
// DEMO1d (Grok 29 Oct 01:10): after `npm run demo:capture`, copies the 1280 px
// frames, shots.json, frames.txt and captions.srt to
// %LOCALAPPDATA%\ProofShotStaging\demo\<UTC timestamp>\ (or --to) with a
// manifest.json of sha256 and byte sizes. frames.txt names bare files, so the
// concat list works in the staged folder as is. Nothing staged is committed;
// out/demo stays gitignored. No ffmpeg, no network.

import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { stageDemo, stagingStamp } from "../src/demo-stage.ts";

const args = process.argv.slice(2);
const option = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const root = fileURLToPath(new URL("..", import.meta.url));
const from = option("--from") ?? "out/demo";
const local = process.env.LOCALAPPDATA;
const to = option("--to") ?? (local ? join(local, "ProofShotStaging", "demo", stagingStamp(new Date())) : undefined);
if (!to) {
  console.error("LOCALAPPDATA is not set; pass --to <folder>");
  process.exit(2);
}

try {
  const manifest = stageDemo(join(root, from), to, from);
  const bytes = manifest.files.reduce((n, f) => n + f.bytes, 0);
  console.log(`staged: ${to}`);
  console.log(`files: ${manifest.files.length} + manifest.json (${bytes} bytes)`);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
