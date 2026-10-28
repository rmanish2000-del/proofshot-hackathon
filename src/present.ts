// The presentation of one job (NR5, SPEC-ui-presentation): what the result,
// receipt and /judge pages show, read only from the job's receipt entries.
//
// Nothing here decides anything. The decision, reasons and cited reason are the
// gate entry's; the render-method badge is the render entry's; a pipeline
// component is named only when the entry it would have written exists, and a
// model is named only from what that entry records. A step with no entry is
// UNVERIFIED, never a tick. The chain check is verifyChain on the same entries.

import { verifyChain } from "./receipt.ts";
import type { ChainCheck, ReceiptEntry } from "./receipt.ts";
import { REPLICATE_PROVIDER } from "./render-replicate.ts";
import { POLICY, isAttribute } from "./types.ts";
import type { Decision, Severity } from "./types.ts";

export const GATE_LABEL = "Deterministic gate (rules, no model)";
export const GATE_RULE_LINE = "Any doubt ends in REVIEW or REFUSE, never RELEASE.";

export type BadgeKind = "ai-generated" | "not-ai" | "fixture" | "none";

export interface Badge {
  readonly kind: BadgeKind;
  readonly label: string;
  readonly tooltip: string;
}

export interface ReasonView {
  readonly attribute: string | null;
  readonly verdict: string | null;
  readonly confidence: number | null;
  /** From the attribute's policy; null for fidelity, render quality and unknown attributes. */
  readonly severity: Severity | null;
  readonly rule: string;
  readonly reason: string;
  /** The verifier's evidence boxes for this attribute, [x, y, w, h] in 0..1, when it gave any. */
  readonly source_bbox: readonly number[] | null;
  readonly render_bbox: readonly number[] | null;
  /** True for the composite quality pre-check (SPEC composite v2), shown as its own reason. */
  readonly quality_precheck: boolean;
}

export interface RenderView {
  readonly render_id: string;
  readonly decision: Decision | null;
  readonly cited: ReasonView | null;
  readonly reasons: readonly ReasonView[];
  readonly badge: Badge;
  /** The released or rendered image's hash, null when no render entry exists. */
  readonly image_sha256: string | null;
  readonly provider: string | null;
  readonly model: string | null;
  readonly fallback_reason: string | null;
  /** data/models/<id>, for the licence link, only on a generative render. */
  readonly model_image_id: string | null;
  readonly released: boolean;
}

export type NodeKey = "upload" | "segment" | "render" | "verify" | "gate" | "receipt";

export interface PipelineNode {
  readonly key: NodeKey;
  readonly title: string;
  /** The component as the receipt names it, or null when nothing recorded one. */
  readonly component: string | null;
  readonly status: "done" | "UNVERIFIED";
  readonly detail: string;
  /** The receipt entry this node is read from (its seq), null when there is none. */
  readonly seq: number | null;
  /** Milliseconds since the previous entry, as the receipt's timestamps say. */
  readonly latency_ms: number | null;
}

export interface EntryCard {
  readonly seq: number;
  readonly at: string;
  readonly kind: string;
  readonly summary: string;
  readonly hash: string;
  readonly prev: string;
}

export interface JobView {
  readonly job_id: string | null;
  readonly provenance: string | null;
  readonly garment_note: string | null;
  /** In receipt (intake) order; `label` is the view read from the file name, see sourceLabels. */
  readonly sources: readonly { readonly name: string; readonly sha256: string; readonly label: string }[];
  readonly chain: ChainCheck;
  readonly renders: readonly RenderView[];
  /** The pipeline for the first render. */
  readonly pipeline: readonly PipelineNode[];
  /** The pipeline for each render by render_id, as /judge draws it for the render picked (NR5b). */
  readonly pipelines: Readonly<Record<string, readonly PipelineNode[]>>;
  readonly cards: readonly EntryCard[];
  /** Every model or service name this view shows; the test checks each has its entry. */
  readonly components: readonly string[];
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const box = (v: unknown): number[] | null => (Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === "number" && Number.isFinite(n)) ? (v as number[]) : null);

