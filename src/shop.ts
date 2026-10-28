// The shopper preview (SPEC §11): a static shop that is only a reader of
// receipts. A catalog row exists for a `release` entry of a receipt whose chain
// verifies and whose released image is beside it with the right bytes; nothing
// else. The shop runs no gate and calls no model.
//
// The checks are the ones node and the verify page share (core.js):
// parseReceipt, the chain check (verifyChain hashes with node:crypto) and
// checkImageWith. Nothing here decides anything they do not.

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { crc32, deflateSync } from "node:zlib";

import { checkImageWith, parseReceipt } from "./core.js";
import type { ReceiptEntry } from "./core.js";
import { fixtureProviders, runJob } from "./pipeline.ts";
import { RECEIPT_FILE } from "./prior.ts";
import { recordedClock, verifyChain } from "./receipt.ts";
import { standInRenderer } from "./render.ts";
import { ATTRIBUTES } from "./types.ts";
import { sha256Hex } from "./util.ts";

export interface CatalogRow {
  readonly job_id: string;
  readonly render_id: string;
  readonly scene: string | null;
  readonly image_sha256: string;
  /** The receipt's chain head at build time. */
  readonly head: string;
  /** Paths relative to web/, where shop.html lives. */
  readonly receipt: string;
  readonly image: string;
  readonly garment_note: string;
  readonly provenance: string;
  /**
   * The render entry's provider and model, as the receipt says them (SPEC §8).
   * `stand-in` / `owner-photo` means the image is the owner's own photo and
   * nothing was generated; the page labels such a card from this field.
   */
  readonly render_provider: string;
  readonly render_model: string;
  /** NR3d: the render entry's own note (composite v2: what was adjusted), present only when the receipt has one. */
  readonly render_note?: string;
  readonly approved_by_human: boolean;
  /** What the gate said about this render, in words. */
  readonly gate_reason: string;
}

export interface Catalog {
  readonly rows: readonly CatalogRow[];
}

/** A job the shop refused to list, and why. */
export interface ShopProblem {
  readonly job_id: string;
  readonly reason: string;
}

export interface ShopBuild {
  readonly rows: readonly CatalogRow[];
  readonly problems: readonly ShopProblem[];
}

export const CATALOG_FILE = "catalog.json";
const RELEASE_SUBDIR = "shop";

interface Payload {
  readonly [key: string]: unknown;
}

