import assert from "node:assert/strict";
import { test } from "node:test";

import { BASETEN_MODEL, BasetenConfigError, KEY_PLACEHOLDER } from "../src/baseten.ts";
import { runJob } from "../src/pipeline.ts";
import { parseReceipt } from "../src/receipt.ts";
import { MuseImageRefused, standInRenderer } from "../src/render.ts";
import { FINDINGS_SCHEMA, VerifierProtocolError, parseFindings } from "../src/schema.ts";
import { ATTRIBUTES } from "../src/types.ts";
import { sha256Hex } from "../src/util.ts";
import { loadRecording, recordJob, replayJob } from "../src/replay.ts";
import {
  MAX_IMAGE_BYTES,
  VERIFIER_MAX_TOKENS,
  VERIFIER_RETRY_MAX_TOKENS,
  VERIFIER_RETRY_TIMEOUT_MS,
  VERIFIER_TIMEOUT_MS,
  VerifierTransportError,
  VerifierTruncatedError,
  basetenVerifier,
  extractJsonObject,
  imageSize,
  redactImages,
  verifierMessages,
  verifierSystemPrompt,
} from "../src/verifier.ts";
import type { VerifierCallLog, VerifierFetch } from "../src/verifier.ts";
import { encodePng } from "./helpers.ts";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const KEY = "fake-key-aaaaaaaaaaaaaaaa"; // gitleaks:allow (low-entropy test fixture, not a key)
const env = { BASETEN_API_KEY: KEY };

// A tiny baseline JPEG: SOI, SOF0 (8-bit, 4 x 3, one component), one scan, EOI.
const JPEG = Uint8Array.from([
  0xff, 0xd8,
  0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x03, 0x00, 0x04, 0x01, 0x01, 0x11, 0x00,
  0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x12, 0x34,
  0xff, 0xd9,
]);
const PNG = new Uint8Array(encodePng(2, 2, 3, new Uint8Array(12).fill(200)));

const findings = {
  findings: ATTRIBUTES.map((attribute) => ({ attribute, verdict: "match", confidence: 0.9, note: "same", evidence: { source_bbox: null, render_bbox: null } })),
};
const answer = (content: unknown, usage?: unknown) => JSON.stringify({ choices: [{ message: { role: "assistant", content, reasoning_content: "thinking" } }], usage });

function recording(status: number, body: string | (() => never)) {
  const calls: { url: string; init: Parameters<VerifierFetch>[1] }[] = [];
  const fetch: VerifierFetch = async (url, init) => {
    calls.push({ url, init });
    if (typeof body === "function") body();
    return { status, text: async () => body as string };
  };
  return { calls, fetch };
}

const req = { sources: [{ name: "1-front.jpg", bytes: JPEG }, { name: "2-back.jpg", bytes: PNG }], render: JPEG, renderId: "j-r0", scene: "studio" };

test("the system prompt is the §4 schema verbatim plus the one-JSON rule; the user message names each image before its data URL and ends with the instruction", () => {
  const prompt = verifierSystemPrompt();
  assert.ok(prompt.includes(JSON.stringify(FINDINGS_SCHEMA, null, 2)));
  assert.ok(prompt.endsWith("Return only JSON matching this schema, no prose."));

  const [system, user] = verifierMessages(req);
  assert.equal(system!.role, "system");
  assert.equal(user!.role, "user");
  const parts = user!.content as { type: string; text?: string; image_url?: { url: string; detail: string } }[];
  assert.deepEqual(parts.map((p) => p.type), ["text", "image_url", "text", "image_url", "text", "image_url", "text"]);
  assert.match(parts[0]!.text!, /^source 1: 1-front\.jpg/);
  assert.ok(parts[1]!.image_url!.url.startsWith(`data:image/jpeg;base64,${Buffer.from(JPEG).toString("base64")}`));
  assert.equal(parts[1]!.image_url!.detail, "auto");
  assert.match(parts[2]!.text!, /^source 2: 2-back\.jpg/);
  assert.ok(parts[3]!.image_url!.url.startsWith("data:image/png;base64,"));
  assert.match(parts[4]!.text!, /^render/);
  assert.match(parts[6]!.text!, /Return only JSON/);

  assert.throws(() => verifierMessages({ sources: [], render: JPEG }), /no source photos/);
  assert.throws(() => verifierMessages({ sources: [{ name: "a.txt", bytes: new Uint8Array([1, 2, 3]) }], render: JPEG }), /not a JPEG or PNG/);
  const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
  big.set(JPEG);
  assert.throws(() => verifierMessages({ sources: [{ name: "big.jpg", bytes: big }], render: JPEG }), /over the .* byte limit/);
  assert.throws(() => verifierMessages({ sources: Array(8).fill({ name: "a.jpg", bytes: JPEG }), render: JPEG }), /image limit/);
});

