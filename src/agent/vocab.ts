// Evidence-checking agent: the closed vocabularies. Tools, views and reason codes are fixed lists here; nothing
// read from a photo, a filename, EXIF or model output can add to them.

export const TOOLS = ["read_receipt", "check_photo_quality", "detect_missing_view", "request_seller_photo", "request_replace_primary", "rerun_gate", "explain"] as const;
export type ToolName = (typeof TOOLS)[number];

/** The photo views a seller can be asked for, and labels a seller picks from when adding a photo. */
export const VIEWS = ["full_length_front", "full_length_back", "collar_closeup", "label_closeup", "print_closeup"] as const;
export type View = (typeof VIEWS)[number];

/** The view that shows each gate attribute best (docs/EVIDENCE_CHECKING_PLAN.md). */
export const VIEW_FOR_ATTRIBUTE: Readonly<Record<string, View>> = Object.freeze({
  color: "full_length_front",
  sleeve_length: "full_length_front",
  hem: "full_length_front",
  buttons: "full_length_front",
  pocket_count: "full_length_front",
  collar: "collar_closeup",
  logo_text: "label_closeup",
  print_pattern: "print_closeup",
  fabric_texture: "print_closeup",
});

/** Fixed seller instructions per view (English, Hindi). request_seller_photo only accepts these exact texts. */
export const VIEW_INSTRUCTIONS: Readonly<Record<View, { readonly en: string; readonly hi: string }>> = Object.freeze({
  full_length_front: {
    en: "Lay the whole garment flat or hang it, front side up, on a plain background in daylight, and photograph all of it from collar to hem, with a little space around it.",
    hi: "पूरे कपड़े को सादी पृष्ठभूमि पर दिन की रोशनी में सामने की ओर से फैलाएँ या टाँगें, और कॉलर से नीचे के किनारे तक पूरा कपड़ा, आसपास थोड़ी जगह छोड़कर, फ़ोटो में लें।",
  },
  full_length_back: {
    en: "Photograph the whole garment from the back on a plain background in daylight, collar to hem in the frame.",
    hi: "पूरे कपड़े की पीछे की ओर से सादी पृष्ठभूमि पर दिन की रोशनी में फ़ोटो लें, कॉलर से नीचे के किनारे तक।",
  },
  collar_closeup: {
    en: "Take a close-up of the collar in daylight, in focus, filling most of the frame.",
    hi: "दिन की रोशनी में कॉलर की साफ़, पास से फ़ोटो लें, जो फ़्रेम का ज़्यादातर हिस्सा भरे।",
  },
  label_closeup: {
    en: "Take a close-up of the brand label so its text is sharp and readable, in daylight.",
    hi: "ब्रांड लेबल की पास से फ़ोटो लें ताकि उसका लिखा साफ़ पढ़ा जा सके, दिन की रोशनी में।",
  },
  print_closeup: {
    en: "Take a close-up of the fabric print or weave in daylight, in focus, without a flash.",
    hi: "कपड़े के प्रिंट या बुनाई की पास से, साफ़ फ़ोटो दिन की रोशनी में बिना फ़्लैश के लें।",
  },
});

/**
 * What can be wrong with the listing's first photo, the one the fidelity check measures against
 * (src/fidelity.ts compares the image with photo 1 only). Read from the receipt (src/agent/reasons.ts), never
 * from free text: each code has a fixed seller text below.
 */
export const PRIMARY_PROBLEMS = ["cropped", "angled", "partial_view"] as const;
export type PrimaryProblem = (typeof PRIMARY_PROBLEMS)[number];

export const PRIMARY_PROBLEM_TEXT: Readonly<Record<PrimaryProblem, { readonly en: string; readonly hi: string }>> = Object.freeze({
  cropped: { en: "the garment runs off the edge of the picture, so part of it is cut off", hi: "कपड़ा तस्वीर के किनारे से बाहर जाता है, इसलिए उसका एक हिस्सा कट गया है" },
  angled: { en: "it is taken at an angle", hi: "यह तिरछे कोण से ली गई है" },
  partial_view: { en: "it shows only part of the garment, or only its back", hi: "इसमें कपड़े का सिर्फ़ एक हिस्सा, या सिर्फ़ पीछे का भाग दिखता है" },
});

/** The fixed request to replace photo 1, naming the problems found (English, Hindi). */
export function replacePrimaryText(problems: readonly PrimaryProblem[]): { readonly en: string; readonly hi: string } {
  const en = problems.map((p) => PRIMARY_PROBLEM_TEXT[p].en).join("; ");
  const hi = problems.map((p) => PRIMARY_PROBLEM_TEXT[p].hi).join("; ");
  return {
    en: `Your first photo has a problem: ${en}. The image is measured against photo 1, so adding more photos will not change the result, but replacing photo 1 can. Please replace photo 1 with a full-length front photo. ${VIEW_INSTRUCTIONS.full_length_front.en} After you replace it, the gate checks the listing again from the start.`,
    hi: `आपकी पहली फ़ोटो में दिक़्क़त है: ${hi}। तस्वीर को फ़ोटो 1 से नापा जाता है, इसलिए और फ़ोटो जोड़ने से नतीजा नहीं बदलेगा, पर फ़ोटो 1 बदलने से बदल सकता है। कृपया फ़ोटो 1 की जगह पूरी लंबाई की, सामने की फ़ोटो दें। ${VIEW_INSTRUCTIONS.full_length_front.hi} बदलने के बाद गेट लिस्टिंग को शुरू से फिर जाँचेगा।`,
  };
}

/** Reason codes the agent explains; every gate outcome maps to exactly one (src/agent/reasons.ts). */
export const REASON_CODES = [
  "release",
  "hard_mismatch",
  "duplicate_attribute",
  "unknown_attribute",
  "soft_mismatch",
  "fidelity_breach",
  "fidelity_unmeasured",
  "low_confidence",
  "uncertain",
  "render_quality",
  "not_verified",
  "verifier_truncated",
  "step_failure",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];