function payload(e: ReceiptEntry | undefined): Payload {
  return e && typeof e.payload === "object" && e.payload !== null ? (e.payload as Payload) : {};
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * Reads one job directory and returns its rows, or throws with the reason it
 * has none. All or nothing per job: a job with a bad release is not half shown.
 */
export function rowsForJob(jobDir: string, jobId: string): CatalogRow[] {
  const receiptPath = join(jobDir, RECEIPT_FILE);
  const entries = parseReceipt(readFileSync(receiptPath, "utf8"));
  const chain = verifyChain(entries);
  if (!chain.ok) throw new Error(`the record does not verify: entry ${chain.index}, ${chain.reason}`);

  const job = payload(entries.find((e) => e.kind === "job"));
  const job_id = str(job.job_id);
  const garment_note = str(job.garment_note);
  const provenance = str(job.provenance);
  if (job_id === null || garment_note === null || provenance === null) throw new Error("the job entry lacks job_id, garment_note or provenance");
  if (job_id !== jobId) throw new Error(`the job entry says ${job_id}, the directory is ${jobId}`);
  const scenes = Array.isArray(job.scenes) ? job.scenes.map(String) : [];

  const files = readdirSync(jobDir);
  const rows: CatalogRow[] = [];
  for (const entry of entries) {
    if (entry.kind !== "release") continue;
    const release = payload(entry);
    const render_id = str(release.render_id);
    const image_sha256 = str(release.image_sha256);
    if (render_id === null || image_sha256 === null) throw new Error("a release entry lacks render_id or image_sha256");

    const file = files.find((name) => name.startsWith(`${render_id}.`) && name !== RECEIPT_FILE);
    if (!file) throw new Error(`released image for ${render_id} is not beside the receipt`);
    const bytes = readFileSync(join(jobDir, file));
    const actual = sha256Hex(bytes);
    // The copied bytes must be the released bytes, and the record must say so.
    const check = checkImageWith(entries, chain, actual);
    if (actual !== image_sha256 || check.status !== "VALID" || check.render_id !== render_id) {
      throw new Error(`${file} does not hash to the release's image_sha256 (${check.status})`);
    }

    // A row says who rendered its image, from the record; a release whose render
    // entry is missing or unnamed is not shown.
    const render = payload(entries.find((e) => e.kind === "render" && payload(e).render_id === render_id));
    const render_provider = str(render.provider);
    const render_model = str(render.model);
    if (render_provider === null || render_model === null) throw new Error(`the render entry for ${render_id} is missing or lacks provider or model`);

    const gate = payload(entries.find((e) => e.kind === "gate" && payload(e).render_id === render_id));
    const sceneIndex = /-r(\d+)$/.exec(render_id);
    rows.push({
      job_id,
      render_id,
      scene: sceneIndex ? (scenes[Number(sceneIndex[1])] ?? null) : null,
      image_sha256,
      head: chain.head,
      receipt: `${RELEASE_SUBDIR}/${job_id}/${RECEIPT_FILE}`,
      image: `${RELEASE_SUBDIR}/${job_id}/${file}`,
      garment_note,
      provenance,
      render_provider,
      render_model,
      ...(str(render.note) !== null ? { render_note: str(render.note)! } : {}),
      approved_by_human: release.approved_by_human === true,
      gate_reason: gateReason(gate),
    });
  }
  return rows;
}

function gateReason(gate: Payload): string {
  const reasons = Array.isArray(gate.reasons) ? gate.reasons : [];
  const texts = reasons.map((r) => (typeof r === "object" && r !== null ? str((r as Payload).reason) : null)).filter((t): t is string => t !== null);
  if (texts.length > 0) return `${String(gate.decision ?? "")}: ${texts.join("; ")}`.trim();
  return gate.decision === "RELEASE" ? "RELEASE: no rule fired, every attribute matched at or above its floor" : `${String(gate.decision ?? "no gate entry")}`;
}

/** Job directories under jobsRoot holding a receipt, sorted by name. */
export function jobDirs(jobsRoot: string): string[] {
  if (!existsSync(jobsRoot)) return [];
  return readdirSync(jobsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(jobsRoot, d.name, RECEIPT_FILE)))
    .map((d) => d.name)
    .sort();
}

/**
 * Builds web/shop: copies each verified job's released images and receipt to
 * `<outDir>/<job_id>/` and writes `<outDir>/catalog.json`. A job that fails
 * any check is a problem and gets no row and no files; the caller exits
 * non-zero when problems is not empty.
 */
export function buildShop(jobsRoot: string, outDir: string): ShopBuild {
  const rows: CatalogRow[] = [];
  const problems: ShopProblem[] = [];
  for (const jobId of jobDirs(jobsRoot)) {
    const jobDir = join(jobsRoot, jobId);
    let jobRows: CatalogRow[];
    try {
      jobRows = rowsForJob(jobDir, jobId);
    } catch (err) {
      problems.push({ job_id: jobId, reason: err instanceof Error ? err.message : String(err) });
      continue;
    }
    if (jobRows.length === 0) continue;
    const target = join(outDir, jobId);
    mkdirSync(target, { recursive: true });
    copyFileSync(join(jobDir, RECEIPT_FILE), join(target, RECEIPT_FILE));
    for (const row of jobRows) copyFileSync(join(jobDir, row.image.slice(row.image.lastIndexOf("/") + 1)), join(target, row.image.slice(row.image.lastIndexOf("/") + 1)));
    rows.push(...jobRows);
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, CATALOG_FILE), `${JSON.stringify({ rows } satisfies Catalog, null, 2)}\n`);
  return { rows, problems };
}

/**
 * The shop step a job runner owes after writing a job (Grok, 28 Oct 11:40, N6):
 * when jobsRoot is the repo's data/jobs, the one the committed shop is built
 * from, rebuild <repoRoot>/web/shop so a committed job never leaves
 * web/shop/catalog.json stale (CI red on 189f87c). Any other jobs root feeds no
 * committed shop, so it returns null and writes nothing. The caller exits
 * non-zero when the build has problems.
 */