test("one call: Baseten chat completions, bearer key, temperature 0, max_tokens 8192, no response_format; the raw answer is the content and usage is read", async () => {
  const { calls, fetch } = recording(200, answer(JSON.stringify(findings), { prompt_tokens: 886, completion_tokens: 300, prompt_tokens_details: { cached_tokens: 128 } }));
  const logs: VerifierCallLog[] = [];
  const v = basetenVerifier({ env, fetch, onCall: (l) => logs.push(l), now: (() => { const t = [1_000, 3_500]; return () => t.shift()!; })() });
  assert.deepEqual(v.identity, { provider: "baseten", model: BASETEN_MODEL, base: "https://inference.baseten.co/v1" });

  const out = await v.verify(req);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "https://inference.baseten.co/v1/chat/completions");
  assert.equal(calls[0]!.init.headers.authorization, `Bearer ${KEY}`);
  const body = JSON.parse(calls[0]!.init.body) as Record<string, unknown>;
  assert.equal(body.model, BASETEN_MODEL);
  assert.equal(body.temperature, 0);
  assert.equal(body.max_tokens, VERIFIER_MAX_TOKENS);
  assert.equal(VERIFIER_MAX_TOKENS, 8192, "4096 cut the kurta-01 composite answer off: evidence/verifier-2026-10-28T12-30-54-012Z.json");
  assert.equal("response_format" in body, false, "Muse Spark Open on Baseten has no JSON mode");
  assert.deepEqual(body.messages, verifierMessages(req));

  assert.equal(out.raw, JSON.stringify(findings));
  assert.equal(parseFindings(out.raw).length, ATTRIBUTES.length);
  assert.deepEqual(out.usage, { prompt_tokens: 886, completion_tokens: 300, cached_tokens: 128, images: [{ bytes: JPEG.length, width: 4, height: 3 }, { bytes: PNG.length, width: 2, height: 2 }, { bytes: JPEG.length, width: 4, height: 3 }] });

  assert.equal(logs.length, 1);
  const log = logs[0]!;
  assert.deepEqual([log.provider, log.model, log.render_id, log.started_at, log.finished_at, log.latency_ms, log.error], ["baseten", BASETEN_MODEL, "j-r0", "1970-01-01T00:00:01.000Z", "1970-01-01T00:00:03.500Z", 2500, null]);
  assert.equal(log.response!.status, 200);
  const text = JSON.stringify(log);
  assert.equal(text.includes(KEY), false, "the log never holds the key");
  assert.equal(text.includes(Buffer.from(JPEG).toString("base64")), false, "the log never holds image bytes");
  assert.ok(text.includes(`[${JPEG.length} bytes, sha256 ${sha256Hex(JPEG)}, left out of the log]`));
  assert.equal(log.request.headers.authorization, `Bearer ${KEY_PLACEHOLDER}`);
});

test("defensive parse: code fences and prose around the JSON object are dropped, nothing inside is changed", () => {
  const json = JSON.stringify(findings);
  assert.equal(extractJsonObject(json), json);
  assert.equal(extractJsonObject(`\`\`\`json\n${json}\n\`\`\``), json);
  assert.equal(extractJsonObject(`Here are the findings:\n${json}\nHope this helps.`), json);
  assert.equal(extractJsonObject("no object here"), "no object here");
  assert.equal(extractJsonObject("} {"), "} {");
  assert.throws(() => parseFindings(extractJsonObject("no object here")), VerifierProtocolError);
});