/** The segmenter as the segments entry records it; SAM 3.1 only when that model id says so. */
export function segmenterName(payload: unknown): string | null {
  const model = str(obj(obj(payload).segmenter).model);
  if (model === null) return null;
  return /sam-3\.1/i.test(model) ? `SAM 3.1 segmentation (${model})` : `segmenter ${model}`;
}

/** The verifier as the verifier entry records it; Muse Spark Open only when that model id says so. */
export function verifierName(payload: unknown): string | null {
  const v = obj(obj(payload).verifier);
  const model = str(v.model);
  const provider = str(v.provider);
  if (model === null) return null;
  if (provider === "fixture") return "fixture verifier (no model judged the image)";
  if (/muse-spark-open/i.test(model)) return `Muse Spark Open via ${provider === "baseten" ? "Baseten" : provider ?? "unknown provider"} (${model})`;
  return `verifier ${model}${provider ? ` via ${provider}` : ""}`;
}

/** The render-method badge, read from the render entry alone. */
export function renderBadge(payload: unknown): Badge {
  const p = obj(payload);
  if (Object.keys(p).length === 0) return { kind: "none", label: "No render", tooltip: "No render entry in this receipt: nothing was rendered." };
  const provider = str(p.provider);
  if (p.generative === true || p.method === "generative") {
    return { kind: "ai-generated", label: "AI-generated model", tooltip: "Synthetic person, AI-generated, not a real person. Garment from seller photos." };
  }
  if (provider === "fixture") return { kind: "fixture", label: "Fixture render", tooltip: "A recorded test image: no garment was rendered and no model ran." };
  if (provider === "stand-in") return { kind: "not-ai", label: "Not AI-generated", tooltip: "The seller's own photo stands in for the render. No pixels generated." };
  if (p.method === "composite" && p.generative === false) {
    return { kind: "not-ai", label: "Not AI-generated", tooltip: "Seller photo cut out and placed on a mannequin. No pixels generated." };
  }
  return { kind: "none", label: "Render method not recorded", tooltip: "The render entry does not say how the image was made, so nothing is claimed." };
}

function reasonView(raw: unknown, findings: readonly Obj[]): ReasonView {
  const r = obj(raw);
  const attribute = str(r.attribute);
  const finding = attribute ? findings.find((f) => f.attribute === attribute) : undefined;
  const evidence = obj(finding?.evidence);
  return {
    attribute,
    verdict: str(r.verdict),
    confidence: num(r.confidence),
    severity: attribute && isAttribute(attribute) ? POLICY[attribute].severity : null,
    rule: str(r.rule) ?? "unknown",
    reason: str(r.reason) ?? "",
    source_bbox: box(evidence.source_bbox),
    render_bbox: box(evidence.render_bbox),
    quality_precheck: r.rule === "render_quality",
  };
}

function summary(e: ReceiptEntry): string {
  const p = obj(e.payload);
  switch (e.kind) {
    case "job":
      return `job ${str(p.job_id) ?? "?"}, ${Array.isArray(p.source_images) ? p.source_images.length : 0} source photo(s), provenance ${str(p.provenance) ?? "not recorded"}`;
    case "segments":
      return `${num(p.count) ?? 0} segment(s)${segmenterName(p) ? ` by ${segmenterName(p)}` : ", no segmenter recorded"}`;
    case "render":
      return `${str(p.render_id) ?? "?"}: ${renderBadge(p).label} (${str(p.provider) ?? "?"} / ${str(p.model) ?? "?"})`;
    case "verifier":
      return `${str(p.render_id) ?? "?"}: ${Array.isArray(p.findings) ? p.findings.length : 0} finding(s) by ${verifierName(p) ?? "an unrecorded verifier"}`;
    case "fidelity":
      return `${str(p.render_id) ?? "?"}: fidelity ${str(p.decision) ?? "?"}${p.metrics ? "" : ", not measured"}`;
    case "gate":
      return `${str(p.render_id) ?? "?"}: ${str(p.decision) ?? "?"}${str(obj(p.cited).reason) ? `, ${str(obj(p.cited).reason)}` : ""}`;
    case "release":
      return `${str(p.render_id) ?? "?"} released, approved by a human: ${p.approved_by_human === true ? "yes" : "no"}`;
    default:
      return e.kind;
  }
}

