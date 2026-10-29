import assert from "node:assert/strict";
import { test } from "node:test";

import { MuseImageRefused } from "../src/render.ts";
import { parseFindings, VerifierProtocolError } from "../src/schema.ts";
import { providersFromEnv } from "../src/serve.ts";
import { ATTRIBUTES } from "../src/types.ts";
import { VERIFIER_MAX_TOKENS, VERIFIER_RETRY_MAX_TOKENS, VerifierTransportError, VerifierTruncatedError, verifierSystemPrompt } from "../src/verifier.ts";
import type { VerifierCallLog, VerifierFetch } from "../src/verifier.ts";
import { META_KEY_PLACEHOLDER, META_VERIFIER_MODEL, MetaVerifierConfigError, metaVerifier, metaVerifierModel, resolveUserEnvKey } from "../src/verifier-meta.ts";
import { encodePng } from "./helpers.ts";

const KEY = "meta-test-not-a-key"; // gitleaks:allow (test fixture, not a key)
const JPEG = Uint8Array.from([
  0xff, 0xd8,
  0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x03, 0x00, 0x04, 0x01, 0x01, 0x11, 0x00,
  0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x12, 0x34,
  0xff, 0xd9,
]);
const PNG = new Uint8Array(encodePng(2, 2, 3, new Uint8Array(12).fill(200)));
const req = { sources: [{ name: "1-front.jpg", bytes: JPEG }, { name: "2-back.jpg", bytes: PNG }], render: JPEG, renderId: "j-r0", scene: "studio" };
const FINDINGS = { findings: ATTRIBUTES.map((attribute) => ({ attribute, verdict: "match", confidence: 0.9, note: "same", evidence: { source_bbox: null, render_bbox: null } })) };

/** A Responses-API answer. */
const answer = (text: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text }] }], usage: { input_tokens: 6900, output_tokens: 1800, output_tokens_details: { reasoning_tokens: 1500 } }, ...extra });

function server(...bodies: [number, string][]) {
  const calls: { url: string; init: Parameters<VerifierFetch>[1] }[] = [];
  let i = 0;
  const fetch: VerifierFetch = async (url, init) => {
    calls.push({ url, init });
    const [status, body] = bodies[Math.min(i++, bodies.length - 1)]!;
    return { status, text: async () => body };
  };
  return { calls, fetch };
}

test("MS2 1: the request is the Responses API on api.meta.ai: muse-spark-1.3, the Baseten instructions, the same texts and images in order, key only in the header", async () => {
  const { calls, fetch } = server([200, answer("```json\n" + JSON.stringify(FINDINGS) + "\n```")]);
  const logs: VerifierCallLog[] = [];
  const v = metaVerifier({ key: KEY, env: {}, fetch, onCall: (l) => logs.push(l) });
  assert.deepEqual(v.identity, { provider: "meta", model: "muse-spark-1.3", base: "https://api.meta.ai/v1" });
  const out = await v.verify(req);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "https://api.meta.ai/v1/responses");
  assert.equal(calls[0]!.init.headers.authorization, `Bearer ${KEY}`);
  const body = JSON.parse(calls[0]!.init.body);
  assert.equal(body.model, META_VERIFIER_MODEL);
  assert.equal(body.instructions, verifierSystemPrompt(), "the same garment-check prompt as Baseten");
  assert.equal(body.max_output_tokens, VERIFIER_MAX_TOKENS);
  assert.equal(body.stream, false);
  const parts = body.input[0].content as { type: string }[];
  assert.deepEqual(parts.map((p) => p.type), ["input_text", "input_image", "input_text", "input_image", "input_text", "input_image", "input_text"]);
  assert.deepEqual(parseFindings(out.raw).length, ATTRIBUTES.length, "the same parser reads the answer");
  assert.deepEqual(out.usage, { prompt_tokens: 6900, completion_tokens: 1800, images: [{ bytes: JPEG.length, width: 4, height: 3 }, { bytes: PNG.length, width: 2, height: 2 }, { bytes: JPEG.length, width: 4, height: 3 }] });

  assert.equal(logs.length, 1);
  assert.equal(logs[0]!.provider, "meta");
  assert.equal(logs[0]!.request.headers.authorization, "Bearer [MODEL_API_KEY]");
  assert.equal(META_KEY_PLACEHOLDER, "[MODEL_API_KEY]");
  const logText = JSON.stringify(logs[0]);
  assert.equal(logText.includes(KEY), false);
  assert.equal(logText.includes(Buffer.from(JPEG).toString("base64")), false, "images are replaced by size and hash");
});

