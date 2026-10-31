// Evidence Recovery Agent: what a gate outcome means for recovery, and the fixed seller text per reason code.
// It reads the gate and fidelity entries the pipeline wrote; it never decides anything. A real violation anywhere
// in the reasons wins over everything else, so it can never start a photo request or a paid re-check. The one
// exception is a bad first photo (replaceTrigger): the fidelity check measures the image against photo 1 only,
// so when the receipt shows photo 1 is cropped, angled or partial, the agent may ask the seller to replace it.
// The gate then runs again from the start on the new photos and decides as always.

import type { ReceiptEntry } from "../receipt.ts";
import { VIEW_FOR_ATTRIBUTE } from "./vocab.ts";
import type { PrimaryProblem, ReasonCode, View } from "./vocab.ts";

export type OutcomeClass = "release" | "violation" | "missing_evidence" | "verifier_failure" | "step_failure";

export interface Outcome {
  readonly render_id: string | null;
  readonly decision: "RELEASE" | "REVIEW" | "REFUSE";
  readonly code: ReasonCode;
  readonly class: OutcomeClass;
  /** Attributes whose evidence is missing or weak (low_confidence / uncertain), in rule order. */
  readonly attributes: readonly string[];
  /** Views that would supply the missing evidence; empty unless class is missing_evidence. */
  readonly views: readonly View[];
}

const VIOLATION_RULES = new Set(["hard_mismatch", "duplicate_attribute", "unknown_attribute", "soft_mismatch"]);
const STEP_RULES = new Set(["render_failed", "segment_failed", "prior_records_unreadable"]);

interface GateReason {
  readonly attribute: string | null;
  readonly rule: string;
}

function asObj(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** The outcome of the last gate entry of a receipt (the job's final decision for its first scene). */
export function outcomeOf(entries: readonly ReceiptEntry[]): Outcome {
  const gates = entries.filter((e) => e.kind === "gate");
  if (gates.length === 0) throw new Error("the receipt has no gate entry");
  const gate = asObj(gates[gates.length - 1]!.payload);
  const decision = gate.decision as Outcome["decision"];
  if (decision !== "RELEASE" && decision !== "REVIEW" && decision !== "REFUSE") throw new Error("the gate entry has no decision");
  const renderId = typeof gate.render_id === "string" ? gate.render_id : null;
  const cited = asObj(gate.cited);
  const reasons: GateReason[] = (Array.isArray(gate.reasons) ? gate.reasons : []).map((r) => {
    const o = asObj(r);
    return { attribute: typeof o.attribute === "string" ? o.attribute : null, rule: String(o.rule ?? "") };
  });
  const fidelity = entries.find((e) => e.kind === "fidelity" && asObj(e.payload).render_id === renderId);
  const fidelityMeasured = fidelity !== undefined && asObj(fidelity.payload).metrics !== null && asObj(fidelity.payload).decision !== "RELEASE";
  const base = { render_id: renderId, decision };

  if (decision === "RELEASE") return { ...base, code: "release", class: "release", attributes: [], views: [] };

  // A real violation anywhere wins: a mismatch the verifier saw, or a measured fidelity breach.
  const violation = reasons.find((r) => VIOLATION_RULES.has(r.rule));
  if (violation) return { ...base, code: violation.rule as ReasonCode, class: "violation", attributes: violation.attribute ? [violation.attribute] : [], views: [] };
  if (reasons.some((r) => r.rule === "fidelity") && fidelityMeasured) return { ...base, code: "fidelity_breach", class: "violation", attributes: [], views: [] };

  const rule = String(cited.rule ?? "");
  if (STEP_RULES.has(rule)) return { ...base, code: "step_failure", class: "step_failure", attributes: [], views: [] };
  if (rule === "not_verified" || rule === "verifier_truncated") return { ...base, code: rule, class: "verifier_failure", attributes: [], views: [] };

  const weak = reasons.filter((r) => (r.rule === "low_confidence" || r.rule === "uncertain") && r.attribute !== null);
  if (weak.length > 0) {
    const attributes = weak.map((r) => r.attribute!);
    const views = [...new Set(attributes.map((a) => VIEW_FOR_ATTRIBUTE[a]).filter((v): v is View => v !== undefined))];
    return { ...base, code: weak[0]!.rule as ReasonCode, class: "missing_evidence", attributes, views };
  }
  if (rule === "render_quality") return { ...base, code: "render_quality", class: "missing_evidence", attributes: [], views: ["full_length_front"] };
  if (reasons.some((r) => r.rule === "fidelity")) return { ...base, code: "fidelity_unmeasured", class: "missing_evidence", attributes: [], views: ["full_length_front"] };
  return { ...base, code: "step_failure", class: "step_failure", attributes: [], views: [] };
}

/** Fixed patterns over the verifier's notes; a note counts only when it is about the source photo. */
const NOTE_PROBLEMS: readonly (readonly [PrimaryProblem, RegExp])[] = [
  ["cropped", /\bsource\b[^.;]*\b(cropped|cut off|cut-off|out of (the )?frame|truncated)\b/i],
  ["angled", /\bsource\b[^.;]*\b(angled|at an angle|tilted|skewed|oblique)\b/i],
  ["partial_view", /\bsource\b[^.;]*\b(partial(ly)?|back view only|only the back|back only|only (part|half)|not (fully|entirely) visible)\b/i],
];
/** A mask box this close to the top or bottom of the frame means the collar or the hem is cut off. */
const EDGE = 0.005;

export interface ReplaceTrigger {
  readonly photo: string;
  readonly fidelity: "REVIEW" | "REFUSE";
  readonly problems: readonly PrimaryProblem[];
  /** What in the receipt showed each problem (rule names and numbers only, no model text). */
  readonly evidence: readonly string[];
}

/**
 * Whether the last gate run's receipt shows that the listing's first photo is the problem: the fidelity check
 * (which measures against photo 1 only) said REVIEW or REFUSE, and the receipt shows photo 1 is cropped (its
 * SAM mask box, already in the receipt, touches the top or bottom edge, or a verifier note says the source is
 * cut off), angled or partial (a verifier note). It reads what the pipeline wrote; it makes no model call.
 */
export function replaceTrigger(entries: readonly ReceiptEntry[], primary: string): ReplaceTrigger | null {
  const gates = entries.filter((e) => e.kind === "gate");
  if (gates.length === 0) return null;
  const renderId = asObj(gates[gates.length - 1]!.payload).render_id;
  const fid = entries.find((e) => e.kind === "fidelity" && asObj(e.payload).render_id === renderId);
  const fidelity = fid ? asObj(fid.payload).decision : null;
  if (fidelity !== "REVIEW" && fidelity !== "REFUSE") return null;
  const found = new Map<PrimaryProblem, string>();
  const segs = entries.filter((e) => e.kind === "segments").flatMap((e) => (Array.isArray(asObj(e.payload).segments) ? (asObj(e.payload).segments as unknown[]) : []));
  const mine = segs.map(asObj).filter((g) => typeof g.label === "string" && g.label.startsWith(`${primary}/`) && Array.isArray(g.box) && g.box.length === 4);
  const best = mine.sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0))[0];
  if (best) {
    const [, y, , h] = (best.box as unknown[]).map(Number) as [number, number, number, number];
    if (y <= EDGE) found.set("cropped", `photo 1 mask box touches the top edge (y=${y.toFixed(3)})`);
    else if (y + h >= 1 - EDGE) found.set("cropped", `photo 1 mask box touches the bottom edge (y+h=${(y + h).toFixed(3)})`);
  }
  const verifier = entries.find((e) => e.kind === "verifier" && asObj(e.payload).render_id === renderId);
  const findings = verifier && Array.isArray(asObj(verifier.payload).findings) ? (asObj(verifier.payload).findings as unknown[]).map(asObj) : [];
  for (const f of findings) {
    if (typeof f.note !== "string") continue;
    for (const [problem, re] of NOTE_PROBLEMS) if (!found.has(problem) && re.test(f.note)) found.set(problem, `verifier note on ${String(f.attribute).slice(0, 20)} says the source is ${problem.replace("_", " ")}`);
  }
  if (found.size === 0) return null;
  const order = ["cropped", "angled", "partial_view"] as const;
  const problems = order.filter((p) => found.has(p));
  return { photo: primary, fidelity, problems, evidence: problems.map((p) => found.get(p)!) };
}

