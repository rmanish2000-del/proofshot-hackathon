// Evidence Recovery Agent: one bounded step for one job. It never decides: the gate is reached only through the
// injected GateRunner (rerun_gate), which runs the same pipeline and gate as any job. The step enforces the
// allowlist and schemas (validateAction), the step cap, the tool-call cap, a wall-clock timeout, and the per-job
// and per-seller caps on paid model calls and spend; it writes every proposal, validation, approval, tool result,
// cost and latency, and the final gate decision to the job's agent section (agent.jsonl, hash-chained).

import type { Clock } from "../receipt.ts";
import type { AgentConfig } from "./config.ts";
import { checkPhotoQuality } from "./quality.ts";
import { EXPLAIN, outcomeOf } from "./reasons.ts";
import { answerToRequest, rulePolicy } from "./policy.ts";
import type { Proposer, StepState } from "./policy.ts";
import { validateAction } from "./schema.ts";
import type { Action } from "./schema.ts";
import type { JobRecord, Store } from "./store.ts";
import { VIEW_INSTRUCTIONS } from "./vocab.ts";
import type { View } from "./vocab.ts";

export interface GateRunInput {
  readonly seller: string;
  readonly job: string;
  /** Directory name of this run under outRoot (run-<n>); the pipeline writes outRoot/runId/receipt.jsonl. */
  readonly runId: string;
  readonly outRoot: string;
  readonly garmentNote: string;
  readonly sources: readonly { readonly name: string; readonly bytes: Uint8Array }[];
  readonly candidate: Uint8Array;
  /** The view label the seller picked for each source photo (structured data, not text from the image). */
  readonly views: Readonly<Record<string, View>>;
  readonly mode: "offline" | "live";
}

/** The only door to the gate. Implementations run the normal pipeline (src/recovery-gate.ts); the agent cannot. */
export type GateRunner = (input: GateRunInput) => Promise<{ readonly decision: string; readonly head: string }>;

export interface StepOptions {
  readonly store: Store;
  readonly seller: string;
  readonly job: string;
  readonly gate: GateRunner;
  readonly config: AgentConfig;
  readonly clock?: Clock;
  /** Defaults to the rule-based policy. A model-backed proposer goes through the same validation. */
  readonly proposer?: Proposer;
  /** For tests: the clock the timeout reads (ms). */
  readonly now?: () => number;
}

export interface StepResult {
  readonly status: JobRecord["status"];
  readonly tools: readonly string[];
  readonly rejected: readonly string[];
  readonly cap: "steps" | "tool_calls" | "timeout" | "job_model_calls" | "job_cost" | "seller_model_calls" | "seller_spend" | null;
  readonly model_calls: number;
  readonly cost_usd: number;
  readonly decision: string | null;
  readonly explanation: { readonly en: string; readonly hi: string };
}

class Timeout extends Error {}

function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  if (ms <= 0) return Promise.reject(new Timeout("step timeout"));
  let t: ReturnType<typeof setTimeout>;
  return Promise.race([p, new Promise<T>((_, rej) => (t = setTimeout(() => rej(new Timeout("step timeout")), ms)))]).finally(() => clearTimeout(t));
}

/** The plain summary: what the agent did, what it still needs, and that the gate decided (English, Hindi). */
export function summarize(record: JobRecord, tools: readonly string[], decision: string | null, need: { en: string; hi: string } | null): { en: string; hi: string } {
  const did = tools.length > 0 ? tools.join(", ") : "nothing";
  const gateEn = decision ? `The gate decided ${decision}; the agent did not.` : "No gate decision yet.";
  const gateHi = decision ? `फ़ैसला गेट ने किया: ${decision}; एजेंट ने नहीं।` : "अभी गेट का कोई फ़ैसला नहीं।";
  return {
    en: `Agent did: ${did}. ${gateEn} ${need ? `Still needed: ${need.en}` : "Nothing more is needed from the agent."}`,
    hi: `एजेंट ने किया: ${did}। ${gateHi} ${need ? `अभी चाहिए: ${need.hi}` : "एजेंट को अब और कुछ नहीं चाहिए।"}`,
  };
}