test("fail closed: a non-2xx status, a network error, a non-JSON body and null content all throw after the log is written; no finding is invented", async () => {
  const cases: { body: string | (() => never); status: number; error: RegExp; type: new (...a: never[]) => Error }[] = [
    { status: 500, body: `{"error":"boom ${KEY}"}`, error: /HTTP 500/, type: VerifierTransportError },
    { status: 200, body: () => { throw new TypeError("fetch failed"); }, error: /fetch failed/, type: VerifierTransportError },
    { status: 200, body: "<html>", error: /not JSON/, type: VerifierProtocolError },
    { status: 200, body: answer(null), error: /no message content/, type: VerifierProtocolError },
    { status: 200, body: answer("  "), error: /no message content/, type: VerifierProtocolError },
  ];
  for (const c of cases) {
    const { fetch } = recording(c.status, c.body);
    const logs: VerifierCallLog[] = [];
    const v = basetenVerifier({ env, fetch, onCall: (l) => logs.push(l) });
    await assert.rejects(v.verify(req), (e: unknown) => e instanceof c.type && c.error.test((e as Error).message));
    assert.equal(logs.length, 1, "the log is written before the throw");
    assert.equal(JSON.stringify(logs[0]).includes(KEY), false);
  }
  // Prose instead of JSON reaches parseFindings, which refuses it: the pipeline records not_verified.
  const { fetch } = recording(200, answer("The garment looks the same to me."));
  const v = basetenVerifier({ env, fetch });
  const out = await v.verify(req);
  assert.throws(() => parseFindings(out.raw), VerifierProtocolError);
});

test("a blank key or a Muse Image model id is refused before any request", () => {
  const { calls, fetch } = recording(200, answer(JSON.stringify(findings)));
  assert.throws(() => basetenVerifier({ env: {}, fetch }), BasetenConfigError);
  assert.throws(() => basetenVerifier({ env: { ...env, MODEL_VERIFIER: "meta-models/muse-image-1.0" }, fetch }), MuseImageRefused);
  assert.equal(calls.length, 0);
});

test("imageSize reads a JPEG frame header and a PNG IHDR, and is null for anything else", () => {
  assert.deepEqual(imageSize(JPEG), { width: 4, height: 3 });
  assert.deepEqual(imageSize(PNG), { width: 2, height: 2 });
  assert.equal(imageSize(new Uint8Array([1, 2, 3])), null);
  assert.equal(imageSize(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])), null);
  const redacted = redactImages(verifierMessages(req)) as { content: { type: string; image_url?: { url: string } }[] }[];
  assert.match(redacted[1]!.content[1]!.image_url!.url, /^data:image\/jpeg;base64,\[\d+ bytes, sha256 [0-9a-f]{64}, left out of the log\]$/);
});

