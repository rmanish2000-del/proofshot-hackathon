// Evidence Recovery Agent: the closed vocabularies. Tools, views and reason codes are fixed lists here; nothing
// read from a photo, a filename, EXIF or model output can add to them.

export const TOOLS = ["read_receipt", "check_photo_quality", "detect_missing_view", "request_seller_photo", "rerun_gate", "explain"] as const;
export type ToolName = (typeof TOOLS)[number];

/** The photo views a seller can be asked for, and labels a seller picks from when adding a photo. */
export const VIEWS = ["full_length_front", "full_length_back", "collar_closeup", "label_closeup", "print_closeup"] as const;
export type View = (typeof VIEWS)[number];

/** The view that shows each gate attribute best (docs/EVIDENCE_RECOVERY_PLAN.md). */
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