export async function runAgentStep(opts: StepOptions): Promise<StepResult> {
  const { store, seller, job, config } = opts;
  const now = opts.now ?? (() => Date.now());
  const started = now();
  let record = store.readJob(seller, job);
  const log = store.agentLog(seller, job, opts.clock);
  const tools: string[] = [];
  const rejected: string[] = [];
  let cap: StepResult["cap"] = null;
  let stepCalls = 0;
  let stepCost = 0;
  const latestDecision = (): string | null => (record.runs.length > 0 ? record.runs[record.runs.length - 1]!.decision : null);
  const step = record.steps + 1;

  const finish = (status: JobRecord["status"], need: { en: string; hi: string } | null): StepResult => {
    const explanation = summarize(record, tools, latestDecision(), need);
    record = { ...record, status, steps: step, explanation };
    store.writeJob(record);
    log.append("agent", { event: "final", step, status, cap, tools, rejected: rejected.length, gate_decision: latestDecision(), gate_head: record.runs.at(-1)?.head ?? null, latency_ms: now() - started, explanation });
    return { status, tools, rejected, cap, model_calls: stepCalls, cost_usd: stepCost, decision: latestDecision(), explanation };
  };

  if (["published", "done", "stopped"].includes(record.status)) {
    return { status: record.status, tools, rejected, cap: null, model_calls: 0, cost_usd: 0, decision: latestDecision(), explanation: record.explanation ?? summarize(record, [], latestDecision(), null) };
  }
  if (record.steps >= config.maxSteps) {
    cap = "steps";
    return finish("stopped", { en: `the step limit (${config.maxSteps}) was reached; a person needs to look at this listing.`, hi: `चरणों की सीमा (${config.maxSteps}) पूरी हुई; इस लिस्टिंग को किसी व्यक्ति को देखना होगा।` });
  }

  const state: StepState = { record, quality: {} };
  const proposer = opts.proposer ?? rulePolicy;
  let need: { en: string; hi: string } | null = null;
  let status: JobRecord["status"] = record.status;

  for (;;) {
    const proposal = proposer({ ...state, record });
    if (proposal === null || proposal === undefined) break;
    if (tools.length + rejected.length >= config.maxToolCallsPerStep) {
      cap = "tool_calls";
      break;
    }
    const v = validateAction(proposal, { job, photos: record.photos.map((p) => p.file), outcomeCode: state.outcome?.code });
    log.append("agent", { event: "proposed", step, action: v.ok ? v.action : { invalid: true }, validation: v.ok ? "ok" : v.error });
    if (!v.ok) {
      // A rejected action ends the step: nothing outside the allowlist runs, and no verdict changes.
      rejected.push(v.error);
      need = { en: "a proposed action was rejected by the safety checks; nothing was run.", hi: "एक प्रस्तावित कार्रवाई सुरक्षा जाँच में अस्वीकार हुई; कुछ नहीं चलाया गया।" };
      break;
    }
    const action: Action = v.action;
    const t0 = now();
    try {
      const remaining = config.stepTimeoutMs - (now() - started);
      const result = await withDeadline(runTool(action), remaining);
      tools.push(action.tool);
      log.append("agent", { event: "tool_result", step, tool: action.tool, result, cost_usd: result.cost_usd ?? 0, latency_ms: now() - t0 });
      if (result.stop) {
        cap = result.stop;
        need = result.need ?? null;
        status = result.status ?? status;
        break;
      }
      if (result.status) status = result.status;
      if (result.need) need = result.need;
    } catch (err) {
      if (err instanceof Timeout) {
        cap = "timeout";
        need = { en: `the step took longer than ${config.stepTimeoutMs} ms and was stopped; try again later.`, hi: `चरण ${config.stepTimeoutMs} ms से ज़्यादा चला और रोका गया; बाद में फिर कोशिश करें।` };
        log.append("agent", { event: "stopped", step, reason: "timeout", latency_ms: now() - t0 });
        break;
      }
      throw err;
    }
  }
  return finish(status, need);

  async function runTool(action: Action): Promise<ToolResult> {
    switch (action.tool) {
      case "read_receipt": {
        const last = record.runs.at(-1);
        if (!last) {
          state.explained = true; // nothing to recover before the first gate run
          return { summary: "no gate run yet", status: "new", need: { en: "the first gate run.", hi: "पहली गेट जाँच।" } };
        }
        state.outcome = outcomeOf(store.readRunReceipt(seller, job, last.n));
        const o = state.outcome;
        return { summary: `run-${last.n}: ${o.decision}, ${o.code} (${o.class})`, outcome: { decision: o.decision, code: o.code, class: o.class, attributes: o.attributes, views: o.views } };
      }
      case "detect_missing_view": {
        const o = state.outcome!;
        const usable = new Set(record.photos.filter((p) => !(state.quality[p.file]?.issues.length)).map((p) => p.view));
        state.missingViews = o.views.filter((v) => !usable.has(v));
        return { summary: state.missingViews.length > 0 ? `missing: ${state.missingViews.join(", ")}` : "no view missing", missing: state.missingViews };
      }
      case "check_photo_quality": {
        const q = checkPhotoQuality(store.readPhoto(seller, job, action.args.photo));
        state.quality[action.args.photo] = q;
        return { summary: q.issues.length > 0 ? `${action.args.photo}: ${q.issues.join(", ")}` : `${action.args.photo}: ok`, quality: q };
      }
      case "request_seller_photo": {
        const view = action.args.view;
        state.requested = view;
        record = { ...record, request: { view, instructions_en: VIEW_INSTRUCTIONS[view].en, instructions_hi: VIEW_INSTRUCTIONS[view].hi } };
        return { summary: `asked the seller for: ${view}`, status: "awaiting_seller", need: { en: VIEW_INSTRUCTIONS[view].en, hi: VIEW_INSTRUCTIONS[view].hi } };
      }
      case "explain": {
        state.explained = true;
        const o = state.outcome;
        const text = EXPLAIN[action.args.reason_code];
        const cls = o?.class;
        if (cls === "release") return { summary: "explained: release", status: "ready_to_publish", need: { en: "your approval to publish.", hi: "प्रकाशित करने के लिए आपकी स्वीकृति।" }, text };
        if (cls === "verifier_failure" || cls === "missing_evidence") {
          const est = config.verifierCallEstimateUsd;
          return { summary: `explained: ${action.args.reason_code}; a paid re-check is the only next step`, status: "awaiting_approval", need: { en: `${text.fix_en} Estimated cost: ${est} USD.`, hi: `${text.fix_hi} अनुमानित लागत: ${est} USD।` }, text };
        }
        return { summary: `explained: ${action.args.reason_code}; no recovery for this`, status: "done", need: { en: text.fix_en, hi: text.fix_hi }, text };
      }
      case "rerun_gate": {
        const live = action.args.mode === "live";
        let estimate = 0;
        if (live) {
          const approval = record.approvals.find((a) => a.what === "paid_rerun" && !a.used);
          if (!approval) return { summary: "refused: a paid re-check needs the seller's approval first", stop: "job_cost", need: { en: "your approval of the estimated cost.", hi: "अनुमानित लागत के लिए आपकी स्वीकृति।" } };
          estimate = config.verifierCallEstimateUsd;
          const usage = store.sellerUsage(seller);
          const block: StepResult["cap"] =
            record.model_calls + 1 > config.maxModelCallsPerJob ? "job_model_calls"
            : record.cost_usd + estimate > config.maxCostUsdPerJob + 1e-9 ? "job_cost"
            : usage.model_calls + 1 > config.seller.maxModelCalls ? "seller_model_calls"
            : usage.spend_usd + estimate > config.seller.maxSpendUsd + 1e-9 ? "seller_spend"
            : null;
          if (block) return { summary: `refused: ${block} limit`, stop: block, status: "stopped", need: { en: "this listing reached its spending limit; a person needs to look at it.", hi: "इस लिस्टिंग की ख़र्च सीमा पूरी हुई; किसी व्यक्ति को देखना होगा।" } };
          record = { ...record, approvals: record.approvals.map((a) => (a === approval ? { ...a, used: true } : a)), model_calls: record.model_calls + 1, cost_usd: record.cost_usd + estimate };
          store.writeSellerUsage(seller, { model_calls: usage.model_calls + 1, spend_usd: usage.spend_usd + estimate });
          stepCalls++;
          stepCost += estimate;
        }
        const n = record.runs.length + 1;
        const views: Record<string, View> = Object.fromEntries(record.photos.map((p) => [p.file, p.view]));
        const res = await opts.gate({
          seller, job, runId: `run-${n}`, outRoot: store.runDir(seller, job), garmentNote: record.garment_note,
          sources: record.photos.map((p) => ({ name: p.file, bytes: store.readPhoto(seller, job, p.file) })),
          candidate: store.readPhoto(seller, job, record.candidate), views, mode: action.args.mode,
        });
        record = { ...record, runs: [...record.runs, { n, mode: action.args.mode, decision: res.decision, head: res.head }], request: null };
        state.rerun = { decision: res.decision, mode: action.args.mode };
        state.outcome = undefined; // read the fresh receipt next
        state.missingViews = undefined;
        return { summary: `gate re-run ${n} (${action.args.mode}): ${res.decision}`, gate: { decision: res.decision, head: res.head }, cost_usd: estimate };
      }
    }
  }
}

interface ToolResult {
  readonly summary: string;
  readonly status?: JobRecord["status"];
  readonly need?: { readonly en: string; readonly hi: string } | null;
  readonly stop?: Exclude<StepResult["cap"], null>;
  readonly cost_usd?: number;
  readonly [k: string]: unknown;
}

export { answerToRequest };