test("in the pipeline: a live verifier's findings reach the gate, its identity and usage are on the verifier entry, a bad answer is not_verified", async () => {
  const good = recording(200, answer(`\`\`\`json\n${JSON.stringify(findings)}\n\`\`\``, { prompt_tokens: 10, completion_tokens: 5 }));
  const providers = (fetch: VerifierFetch) => ({
    segmenter: { segment: async () => [] },
    renderer: standInRenderer(),
    verifier: basetenVerifier({ env, fetch }),
    fidelity: { check: async () => ({ decision: "RELEASE" as const, metrics: null, reasons: [] }) },
  });
  const out = mkdtempSync(join(tmpdir(), "verifier-"));
  const sources = [{ name: "1-front.jpg", bytes: JPEG }];
  const ok = await runJob({ jobId: "live-ok", garmentNote: "kurta", scenes: ["studio"], sources }, { outRoot: out, providers: providers(good.fetch), provenance: "live" });
  assert.equal(ok.renders[0]!.decision, "RELEASE");
  const entries = parseReceipt(readFileSync(join(ok.dir, "receipt.jsonl"), "utf8"));
  const verifier = entries.find((e) => e.kind === "verifier")!.payload as { findings: unknown[]; verifier: unknown; usage: unknown; error?: string };
  assert.equal(verifier.findings.length, ATTRIBUTES.length);
  assert.deepEqual(verifier.verifier, { provider: "baseten", model: BASETEN_MODEL, base: "https://inference.baseten.co/v1" });
  assert.deepEqual(verifier.usage, { prompt_tokens: 10, completion_tokens: 5, images: [{ bytes: JPEG.length, width: 4, height: 3 }, { bytes: JPEG.length, width: 4, height: 3 }] });
  assert.equal(verifier.error, undefined);

  const bad = recording(200, answer("Looks fine."));
  const refused = await runJob({ jobId: "live-bad", garmentNote: "kurta", scenes: ["studio"], sources }, { outRoot: out, providers: providers(bad.fetch), provenance: "live" });
  assert.equal(refused.renders[0]!.decision, "REFUSE");
  assert.equal(refused.renders[0]!.cited!.rule, "not_verified");
});

// NR2: the shape of the cut-off answer in evidence/verifier-2026-10-28T12-30-54-012Z.json.
const choice = (content: string, finish_reason: string, completion: number, reasoning: number) =>
  JSON.stringify({
    choices: [{ message: { role: "assistant", content, reasoning_content: "thinking" }, finish_reason }],
    usage: { prompt_tokens: 7354, completion_tokens: completion, completion_tokens_details: { reasoning_tokens: reasoning } },
  });
const CUT = choice('{"findings":[{"attribute":"color","verdict":"match","confidence":0.9', "length", 8192, 8150);
const FULL = choice(JSON.stringify(findings), "stop", 9000, 8100);

function answers(...bodies: string[]) {
  const calls: { body: Record<string, unknown> }[] = [];
  const fetch: VerifierFetch = async (_url, init) => {
    calls.push({ body: JSON.parse(init.body) as Record<string, unknown> });
    const body = bodies[calls.length - 1] ?? bodies[bodies.length - 1]!;
    return { status: 200, text: async () => body };
  };
  return { calls, fetch };
}

test("finish_reason stop: one call, no retry, no attempts on the usage", async () => {
  const { calls, fetch } = answers(choice(JSON.stringify(findings), "stop", 1810, 1700));
  const out = await basetenVerifier({ env, fetch }).verify(req);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.body.max_tokens, VERIFIER_MAX_TOKENS);
  assert.equal(parseFindings(out.raw).length, ATTRIBUTES.length);
  assert.equal(out.usage?.attempts, undefined);
});

test("finish_reason length: the cut-off answer is never read; one retry at the higher limit, and both attempts are on the usage", async () => {
  const { calls, fetch } = answers(CUT, FULL);
  const logs: VerifierCallLog[] = [];
  const out = await basetenVerifier({ env, fetch, onCall: (l) => logs.push(l) }).verify(req);
  assert.deepEqual(calls.map((c) => c.body.max_tokens), [VERIFIER_MAX_TOKENS, VERIFIER_RETRY_MAX_TOKENS]);
  assert.equal(VERIFIER_RETRY_MAX_TOKENS, 16384);
  assert.equal(logs.length, 2, "each attempt is logged");
  assert.equal(out.raw, JSON.stringify(findings), "the answer used is the retry's");
  assert.deepEqual(out.usage?.attempts, [
    { max_tokens: VERIFIER_MAX_TOKENS, finish_reason: "length", completion_tokens: 8192, reasoning_tokens: 8150 },
    { max_tokens: VERIFIER_RETRY_MAX_TOKENS, finish_reason: "stop", completion_tokens: 9000, reasoning_tokens: 8100 },
  ]);
  assert.equal(out.usage?.completion_tokens, 9000);
});