test("MS2 2: Muse Image and -contributor ids are refused before any request; MODEL_VERIFIER_META picks another listed id", () => {
  assert.equal(metaVerifierModel({ MODEL_VERIFIER_META: "muse-spark-1.2" }), "muse-spark-1.2");
  assert.throws(() => metaVerifierModel({ MODEL_VERIFIER_META: "muse-image-1.0" }), MuseImageRefused);
  assert.throws(() => metaVerifierModel({ MODEL_VERIFIER_META: "muse-spark-1.3-contributor" }), MetaVerifierConfigError);
  assert.throws(() => metaVerifier({ key: "", env: {}, fetch: server([200, "{}"]).fetch }), MetaVerifierConfigError);
});

test("MS2 3: an answer cut off at max_output_tokens is asked once more at the retry limit; twice cut off throws; a non-2xx or a non-JSON body throws", async () => {
  const cut = answer("{", { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } });
  const retried = server([200, cut], [200, answer(JSON.stringify(FINDINGS))]);
  const out = await metaVerifier({ key: KEY, env: {}, fetch: retried.fetch }).verify(req);
  assert.equal(JSON.parse(retried.calls[1]!.init.body).max_output_tokens, VERIFIER_RETRY_MAX_TOKENS);
  assert.equal(out.usage?.attempts?.length, 2);
  await assert.rejects(metaVerifier({ key: KEY, env: {}, fetch: server([200, cut]).fetch }).verify(req), VerifierTruncatedError);
  await assert.rejects(metaVerifier({ key: KEY, env: {}, fetch: server([400, JSON.stringify({ error: { message: "bad" } })]).fetch }).verify(req), VerifierTransportError);
  await assert.rejects(metaVerifier({ key: KEY, env: {}, fetch: server([200, "not json"]).fetch }).verify(req), VerifierProtocolError);
  await assert.rejects(metaVerifier({ key: KEY, env: {}, fetch: server([200, JSON.stringify({ status: "completed", output: [] })]).fetch }).verify(req), VerifierProtocolError);
});

test("MS2 4: VERIFIER_PROVIDER=meta with MODEL_API_KEY and a fetch makes the run live on the Meta verifier; without the fetch it stays fixture", () => {
  const { fetch } = server([200, "{}"]);
  const live = providersFromEnv({ VERIFIER_PROVIDER: "meta", MODEL_API_KEY: KEY }, { metaVerifierFetch: fetch });
  assert.equal(live.mode.fixture, false);
  assert.equal(live.providers.verifier.identity.provider, "meta");
  assert.match(live.mode.labels.verify, /^meta \/ muse-spark-1\.3/);
  const noFetch = providersFromEnv({ VERIFIER_PROVIDER: "meta", MODEL_API_KEY: KEY }, { verifierFetch: fetch });
  assert.equal(noFetch.mode.fixture, true, "the Baseten fetch is not used for the Meta verifier");
  const baseten = providersFromEnv({ BASETEN_API_KEY: KEY }, { verifierFetch: fetch, metaVerifierFetch: fetch });
  assert.equal(baseten.providers.verifier.identity.provider, "baseten", "without VERIFIER_PROVIDER=meta nothing changes");
});

test("MS2 5: MODEL_API_KEY is read from the process env first, then the Windows User env", () => {
  assert.deepEqual(resolveUserEnvKey({ MODEL_API_KEY: "own" }, "MODEL_API_KEY", { platform: "win32", readUserEnv: () => "user" }), { key: "own", source: "process_env" });
  assert.deepEqual(resolveUserEnvKey({}, "MODEL_API_KEY", { platform: "win32", readUserEnv: () => "user" }), { key: "user", source: "user_env" });
  assert.equal(resolveUserEnvKey({}, "MODEL_API_KEY", { platform: "linux", readUserEnv: () => "user" }), null);
});

test("MS2 6: the judge view names Muse Spark on the Meta Model API only from the recorded id", async () => {
  const { verifierName } = await import("../src/present.ts");
  assert.equal(verifierName({ verifier: { provider: "meta", model: "muse-spark-1.3", base: "https://api.meta.ai/v1" } }), "Muse Spark 1.3 via the Meta Model API (muse-spark-1.3)");
  assert.equal(verifierName({ verifier: { provider: "baseten", model: "meta-models/muse-spark-open-1026" } }), "Muse Spark Open via Baseten (meta-models/muse-spark-open-1026)");
  assert.equal(verifierName({ verifier: { provider: "meta", model: "some-other-model" } }), "verifier some-other-model via meta");
});