export function shopAfterJob(jobsRoot: string, repoRoot: string): { readonly out: string; readonly build: ShopBuild } | null {
  if (resolve(jobsRoot) !== resolve(repoRoot, "data", "jobs")) return null;
  const out = join(repoRoot, "web", "shop");
  return { out, build: buildShop(jobsRoot, out) };
}

// ---------------------------------------------------------------------------
// The fixture job: the one the tests use, written to disk so the shop has a
// released image to show while no live render transport exists (SPEC §8).
// ---------------------------------------------------------------------------

export const FIXTURE_JOB_ID = "fixture-shirt-01";

/** An 8-bit RGB PNG from a pixel function, deterministic for the same inputs. */
export function pngRgb(width: number, height: number, pixel: (x: number, y: number) => readonly [number, number, number]): Buffer {
  const stride = width * 3;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      raw.set([r, g, b], y * (stride + 1) + 1 + x * 3);
    }
  }
  const chunk = (type: string, body: Uint8Array): Buffer => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
    return Buffer.concat([head, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

/** A flat-lay stand-in: an indigo shirt shape on a light ground, with a stripe so the two scenes differ. */
function fixtureImage(scene: string): Buffer {
  const indigo: readonly [number, number, number] = scene === "street" ? [92, 60, 140] : [40, 52, 110];
  return pngRgb(240, 300, (x, y) => {
    const inBody = x >= 50 && x < 190 && y >= 60 && y < 280;
    const inSleeve = y >= 60 && y < 150 && ((x >= 20 && x < 50) || (x >= 190 && x < 220));
    if (!inBody && !inSleeve) return [242, 240, 236];
    if (inBody && x >= 118 && x < 122) return [230, 230, 230]; // placket
    if (inBody && (y - 60) % 40 < 4) return [200, 205, 225]; // weave stripe
    return indigo;
  });
}

/**
 * Writes the fixture job (studio released, street refused on colour) under
 * jobsRoot with a recorded clock, so the receipt is byte-identical every time.
 * Returns false when it already exists; one job id is one chain (SPEC §3).
 */
export async function writeFixtureJob(jobsRoot: string, jobId = FIXTURE_JOB_ID): Promise<boolean> {
  if (existsSync(join(jobsRoot, jobId, RECEIPT_FILE))) return false;
  mkdirSync(jobsRoot, { recursive: true });
  const findings = (scene: string) => ({
    findings: ATTRIBUTES.map((attribute) => ({
      attribute,
      verdict: scene === "street" && attribute === "color" ? "mismatch" : "match",
      confidence: 0.95,
      note: scene === "street" && attribute === "color" ? "the indigo came out purple" : "matches the source",
      evidence: { source_bbox: null, render_bbox: null },
    })),
  });
  await runJob(
    {
      jobId,
      garmentNote: "indigo cotton shirt, white placket, spread collar (fixture: synthetic images, no garment was photographed)",
      scenes: ["studio", "street"],
      sources: [{ name: "front.png", bytes: fixtureImage("source") }],
    },
    {
      outRoot: jobsRoot,
      provenance: "fixture",
      clock: recordedClock(Array.from({ length: 20 }, (_, i) => `2026-10-27T15:00:${String(i).padStart(2, "0")}.000Z`)),
      providers: fixtureProviders({ renders: fixtureImage, findings }),
    },
  );
  return true;
}

// ---------------------------------------------------------------------------
// Garment preview jobs: one fixture job per photographed garment under
// data/garments, so the shop has real garments to show the judges while no
// live render transport exists. The renderer is the stand-in (SPEC §8): the
// "render" is the garment's own front photo (nothing is generated, no person
// is in it), and the render entry says `stand-in` / `owner-photo`, which is
// what the page's card label reads. The sources are every intake photo,
// hashed as intake.json records them; the findings are recorded as all
// matching. The receipt says `fixture`, and so does the page.
// ---------------------------------------------------------------------------

export const GARMENTS_DIR = "data/garments";
const INTAKE_FILE = "intake.json";
const NOTE_FILE = "note.txt";

interface IntakeRecord {
  readonly files: readonly { readonly name: string; readonly sha256: string }[];
}

/** Garment folders under garmentsRoot that have been through intake, sorted by name. */
export function garmentDirs(garmentsRoot: string): string[] {
  if (!existsSync(garmentsRoot)) return [];
  return readdirSync(garmentsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(garmentsRoot, d.name, INTAKE_FILE)) && existsSync(join(garmentsRoot, d.name, NOTE_FILE)))
    .map((d) => d.name)
    .sort();
}

/** "kurta (women's), rust / orange" from the Type and Main colour lines of note.txt; the folder name when they are blank. */
export function garmentNoteFrom(noteText: string, garment: string): string {
  const field = (label: string): string | null => {
    // Horizontal whitespace only: a blank `Type:` line must stay blank, not capture the next line
    // (found by the PS-1 edge tests: "Type:   \nMain colour: rust" used to yield "Main colour: rust").
    const m = new RegExp(`^${label}:[^\\S\\r\\n]*(.+?)[^\\S\\r\\n]*$`, "m").exec(noteText);
    // A value that is only spaces is blank, and the sentinel lines mean "nothing recorded".
    const value = (m?.[1] ?? "").trim();
    return value && !/^not recorded|^as in the photos/i.test(value) ? value : null;
  };
  const parts = [field("Type"), field("Main colour")].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(", ") : garment;
}

/**
 * Writes the preview job for one garment folder as `<jobsRoot>/<garment>/`:
 * sources are the intake photos (their bytes must still hash as intake.json
 * says, else this throws), the one scene "studio" is "rendered" by the
 * stand-in, which returns the first photo as it is, every attribute matches,
 * so the gate releases. A recorded clock makes the receipt byte-identical on
 * every run. Returns false when the job exists.
 */
export async function writeGarmentPreviewJob(jobsRoot: string, garmentDir: string, garment: string): Promise<boolean> {
  if (existsSync(join(jobsRoot, garment, RECEIPT_FILE))) return false;
  const intake = JSON.parse(readFileSync(join(garmentDir, INTAKE_FILE), "utf8")) as IntakeRecord;
  if (!Array.isArray(intake.files) || intake.files.length === 0) throw new Error(`${garment}: ${INTAKE_FILE} lists no photos`);
  const sources = [...intake.files]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((f) => {
      const bytes = readFileSync(join(garmentDir, f.name));
      if (sha256Hex(bytes) !== f.sha256) throw new Error(`${garment}/${f.name} does not hash as ${INTAKE_FILE} says`);
      return { name: f.name, bytes };
    });
  const findings = () => ({
    findings: ATTRIBUTES.map((attribute) => ({
      attribute,
      verdict: "match",
      confidence: 0.95,
      note: "recorded for the preview: the image is the garment's own photo",
      evidence: { source_bbox: null, render_bbox: null },
    })),
  });
  const base = fixtureProviders({ renders: () => new Uint8Array(0), findings });
  mkdirSync(jobsRoot, { recursive: true });
  await runJob(
    {
      jobId: garment,
      garmentNote: `${garmentNoteFrom(readFileSync(join(garmentDir, NOTE_FILE), "utf8"), garment)} (preview: the owner's photo of the garment stands in for the render)`,
      scenes: ["studio"],
      sources,
    },
    {
      outRoot: jobsRoot,
      provenance: "fixture",
      // The stand-in returns the front photo as it is and names itself on the render entry.
      providers: { ...base, renderer: standInRenderer() },
      clock: recordedClock(Array.from({ length: 20 }, (_, i) => `2026-10-27T17:00:${String(i).padStart(2, "0")}.000Z`)),
    },
  );
  return true;
}

/** Writes the preview job of every intaken garment; returns the garments written. */
export async function writeGarmentPreviewJobs(jobsRoot: string, garmentsRoot: string): Promise<string[]> {
  const written: string[] = [];
  for (const garment of garmentDirs(garmentsRoot)) {
    if (await writeGarmentPreviewJob(jobsRoot, join(garmentsRoot, garment), garment)) written.push(garment);
  }
  return written;
}
