// Evidence-checking agent: limits (round 5). Every cap the agent and its queue enforce lives here, so one file
// says how far the agent may go. A config file can only lower or set these within sane bounds; unknown keys and
// non-numbers are refused, not ignored.

import { readFileSync } from "node:fs";

export interface SellerLimits {
  /** Largest photo a seller may add, in bytes. */
  readonly maxImageBytes: number;
  /** Jobs of one seller that may run at the same time in the queue. */
  readonly maxConcurrentJobs: number;
  /** Paid model calls one seller may approve in total (verifier or segmenter re-runs). */
  readonly maxModelCalls: number;
  /** Spend one seller may approve in total, USD, by the estimate shown before approval. */
  readonly maxSpendUsd: number;
}

export interface AgentConfig {
  /** Agent steps per job (one step = one queue run of the agent); a hard stop after this many. */
  readonly maxSteps: number;
  /** Tool calls inside one step. */
  readonly maxToolCallsPerStep: number;
  /** Paid model calls per job. */
  readonly maxModelCallsPerJob: number;
  /** Spend per job, USD, by the estimate shown before approval. */
  readonly maxCostUsdPerJob: number;
  /** Wall time of one step, ms; the step stops when it is exceeded. */
  readonly stepTimeoutMs: number;
  /** Queue workers (jobs processed at the same time). */
  readonly workers: number;
  /** Estimated cost of one verifier re-run (USD), shown to the seller before approval. */
  readonly verifierCallEstimateUsd: number;
  readonly seller: SellerLimits;
}

export const DEFAULT_CONFIG: AgentConfig = Object.freeze({
  maxSteps: 4,
  // check photo, re-run, read, detect, request: the longest step the rule policy takes.
  maxToolCallsPerStep: 5,
  maxModelCallsPerJob: 2,
  maxCostUsdPerJob: 0.1,
  stepTimeoutMs: 30_000,
  workers: 1,
  // Median Muse Spark 1.3 call in evidence/pack: 0.0233 USD; rounded up so the estimate is not below a real call.
  verifierCallEstimateUsd: 0.03,
  seller: Object.freeze({ maxImageBytes: 8 * 1024 * 1024, maxConcurrentJobs: 1, maxModelCalls: 10, maxSpendUsd: 0.5 }),
});

const BOUNDS: Record<string, [number, number]> = {
  maxSteps: [1, 4],
  maxToolCallsPerStep: [1, 6],
  maxModelCallsPerJob: [0, 5],
  maxCostUsdPerJob: [0, 1],
  stepTimeoutMs: [100, 300_000],
  workers: [1, 16],
  verifierCallEstimateUsd: [0.001, 1],
  "seller.maxImageBytes": [1024, 40 * 1024 * 1024],
  "seller.maxConcurrentJobs": [1, 16],
  "seller.maxModelCalls": [0, 100],
  "seller.maxSpendUsd": [0, 10],
};

export class ConfigError extends Error {
  override name = "ConfigError";
}

/** Defaults overridden by a plain object; every key must be known and every value a number within its bounds. */
export function makeConfig(overrides: unknown = {}): AgentConfig {
  if (typeof overrides !== "object" || overrides === null || Array.isArray(overrides)) throw new ConfigError("config must be an object");
  const o = overrides as Record<string, unknown>;
  const seller = (o.seller ?? {}) as Record<string, unknown>;
  if (typeof seller !== "object" || seller === null || Array.isArray(seller)) throw new ConfigError("config.seller must be an object");
  for (const k of Object.keys(o)) if (!(k in DEFAULT_CONFIG)) throw new ConfigError(`unknown config key ${JSON.stringify(k)}`);
  for (const k of Object.keys(seller)) if (!(k in DEFAULT_CONFIG.seller)) throw new ConfigError(`unknown config key seller.${k}`);
  const pick = (key: string, value: unknown, fallback: number): number => {
    if (value === undefined) return fallback;
    const [lo, hi] = BOUNDS[key]!;
    if (typeof value !== "number" || !Number.isFinite(value) || value < lo || value > hi) throw new ConfigError(`${key} must be a number from ${lo} to ${hi}`);
    return value;
  };
  const d = DEFAULT_CONFIG;
  return Object.freeze({
    maxSteps: pick("maxSteps", o.maxSteps, d.maxSteps),
    maxToolCallsPerStep: pick("maxToolCallsPerStep", o.maxToolCallsPerStep, d.maxToolCallsPerStep),
    maxModelCallsPerJob: pick("maxModelCallsPerJob", o.maxModelCallsPerJob, d.maxModelCallsPerJob),
    maxCostUsdPerJob: pick("maxCostUsdPerJob", o.maxCostUsdPerJob, d.maxCostUsdPerJob),
    stepTimeoutMs: pick("stepTimeoutMs", o.stepTimeoutMs, d.stepTimeoutMs),
    workers: pick("workers", o.workers, d.workers),
    verifierCallEstimateUsd: pick("verifierCallEstimateUsd", o.verifierCallEstimateUsd, d.verifierCallEstimateUsd),
    seller: Object.freeze({
      maxImageBytes: pick("seller.maxImageBytes", seller.maxImageBytes, d.seller.maxImageBytes),
      maxConcurrentJobs: pick("seller.maxConcurrentJobs", seller.maxConcurrentJobs, d.seller.maxConcurrentJobs),
      maxModelCalls: pick("seller.maxModelCalls", seller.maxModelCalls, d.seller.maxModelCalls),
      maxSpendUsd: pick("seller.maxSpendUsd", seller.maxSpendUsd, d.seller.maxSpendUsd),
    }),
  });
}

export function loadConfig(path: string): AgentConfig {
  return makeConfig(JSON.parse(readFileSync(path, "utf8")));
}
