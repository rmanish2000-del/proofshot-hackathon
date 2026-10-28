// npm run demo:replay -- <recording dir> <out root>
//
// Replays a recording (SPEC §7) through the same pipeline and receipt writer,
// with no network call and no key read. The receipt lands in
// <out root>/<job_id>/receipt.jsonl, its job entry labelled provenance "replay".

import { loadRecording, replayJob } from "../src/replay.ts";

const [dir, outRoot] = process.argv.slice(2);
if (!dir || !outRoot) {
  console.error("usage: npm run demo:replay -- <recording dir> <out root>");
  process.exit(2);
}

const rec = loadRecording(dir);
const r = await replayJob(rec, { outRoot });
console.log(`replay of ${rec.manifest.name} (recorded job ${rec.manifest.recorded_from.job_id}, head ${rec.manifest.recorded_from.head})`);
console.log(`written: ${r.dir}`);
console.log(`head: ${r.head}`);
if (r.refused) console.log(`refused: ${r.refused.rule}: ${r.refused.reason}`);
for (const x of r.renders) console.log(`${x.render_id}: ${x.decision}${x.cited ? ` (${x.cited.rule})` : ""}`);