test("finish_reason length twice: VerifierTruncatedError, and in the pipeline the gate refuses as verifier_truncated with both attempts on the receipt", async () => {
  const { calls, fetch } = answers(CUT, CUT);
  await assert.rejects(basetenVerifier({ env, fetch }).verify(req), VerifierTruncatedError);
  assert.equal(calls.length, 2, "one retry, not more");

  const out = mkdtempSync(join(tmpdir(), "verifier-cut-"));
  const sources = [{ name: "1-front.jpg", bytes: JPEG }];
  const providers = {
    segmenter: { segment: async () => [] },
    renderer: standInRenderer(),
    verifier: basetenVerifier({ env, fetch: answers(CUT, CUT).fetch }),
    fidelity: { check: async () => ({ decision: "RELEASE" as const, metrics: null, reasons: [] }) },
  };
  const r = await runJob({ jobId: "live-cut", garmentNote: "kurta", scenes: ["studio"], sources }, { outRoot: out, providers, provenance: "live" });
  assert.equal(r.renders[0]!.decision, "REFUSE");
  assert.equal(r.renders[0]!.cited!.rule, "verifier_truncated");
  const entries = parseReceipt(readFileSync(join(r.dir, "receipt.jsonl"), "utf8"));
  const v = entries.find((e) => e.kind === "verifier")!.payload as { findings: unknown[]; usage: { attempts: { finish_reason: string }[] }; error: string };
  assert.deepEqual(v.findings, [], "a cut-off answer gives no findings");
  assert.deepEqual(v.usage.attempts.map((a) => a.finish_reason), ["length", "length"]);
  assert.match(v.error, /^VerifierTruncatedError: .*8192.*16384/);
  const gate = entries.find((e) => e.kind === "gate")!.payload as { reasons: { rule: string }[] };
  assert.equal(gate.reasons[0]!.rule, "verifier_truncated");
  assert.ok(gate.reasons.slice(1).every((x) => x.rule === "not_verified"));
  assert.equal(entries.some((e) => e.kind === "release"), false);

  // Recorded and replayed, the refusal and both attempts come back as they were.
  const to = join(mkdtempSync(join(tmpdir(), "verifier-rec-")), "cut");
  recordJob({ jobDir: r.dir, sources, to });
  const replay = await replayJob(loadRecording(to), { outRoot: mkdtempSync(join(tmpdir(), "verifier-replay-")) });
  assert.equal(replay.renders[0]!.cited!.rule, "verifier_truncated");
  const replayed = parseReceipt(readFileSync(join(replay.dir, "receipt.jsonl"), "utf8"));
  assert.deepEqual(replayed.slice(1).map((e) => e.payload), entries.slice(1).map((e) => e.payload));
});

/** A fetch that hangs until its signal aborts (as the live 17:08 and 17:11 calls did) for the listed call numbers, else answers. */
function hangs(hang: readonly number[], body: string) {
  let n = 0;
  const fetch: VerifierFetch = (_url, init) => {
    n++;
    if (!hang.includes(n)) return Promise.resolve({ status: 200, text: async () => body });
    // AbortSignal.timeout's timer is unref'd, so hold the event loop open until it fires.
    const keep = setInterval(() => {}, 1000);
    return new Promise((_resolve, reject) =>
      init.signal.addEventListener("abort", () => {
        clearInterval(keep);
        reject(init.signal.reason);
      }),
    );
  };
  return { fetch, calls: () => n };
}