/**
 * A label per source photo, in intake order, from the view its file name names
 * (front, back, side, detail): "Front", then "Front (2nd shot)" for a second
 * front, and so on (NR5b item 3: kurta-01's two fronts are two shots, each with
 * its own hash, not a duplicate). A name naming no view is "Photo <n>".
 */
export function sourceLabels(names: readonly string[]): string[] {
  const seen: Record<string, number> = {};
  const nth = ["", "2nd", "3rd"];
  return names.map((name, i) => {
    const view = /front|back|side|detail/i.exec(name)?.[0]?.toLowerCase();
    if (!view) return `Photo ${i + 1}`;
    const n = (seen[view] = (seen[view] ?? 0) + 1);
    const base = view[0]!.toUpperCase() + view.slice(1);
    return n === 1 ? base : `${base} (${nth[n - 1] ?? `${n}th`} shot)`;
  });
}

const ms = (a: string, b: string): number | null => {
  const d = Date.parse(b) - Date.parse(a);
  return Number.isFinite(d) ? d : null;
};

/** The whole view of one receipt. Entries are shown even when the chain is broken; `chain` says so. */
export function presentJob(entries: readonly ReceiptEntry[]): JobView {
  const chain = verifyChain(entries);
  const job = entries.find((e) => e.kind === "job");
  const jp = obj(job?.payload);
  const named = (Array.isArray(jp.source_images) ? jp.source_images : [])
    .map(obj)
    .filter((s) => str(s.name) !== null && str(s.sha256) !== null)
    .map((s) => ({ name: s.name as string, sha256: s.sha256 as string }));
  const labels = sourceLabels(named.map((s) => s.name));
  const sources = named.map((s, i) => ({ ...s, label: labels[i]! }));
  const segments = entries.find((e) => e.kind === "segments");
  const prevAt = (e: ReceiptEntry): string | null => entries[e.seq - 1]?.at ?? null;

  const ids: string[] = [];
  for (const e of entries) {
    const id = str(obj(e.payload).render_id);
    if (id && (e.kind === "render" || e.kind === "gate") && !ids.includes(id)) ids.push(id);
  }
  const forRender = (kind: string, id: string) => entries.find((e) => e.kind === kind && obj(e.payload).render_id === id);

  const renders: RenderView[] = ids.map((id) => {
    const render = forRender("render", id);
    const gate = forRender("gate", id);
    const verifier = forRender("verifier", id);
    const release = forRender("release", id);
    const rp = obj(render?.payload);
    const gp = obj(gate?.payload);
    const findings = (Array.isArray(obj(verifier?.payload).findings) ? (obj(verifier?.payload).findings as unknown[]) : []).map(obj);
    const decision = gp.decision === "RELEASE" || gp.decision === "REVIEW" || gp.decision === "REFUSE" ? gp.decision : null;
    const badge = renderBadge(render ? rp : undefined);
    return {
      render_id: id,
      decision,
      cited: gp.cited ? reasonView(gp.cited, findings) : null,
      reasons: (Array.isArray(gp.reasons) ? gp.reasons : []).map((r) => reasonView(r, findings)),
      badge,
      image_sha256: str(rp.sha256),
      provider: str(rp.provider),
      model: str(rp.model),
      fallback_reason: str(rp.fallback_reason),
      model_image_id: badge.kind === "ai-generated" ? str(rp.model_image_id) : null,
      released: release !== undefined,
    };
  });

  const node = (key: NodeKey, title: string, e: ReceiptEntry | undefined, component: string | null, detail: string): PipelineNode => ({
    key, title, component,
    status: e ? "done" : "UNVERIFIED",
    detail: e ? detail : "no receipt entry for this step",
    seq: e ? e.seq : null,
    latency_ms: e && prevAt(e) ? ms(prevAt(e)!, e.at) : null,
  });
  const renderComponentOf = (id: string | null): string | null => {
    const render = id ? forRender("render", id) : undefined;
    if (!render) return null;
    const rv = renders.find((r) => r.render_id === id);
    return obj(render.payload).provider === REPLICATE_PROVIDER && rv?.badge.kind === "ai-generated"
      ? `Pruna P-Image-Try-On via Replicate (${str(obj(render.payload).model) ?? "model not recorded"})`
      : `${str(obj(render.payload).provider) ?? "?"} / ${str(obj(render.payload).model) ?? "?"}`;
  };
  const segName = segments ? segmenterName(segments.payload) : null;
  const last = entries.at(-1);
  // NR5b: one pipeline per render, so /judge shows the steps of the render picked, not always the first.
  const pipelineOf = (id: string | null): PipelineNode[] => {
    const render = id ? forRender("render", id) : undefined;
    const verifier = id ? forRender("verifier", id) : undefined;
    const gate = id ? forRender("gate", id) : undefined;
    const rv = renders.find((r) => r.render_id === id);
    const renderComponent = renderComponentOf(id);
    const verName = verifier ? verifierName(verifier.payload) : null;
    return [
    node("upload", "Upload", job, null, `${sources.length} source photo(s), metadata stripped at intake`),
    {
      ...node("segment", "Segmentation", segments, segName, segName ? `${num(obj(segments?.payload).count) ?? 0} segment(s)` : "the entry records no segmenter: 0 segments"),
      // A segments entry with no segmenter is a record that nothing segmented, not a verified step.
      ...(segments && !segName ? { status: "UNVERIFIED" as const } : {}),
    },
    node("render", "Render", render, renderComponent, rv ? `${rv.badge.label}${rv.fallback_reason ? `, fell back: ${rv.fallback_reason}` : ""}` : ""),
    node("verify", "Verifier", verifier, verName, `${Array.isArray(obj(verifier?.payload).findings) ? (obj(verifier?.payload).findings as unknown[]).length : 0} finding(s)`),
    node("gate", "Gate", gate, gate ? GATE_LABEL : null, rv?.decision ?? ""),
    {
      ...node("receipt", "Hash-chained receipt", last, null, chain.ok ? `chain intact (${chain.length} entries)` : `chain broken at entry ${chain.index}: ${chain.reason}`),
      ...(chain.ok ? {} : { status: "UNVERIFIED" as const }),
      latency_ms: null,
    },
    ];
  };
  const pipeline = pipelineOf(ids[0] ?? null);
  const pipelines = Object.fromEntries(ids.map((id) => [id, pipelineOf(id)]));

  const components = [
    ...entries.filter((e) => e.kind === "segments").map((e) => segmenterName(e.payload)),
    ...entries.filter((e) => e.kind === "verifier").map((e) => verifierName(e.payload)),
    ...renders.filter((r) => r.badge.kind === "ai-generated").map((r) => renderComponentOf(r.render_id)),
    ...(entries.some((e) => e.kind === "gate") ? [GATE_LABEL] : []),
  ].filter((c): c is string => c !== null);

  return {
    job_id: str(jp.job_id),
    provenance: str(jp.provenance),
    garment_note: str(jp.garment_note),
    sources,
    chain,
    renders,
    pipeline,
    pipelines,
    cards: entries.map((e) => ({ seq: e.seq, at: e.at, kind: e.kind, summary: summary(e), hash: e.hash, prev: e.prev })),
    components: [...new Set(components)],
  };
}

/**
 * The tamper demo: the receipt text with one byte changed (the last digit of
 * one entry's timestamp, flipped by its low bit), for a chain check that must
 * fail at that entry. It is a copy; the caller never writes it anywhere.
 */
export function tamperedCopy(text: string): { text: string; index: number } {
  const lines = text.split("\n");
  const filled = lines.map((l, i) => [l, i] as const).filter(([l]) => l.trim() !== "");
  if (filled.length === 0) throw new Error("the receipt is empty: nothing to tamper with");
  const pick = filled[Math.min(1, filled.length - 1)]!;
  const [line, i] = pick;
  const m = /"at":"[^"]*?(\d)Z"/.exec(line);
  if (!m) throw new Error("no timestamp found to flip");
  const at = m.index + m[0].length - 3;
  const flipped = String.fromCharCode(line.charCodeAt(at) ^ 1);
  lines[i] = line.slice(0, at) + flipped + line.slice(at + 1);
  return { text: lines.join("\n"), index: filled.indexOf(pick) };
}
