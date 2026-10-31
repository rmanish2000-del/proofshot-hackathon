// Evidence-checking agent: the seller-facing actions around the agent. Creating a job and adding a photo go
// through intake (metadata stripped, JPEG only) and the per-seller size limit; approvals are recorded with who
// and when; publish refuses unless the gate's latest decision is RELEASE and the seller approved publishing.
// Nothing here or in the agent publishes on its own.

import type { Clock } from "../receipt.ts";
import { wallClock } from "../receipt.ts";
import { intakeJpeg } from "../intake.ts";
import type { AgentConfig } from "./config.ts";
import { checkFileName, checkId } from "./paths.ts";
import type { GateRunner } from "./runner.ts";
import { MAX_REPLACES_PER_JOB } from "./schema.ts";
import type { JobRecord, PhotoRecord, Store } from "./store.ts";
import { VIEWS } from "./vocab.ts";
import type { View } from "./vocab.ts";

export class SellerError extends Error {
  override name = "SellerError";
}

export interface NewPhoto {
  readonly file: string;
  readonly bytes: Uint8Array;
  readonly view: View;
}

function intake(store: Store, seller: string, job: string, photo: NewPhoto, config: AgentConfig): PhotoRecord {
  checkFileName(photo.file);
  if (!(VIEWS as readonly string[]).includes(photo.view)) throw new SellerError(`unknown view label ${JSON.stringify(String(photo.view)).slice(0, 40)}`);
  if (photo.bytes.length > config.seller.maxImageBytes) throw new SellerError(`${photo.file} is larger than ${config.seller.maxImageBytes} bytes`);
  const { file, bytes } = intakeJpeg(photo.file, photo.bytes); // throws on anything that is not a JPEG
  store.writePhoto(seller, job, photo.file, bytes);
  return { file: photo.file, view: photo.view, sha256: file.sha256 };
}

/** A new listing: photos in, then the normal gate run (offline, run-1). The agent starts after this. */
export async function createJob(
  store: Store,
  gate: GateRunner,
  input: { readonly seller: string; readonly job: string; readonly garmentNote: string; readonly candidate: { readonly file: string; readonly bytes: Uint8Array }; readonly photos: readonly NewPhoto[] },
  config: AgentConfig,
): Promise<JobRecord> {
  const seller = checkId("seller", input.seller);
  const job = checkId("job", input.job);
  if (store.hasJob(seller, job)) throw new SellerError(`job ${job} already exists`);
  if (input.candidate.bytes.length > config.seller.maxImageBytes) throw new SellerError("the candidate image is too large");
  store.writePhoto(seller, job, checkFileName(input.candidate.file), intakeJpeg(input.candidate.file, input.candidate.bytes).bytes);
  const photos = input.photos.map((p) => intake(store, seller, job, p, config));
  let record: JobRecord = {
    seller, job, garment_note: input.garmentNote, candidate: input.candidate.file, photos, status: "new", steps: 0,
    model_calls: 0, cost_usd: 0, runs: [], approvals: [], request: null, explanation: null,
  };
  const res = await gate({
    seller, job, runId: "run-1", outRoot: store.runDir(seller, job), garmentNote: record.garment_note,
    sources: photos.map((p) => ({ name: p.file, bytes: store.readPhoto(seller, job, p.file) })),
    candidate: store.readPhoto(seller, job, record.candidate), views: Object.fromEntries(photos.map((p) => [p.file, p.view])), mode: "offline",
  });
  record = { ...record, runs: [{ n: 1, mode: "offline", decision: res.decision, head: res.head }] };
  store.writeJob(record);
  return record;
}

/** The seller adds a photo (usually the one the agent asked for). The job can then be queued for its next step. */
export function addPhoto(store: Store, seller: string, job: string, photo: NewPhoto, config: AgentConfig): JobRecord {
  const record = store.readJob(seller, job);
  if (record.photos.some((p) => p.file === photo.file)) throw new SellerError(`${photo.file} is already on this job`);
  const added = intake(store, seller, job, photo, config);
  const next: JobRecord = { ...record, photos: [...record.photos, added], status: record.status === "awaiting_seller" ? "new" : record.status };
  store.writeJob(next);
  return next;
}

