// Evidence Recovery Agent: the action allowlist and argument schemas, enforced in code. Every proposed action,
// from the rule-based policy or from a model, passes validateAction before it can run; anything else (an
// unknown tool, an extra or missing argument, a value outside its enum, another job's id, free text where a
// fixed text is required) is rejected and logged. There is no tool that sets a verdict, a threshold, publishes,
// or edits an image.

import { REASON_CODES, TOOLS, VIEWS, VIEW_INSTRUCTIONS } from "./vocab.ts";
import type { ReasonCode, ToolName, View } from "./vocab.ts";

export type Action =
  | { readonly tool: "read_receipt"; readonly args: Record<string, never> }
  | { readonly tool: "check_photo_quality"; readonly args: { readonly photo: string } }
  | { readonly tool: "detect_missing_view"; readonly args: Record<string, never> }
  | { readonly tool: "request_seller_photo"; readonly args: { readonly view: View; readonly instructions: string } }
  | { readonly tool: "rerun_gate"; readonly args: { readonly listing: string; readonly mode: "offline" | "live" } }
  | { readonly tool: "explain"; readonly args: { readonly reason_code: ReasonCode } };

export type Validation = { readonly ok: true; readonly action: Action } | { readonly ok: false; readonly error: string };

/** What the validator needs to know about the current job: its id and the photo files it holds. */
export interface ValidationScope {
  readonly job: string;
  readonly photos: readonly string[];
  /** The reason code of the outcome read in this step, if any: explain may only explain that one. */
  readonly outcomeCode?: string;
}

const ARGS: Readonly<Record<ToolName, readonly string[]>> = Object.freeze({
  read_receipt: [],
  check_photo_quality: ["photo"],
  detect_missing_view: [],
  request_seller_photo: ["view", "instructions"],
  rerun_gate: ["listing", "mode"],
  explain: ["reason_code"],
});

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}

const reject = (error: string): Validation => ({ ok: false, error });

export function validateAction(proposed: unknown, scope: ValidationScope): Validation {
  if (!isPlainObject(proposed)) return reject("an action must be an object {tool, args}");
  const keys = Object.keys(proposed);
  if (keys.some((k) => k !== "tool" && k !== "args")) return reject(`unexpected keys: ${keys.filter((k) => k !== "tool" && k !== "args").join(", ")}`);
  const tool = proposed.tool;
  if (typeof tool !== "string" || !(TOOLS as readonly string[]).includes(tool)) return reject(`tool not on the allowlist: ${JSON.stringify(String(tool)).slice(0, 60)}`);
  const args = proposed.args ?? {};
  if (!isPlainObject(args)) return reject("args must be an object");
  const allowed = ARGS[tool as ToolName];
  const extra = Object.keys(args).filter((k) => !allowed.includes(k));
  if (extra.length > 0) return reject(`${tool}: unexpected arguments: ${extra.join(", ").slice(0, 80)}`);
  const missing = allowed.filter((k) => !(k in args));
  if (missing.length > 0) return reject(`${tool}: missing arguments: ${missing.join(", ")}`);

  switch (tool as ToolName) {
    case "read_receipt":
    case "detect_missing_view":
      return { ok: true, action: { tool, args: {} } as Action };
    case "check_photo_quality": {
      const photo = args.photo;
      if (typeof photo !== "string" || !scope.photos.includes(photo)) return reject("check_photo_quality: photo must be one of this job's photos");
      return { ok: true, action: { tool: "check_photo_quality", args: { photo } } };
    }
    case "request_seller_photo": {
      const view = args.view;
      if (typeof view !== "string" || !(VIEWS as readonly string[]).includes(view)) return reject("request_seller_photo: view is not a known view");
      // Only the fixed text for that view: no free text from a model or a photo can reach the seller.
      if (args.instructions !== VIEW_INSTRUCTIONS[view as View].en) return reject("request_seller_photo: instructions must be the fixed text for that view");
      return { ok: true, action: { tool: "request_seller_photo", args: { view: view as View, instructions: args.instructions } } };
    }
    case "rerun_gate": {
      if (args.listing !== scope.job) return reject("rerun_gate: listing must be the current job");
      if (args.mode !== "offline" && args.mode !== "live") return reject("rerun_gate: mode must be offline or live");
      return { ok: true, action: { tool: "rerun_gate", args: { listing: scope.job, mode: args.mode } } };
    }
    case "explain": {
      const code = args.reason_code;
      if (typeof code !== "string" || !(REASON_CODES as readonly string[]).includes(code)) return reject("explain: reason_code is not a known code");
      // Only the outcome the gate actually gave can be explained: no explaining a REVIEW as a release.
      if (code !== scope.outcomeCode) return reject("explain: reason_code must be the code of the outcome read from the receipt");
      return { ok: true, action: { tool: "explain", args: { reason_code: code as ReasonCode } } };
    }
  }
}
