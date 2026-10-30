// Evidence Recovery Agent: what a gate outcome means for recovery, and the fixed seller text per reason code.
// It reads the gate and fidelity entries the pipeline wrote; it never decides anything. A real violation anywhere
// in the reasons wins over everything else, so it can never start a recovery.

import type { ReceiptEntry } from "../receipt.ts";
import { VIEW_FOR_ATTRIBUTE } from "./vocab.ts";
import type { ReasonCode, View } from "./vocab.ts";

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

/** Fixed seller text per reason code: what it means and what fixes it (English, Hindi). */
export const EXPLAIN: Readonly<Record<ReasonCode, { readonly en: string; readonly hi: string; readonly fix_en: string; readonly fix_hi: string }>> = Object.freeze({
  release: { en: "Every check passed and the gate said RELEASE.", hi: "हर जाँच पास हुई और गेट ने RELEASE कहा।", fix_en: "Nothing to fix. Approve it to publish.", fix_hi: "कुछ ठीक नहीं करना। प्रकाशित करने के लिए स्वीकृति दें।" },
  hard_mismatch: { en: "The image shows a different colour, print, label or collar from your photos. This is a real difference.", hi: "तस्वीर आपके फ़ोटो से अलग रंग, प्रिंट, लेबल या कॉलर दिखाती है। यह असली अंतर है।", fix_en: "Use an image of this exact garment. More photos will not change this.", fix_hi: "इसी कपड़े की तस्वीर इस्तेमाल करें। और फ़ोटो से यह नहीं बदलेगा।" },
  duplicate_attribute: { en: "The check gave two answers for one detail, so it was refused.", hi: "जाँच ने एक बात के दो जवाब दिए, इसलिए मना किया गया।", fix_en: "Run the check again later; this is not about your photos.", fix_hi: "बाद में फिर जाँच करें; यह आपके फ़ोटो की वजह से नहीं है।" },
  unknown_attribute: { en: "The check answered about something it should not, so it was refused.", hi: "जाँच ने ऐसी चीज़ के बारे में जवाब दिया जो उसे नहीं देना था, इसलिए मना किया गया।", fix_en: "Run the check again later; this is not about your photos.", fix_hi: "बाद में फिर जाँच करें; यह आपके फ़ोटो की वजह से नहीं है।" },
  soft_mismatch: { en: "The image differs from your photos in a detail such as sleeves, hem, pockets or buttons. This is a real difference.", hi: "तस्वीर आपके फ़ोटो से आस्तीन, किनारे, जेब या बटन जैसी किसी बात में अलग है। यह असली अंतर है।", fix_en: "Use an image that shows the garment exactly as it is.", fix_hi: "ऐसी तस्वीर इस्तेमाल करें जो कपड़े को बिल्कुल वैसा ही दिखाए।" },
  fidelity_breach: { en: "Measured against your photos, the garment in the image changed (for example its colour or its size in the frame).", hi: "आपके फ़ोटो से नापने पर तस्वीर में कपड़ा बदला हुआ है (जैसे रंग या फ़्रेम में उसका आकार)।", fix_en: "Use an image that keeps the garment as it is. More photos will not change this.", fix_hi: "ऐसी तस्वीर इस्तेमाल करें जो कपड़े को वैसा ही रखे। और फ़ोटो से यह नहीं बदलेगा।" },
  fidelity_unmeasured: { en: "The garment could not be measured in your photos, so the gate could not confirm it.", hi: "आपके फ़ोटो में कपड़ा नापा नहीं जा सका, इसलिए गेट पुष्टि नहीं कर सका।", fix_en: "Add a clear full-length photo of the garment on a plain background.", fix_hi: "सादी पृष्ठभूमि पर कपड़े की एक साफ़, पूरी लंबाई की फ़ोटो जोड़ें।" },
  low_confidence: { en: "A detail could not be checked with enough certainty from your photos.", hi: "आपके फ़ोटो से कोई बात पूरे भरोसे से जाँची नहीं जा सकी।", fix_en: "Add the photo the agent asks for, so that detail is clearly visible.", fix_hi: "एजेंट जो फ़ोटो माँगे वह जोड़ें, ताकि वह बात साफ़ दिखे।" },
  uncertain: { en: "A detail could not be seen well enough in your photos to check it.", hi: "आपके फ़ोटो में कोई बात इतनी साफ़ नहीं दिखी कि उसे जाँचा जा सके।", fix_en: "Add the photo the agent asks for, so that detail is clearly visible.", fix_hi: "एजेंट जो फ़ोटो माँगे वह जोड़ें, ताकि वह बात साफ़ दिखे।" },
  render_quality: { en: "Your photo is too dark, too bright or otherwise unfit to make a product image.", hi: "आपकी फ़ोटो बहुत अंधेरी, बहुत चमकीली या किसी और वजह से उत्पाद तस्वीर के लायक नहीं है।", fix_en: "Re-take the full-length photo in even daylight, without a flash.", fix_hi: "पूरी लंबाई की फ़ोटो दिन की एकसार रोशनी में, बिना फ़्लैश के फिर से लें।" },
  not_verified: { en: "The checking model gave no usable answer, so nothing was verified.", hi: "जाँच करने वाले मॉडल ने कोई काम का जवाब नहीं दिया, इसलिए कुछ जाँचा नहीं गया।", fix_en: "A new check is needed. It is a paid model call, so it runs only if you approve the cost.", fix_hi: "नई जाँच चाहिए। यह भुगतान वाली मॉडल कॉल है, इसलिए आपकी लागत की स्वीकृति के बाद ही चलेगी।" },
  verifier_truncated: { en: "The checking model's answer was cut off, so nothing was verified.", hi: "जाँच करने वाले मॉडल का जवाब अधूरा रह गया, इसलिए कुछ जाँचा नहीं गया।", fix_en: "A new check is needed. It is a paid model call, so it runs only if you approve the cost.", fix_hi: "नई जाँच चाहिए। यह भुगतान वाली मॉडल कॉल है, इसलिए आपकी लागत की स्वीकृति के बाद ही चलेगी।" },
  step_failure: { en: "A step of the pipeline failed, so the image was not checked.", hi: "जाँच का एक चरण विफल हुआ, इसलिए तस्वीर जाँची नहीं गई।", fix_en: "Try again later; if it repeats, the job needs a person to look at it.", fix_hi: "बाद में फिर कोशिश करें; बार-बार हो तो किसी व्यक्ति को देखना होगा।" },
});