/**
 * The seller approves the agent's request to replace photo 1 and gives the new photo, a full-length front.
 * Only the job's own seller can (the store is keyed by seller), only while the request is open, and only once
 * per job. The old photo 1 leaves the listing (its hash stays on the record); the new one becomes photo 1, and
 * the next agent step runs the gate again from the start on the new photos.
 */
export function replacePrimary(store: Store, seller: string, job: string, photo: NewPhoto, by: string, config: AgentConfig, clock: Clock = wallClock): JobRecord {
  if (typeof by !== "string" || !/^[A-Za-z0-9 ._-]{1,40}$/.test(by)) throw new SellerError("approver must be a plain name");
  checkId("seller", seller);
  if (!store.hasJob(seller, job)) throw new SellerError(`no job ${job} for this seller`);
  const record = store.readJob(seller, job);
  if (record.seller !== seller) throw new SellerError("only the job's own seller can replace its photos");
  const open = record.replace_request;
  if (!open) throw new SellerError("the agent has not asked to replace photo 1");
  if ((record.replaced ?? []).length >= MAX_REPLACES_PER_JOB) throw new SellerError(`photo 1 can be replaced ${MAX_REPLACES_PER_JOB} time per job`);
  if (photo.view !== "full_length_front") throw new SellerError("the replacement for photo 1 must be a full-length front photo");
  const old = record.photos[0];
  if (!old || old.file !== open.photo) throw new SellerError("photo 1 changed since the request");
  if (record.photos.some((p) => p.file === photo.file)) throw new SellerError(`${photo.file} is already on this job`);
  const added = intake(store, seller, job, photo, config);
  const at = clock();
  const approval = { what: "replace_primary" as const, by, at };
  const next: JobRecord = {
    ...record, photos: [added, ...record.photos.slice(1)], status: "new", replace_request: null, request: null,
    approvals: [...record.approvals, approval],
    replaced: [...(record.replaced ?? []), { old, new: added, problems: open.problems, by, at, runs: [] }],
  };
  store.writeJob(next);
  const log = store.agentLog(seller, job, clock);
  log.append("agent", { event: "approval", approval });
  log.append("agent", { event: "replaced_primary", old: { file: old.file, sha256: old.sha256 }, new: { file: added.file, sha256: added.sha256 }, problems: open.problems, by, at });
  return next;
}

/** The seller's approval, recorded with who, when and (for a paid re-check) the estimate they were shown. */
export function approve(store: Store, seller: string, job: string, what: "paid_rerun" | "publish", by: string, config: AgentConfig, clock: Clock = wallClock): JobRecord {
  if (typeof by !== "string" || !/^[A-Za-z0-9 ._-]{1,40}$/.test(by)) throw new SellerError("approver must be a plain name");
  const record = store.readJob(seller, job);
  if (what === "publish" && record.runs.at(-1)?.decision !== "RELEASE") throw new SellerError("only a RELEASE can be approved for publishing");
  const at = clock();
  const approval = what === "paid_rerun" ? { what, by, at, estimate_usd: config.verifierCallEstimateUsd } : { what, by, at };
  const next: JobRecord = { ...record, approvals: [...record.approvals, approval], status: what === "paid_rerun" ? "new" : record.status };
  store.writeJob(next);
  store.agentLog(seller, job, clock).append("agent", { event: "approval", approval });
  return next;
}

/** Marks a listing published. Refused unless the gate's latest decision is RELEASE and publishing was approved. */
export function publish(store: Store, seller: string, job: string, clock: Clock = wallClock): JobRecord {
  const record = store.readJob(seller, job);
  const last = record.runs.at(-1);
  if (last?.decision !== "RELEASE") throw new SellerError(`not publishable: the gate's latest decision is ${last?.decision ?? "none"}`);
  const approval = record.approvals.find((a) => a.what === "publish");
  if (!approval) throw new SellerError("not publishable: the seller has not approved publishing");
  const next: JobRecord = { ...record, status: "published" };
  store.writeJob(next);
  store.agentLog(seller, job, clock).append("agent", { event: "published", gate_decision: last.decision, gate_head: last.head, approved_by: approval.by, approved_at: approval.at });
  return next;
}