/** Fixed seller text per reason code: what it means and what fixes it (English, Hindi). */
export const EXPLAIN: Readonly<Record<ReasonCode, { readonly en: string; readonly hi: string; readonly fix_en: string; readonly fix_hi: string }>> = Object.freeze({
  release: { en: "Every check passed and the gate said RELEASE.", hi: "हर जाँच पास हुई और गेट ने RELEASE कहा।", fix_en: "Nothing to fix. Approve it to publish.", fix_hi: "कुछ ठीक नहीं करना। प्रकाशित करने के लिए स्वीकृति दें।" },
  hard_mismatch: { en: "The image shows a different colour, print, label or collar from your photos. This is a real difference.", hi: "तस्वीर आपके फ़ोटो से अलग रंग, प्रिंट, लेबल या कॉलर दिखाती है। यह असली अंतर है।", fix_en: "What changes this: an image of this exact garment; or, if your photos show another side of it or only part of it, a full-length front photo, after which the gate checks again.", fix_hi: "इसे यह बदलेगा: इसी कपड़े की तस्वीर; या अगर आपके फ़ोटो कपड़े की दूसरी तरफ़ या सिर्फ़ उसका एक हिस्सा दिखाते हैं, तो पूरी लंबाई की सामने की फ़ोटो, जिसके बाद गेट फिर जाँचेगा।" },
  duplicate_attribute: { en: "The check gave two answers for one detail, so it was refused.", hi: "जाँच ने एक बात के दो जवाब दिए, इसलिए मना किया गया।", fix_en: "Run the check again later; this is not about your photos.", fix_hi: "बाद में फिर जाँच करें; यह आपके फ़ोटो की वजह से नहीं है।" },
  unknown_attribute: { en: "The check answered about something it should not, so it was refused.", hi: "जाँच ने ऐसी चीज़ के बारे में जवाब दिया जो उसे नहीं देना था, इसलिए मना किया गया।", fix_en: "Run the check again later; this is not about your photos.", fix_hi: "बाद में फिर जाँच करें; यह आपके फ़ोटो की वजह से नहीं है।" },
  soft_mismatch: { en: "The image differs from your photos in a detail such as sleeves, hem, pockets or buttons. This is a real difference.", hi: "तस्वीर आपके फ़ोटो से आस्तीन, किनारे, जेब या बटन जैसी किसी बात में अलग है। यह असली अंतर है।", fix_en: "Use an image that shows the garment exactly as it is.", fix_hi: "ऐसी तस्वीर इस्तेमाल करें जो कपड़े को बिल्कुल वैसा ही दिखाए।" },
  fidelity_breach: { en: "Measured against your photos, the garment in the image changed (for example its colour or its size in the frame).", hi: "आपके फ़ोटो से नापने पर तस्वीर में कपड़ा बदला हुआ है (जैसे रंग या फ़्रेम में उसका आकार)।", fix_en: "What changes this: an image that keeps the garment as it is in your first photo; or, if your first photo is cropped, angled or shows only the back, replacing it with a full-length front photo. The image is measured against photo 1 only, so photos added after it do not change this measurement.", fix_hi: "इसे यह बदलेगा: ऐसी तस्वीर जो कपड़े को आपकी पहली फ़ोटो जैसा ही रखे; या अगर पहली फ़ोटो कटी हुई, तिरछी या सिर्फ़ पीछे की है, तो उसकी जगह पूरी लंबाई की सामने की फ़ोटो। तस्वीर सिर्फ़ फ़ोटो 1 से नापी जाती है, इसलिए उसके बाद जोड़े गए फ़ोटो से यह माप नहीं बदलता।" },
  fidelity_unmeasured: { en: "The garment could not be measured in your photos, so the gate could not confirm it.", hi: "आपके फ़ोटो में कपड़ा नापा नहीं जा सका, इसलिए गेट पुष्टि नहीं कर सका।", fix_en: "Add a clear full-length photo of the garment on a plain background.", fix_hi: "सादी पृष्ठभूमि पर कपड़े की एक साफ़, पूरी लंबाई की फ़ोटो जोड़ें।" },
  low_confidence: { en: "A detail could not be checked with enough certainty from your photos.", hi: "आपके फ़ोटो से कोई बात पूरे भरोसे से जाँची नहीं जा सकी।", fix_en: "Add the photo the agent asks for, so that detail is clearly visible.", fix_hi: "एजेंट जो फ़ोटो माँगे वह जोड़ें, ताकि वह बात साफ़ दिखे।" },
  uncertain: { en: "A detail could not be seen well enough in your photos to check it.", hi: "आपके फ़ोटो में कोई बात इतनी साफ़ नहीं दिखी कि उसे जाँचा जा सके।", fix_en: "Add the photo the agent asks for, so that detail is clearly visible.", fix_hi: "एजेंट जो फ़ोटो माँगे वह जोड़ें, ताकि वह बात साफ़ दिखे।" },
  render_quality: { en: "Your photo is too dark, too bright or otherwise unfit to make a product image.", hi: "आपकी फ़ोटो बहुत अंधेरी, बहुत चमकीली या किसी और वजह से उत्पाद तस्वीर के लायक नहीं है।", fix_en: "Re-take the full-length photo in even daylight, without a flash.", fix_hi: "पूरी लंबाई की फ़ोटो दिन की एकसार रोशनी में, बिना फ़्लैश के फिर से लें।" },
  not_verified: { en: "The checking model gave no usable answer, so nothing was verified.", hi: "जाँच करने वाले मॉडल ने कोई काम का जवाब नहीं दिया, इसलिए कुछ जाँचा नहीं गया।", fix_en: "A new check is needed. It is a paid model call, so it runs only if you approve the cost.", fix_hi: "नई जाँच चाहिए। यह भुगतान वाली मॉडल कॉल है, इसलिए आपकी लागत की स्वीकृति के बाद ही चलेगी।" },
  verifier_truncated: { en: "The checking model's answer was cut off, so nothing was verified.", hi: "जाँच करने वाले मॉडल का जवाब अधूरा रह गया, इसलिए कुछ जाँचा नहीं गया।", fix_en: "A new check is needed. It is a paid model call, so it runs only if you approve the cost.", fix_hi: "नई जाँच चाहिए। यह भुगतान वाली मॉडल कॉल है, इसलिए आपकी लागत की स्वीकृति के बाद ही चलेगी।" },
  step_failure: { en: "A step of the pipeline failed, so the image was not checked.", hi: "जाँच का एक चरण विफल हुआ, इसलिए तस्वीर जाँची नहीं गई।", fix_en: "Try again later; if it repeats, the job needs a person to look at it.", fix_hi: "बाद में फिर कोशिश करें; बार-बार हो तो किसी व्यक्ति को देखना होगा।" },
});
