// MS3 (Grok, 29 Oct 13:45 on #23): the Meta batch. Every committed job whose
// garment has photos is checked again by Muse Spark on the Meta Model API, its
// first render standing in as the image to publish (job:live --render), so the
// api.meta.ai credit is used across the whole set. This file only plans the
// batch; scripts/ms3-batch.ts runs it and stops at the Meta batch cap.
//
// One run per distinct (garment, render bytes): many jobs share the same
// stand-in render (the owner's front photo), and the same inputs twice prove
// nothing new. A pair already checked on the Meta verifier (MS2) is not run
// again. A job id ms3-<job> already on disk means that item ran (resumable).

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface Ms3Item {
  /** The committed job whose render is checked again. */
  readonly from_job: string;
  readonly job_id: string;
  readonly garment_dir: string;
  readonly render_path: string;
  readonly render_sha256: string;
  /** SAM noun phrase: the first word of the garment's Type line. */
  readonly segment_prompt: string;
}

export interface Ms3Skip {
  readonly job: string;
  readonly reason: string;
}

export interface Ms3Plan {
  readonly items: readonly Ms3Item[];
  readonly skipped: readonly Ms3Skip[];
}

interface Entry {
  readonly kind: string;
  readonly payload: Record<string, unknown>;
}

function entries(receiptPath: string): Entry[] {
  return readFileSync(receiptPath, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as Entry);
}

function segmentPrompt(garmentDir: string): string {
  const note = join(garmentDir, "note.txt");
  if (!existsSync(note)) return "garment";
  const type = readFileSync(note, "utf8").split(/\r?\n/).find((l) => /^Type:\s*\S/.test(l.trim()));
  const word = type?.trim().replace(/^Type:\s*/, "").split(/[\s(]/)[0]?.toLowerCase() ?? "";
  return /^[a-z-]+$/.test(word) ? word : "garment";
}

/** Plans MS3 over jobsRoot. Paths in items are joined from the given roots. */
export function planMs3(jobsRoot: string, garmentsRoot: string): Ms3Plan {
  const items: Ms3Item[] = [];
  const skipped: Ms3Skip[] = [];
  const done = new Set<string>();
  const jobs = readdirSync(jobsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  const candidates: { job: string; garment: string; render: string; sha: string }[] = [];
  for (const job of jobs) {
    if (job.startsWith("ms3-")) continue;
    if (job.startsWith("upload-")) {
      skipped.push({ job, reason: "upload job (gitignored, not committed)" });
      continue;
    }
    const receipt = join(jobsRoot, job, "receipt.jsonl");
    if (!existsSync(receipt)) {
      skipped.push({ job, reason: "no receipt" });
      continue;
    }
    const es = entries(receipt);
    const note = String(es.find((e) => e.kind === "job")?.payload.garment_note ?? "");
    const garment = note.split(":")[0]?.trim() ?? "";
    const intake = join(garmentsRoot, garment, "intake.json");
    if (!/^[a-z0-9-]+$/.test(garment)) {
      skipped.push({ job, reason: "the garment note names no garment folder (a fixture or preview job)" });
      continue;
    }
    if (!existsSync(intake)) {
      skipped.push({ job, reason: `garment ${garment} has no committed photos` });
      continue;
    }
    const render = es.find((e) => e.kind === "render");
    const renderId = String(render?.payload.render_id ?? "");
    const sha = String(render?.payload.sha256 ?? "");
    const file = ["jpg", "png"].map((ext) => join(jobsRoot, job, `${renderId}.${ext}`)).find((p) => existsSync(p));
    if (!renderId || !sha || !file) {
      skipped.push({ job, reason: "no render image stored" });
      continue;
    }
    const key = `${garment} ${sha}`;
    const verifier = es.find((e) => e.kind === "verifier")?.payload.verifier as { provider?: string } | undefined;
    if (verifier?.provider === "meta") {
      done.add(key);
      skipped.push({ job, reason: "already checked on the Meta verifier" });
      continue;
    }
    candidates.push({ job, garment, render: file, sha });
  }

  for (const c of candidates) {
    const key = `${c.garment} ${c.sha}`;
    if (done.has(key)) {
      skipped.push({ job: c.job, reason: "same garment and render bytes already in the batch or checked on Meta" });
      continue;
    }
    done.add(key);
    const garmentDir = join(garmentsRoot, c.garment);
    items.push({ from_job: c.job, job_id: `ms3-${c.job}`, garment_dir: garmentDir, render_path: c.render, render_sha256: c.sha, segment_prompt: segmentPrompt(garmentDir) });
  }
  return { items, skipped };
}