test("NR4c: a timeout is sent once more with the longer timeout; both attempts are on the usage and both calls are logged", async () => {
  assert.equal(VERIFIER_RETRY_TIMEOUT_MS > VERIFIER_TIMEOUT_MS, true);
  const h = hangs([1], FULL);
  const logs: VerifierCallLog[] = [];
  const out = await basetenVerifier({ env, fetch: h.fetch, onCall: (l) => logs.push(l), timeoutMs: 20, retryTimeoutMs: 400 }).verify(req);
  assert.equal(h.calls(), 2);
  assert.equal(logs.length, 2);
  assert.match(logs[0]!.error!, /^TimeoutError/);
  assert.equal(out.raw, JSON.stringify(findings));
  assert.deepEqual(out.usage?.attempts, [
    { max_tokens: VERIFIER_MAX_TOKENS, finish_reason: null, timeout_ms: 20, error: "VerifierTransportError: TimeoutError: The operation was aborted due to timeout" },
    { max_tokens: VERIFIER_MAX_TOKENS, finish_reason: "stop", completion_tokens: 9000, reasoning_tokens: 8100, timeout_ms: 400 },
  ]);
});

test("NR4c: two timeouts refuse as not_verified (one retry, not more), with both attempts on the receipt, and replay keeps them", async () => {
  const h = hangs([1, 2, 3], FULL);
  const err = await basetenVerifier({ env, fetch: h.fetch, timeoutMs: 10, retryTimeoutMs: 20 }).verify(req).then(
    () => assert.fail("a second timeout must throw"),
    (e: unknown) => e as VerifierTransportError & { usage: { attempts: { timeout_ms: number; finish_reason: null }[] } },
  );
  assert.ok(err instanceof VerifierTransportError);
  assert.equal(err.timedOut, true);
  assert.equal(h.calls(), 2);
  assert.deepEqual(err.usage.attempts.map((a) => [a.timeout_ms, a.finish_reason]), [[10, null], [20, null]]);

  const out = mkdtempSync(join(tmpdir(), "verifier-timeout-"));
  const sources = [{ name: "1-front.jpg", bytes: JPEG }];
  const providers = {
    segmenter: { segment: async () => [] },
    renderer: standInRenderer(),
    verifier: basetenVerifier({ env, fetch: hangs([1, 2], FULL).fetch, timeoutMs: 10, retryTimeoutMs: 20 }),
    fidelity: { check: async () => ({ decision: "RELEASE" as const, metrics: null, reasons: [] }) },
  };
  const r = await runJob({ jobId: "live-timeout", garmentNote: "kurta", scenes: ["studio"], sources }, { outRoot: out, providers, provenance: "live" });
  assert.equal(r.renders[0]!.decision, "REFUSE");
  assert.equal(r.renders[0]!.cited!.rule, "not_verified");
  const entries = parseReceipt(readFileSync(join(r.dir, "receipt.jsonl"), "utf8"));
  const v = entries.find((e) => e.kind === "verifier")!.payload as { findings: unknown[]; usage: { attempts: { timeout_ms: number; error: string }[] }; error: string };
  assert.deepEqual(v.findings, []);
  assert.deepEqual(v.usage.attempts.map((a) => a.timeout_ms), [10, 20]);
  assert.ok(v.usage.attempts.every((a) => /TimeoutError/.test(a.error)));
  assert.match(v.error, /^VerifierTransportError: TimeoutError/);
  assert.equal(entries.some((e) => e.kind === "release"), false);

  const to = join(mkdtempSync(join(tmpdir(), "verifier-rec-")), "timeout");
  recordJob({ jobDir: r.dir, sources, to });
  const replay = await replayJob(loadRecording(to), { outRoot: mkdtempSync(join(tmpdir(), "verifier-replay-")) });
  assert.equal(replay.renders[0]!.cited!.rule, "not_verified");
  const replayed = parseReceipt(readFileSync(join(replay.dir, "receipt.jsonl"), "utf8"));
  assert.deepEqual(replayed.slice(1).map((e) => e.payload), entries.slice(1).map((e) => e.payload));
});

test("NR4c: an HTTP error is not a timeout and is not retried", async () => {
  const { calls, fetch } = recording(500, "{}");
  const err = await basetenVerifier({ env, fetch }).verify(req).catch((e: unknown) => e as VerifierTransportError & { usage?: unknown });
  assert.ok(err instanceof VerifierTransportError);
  assert.equal(err.timedOut, false);
  assert.equal(err.usage, undefined, "one request: no attempts list");
  assert.equal(calls.length, 1);
});
