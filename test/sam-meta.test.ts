import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { fixtureProviders, runJob } from "../src/pipeline.ts";
import type { SourceImage } from "../src/pipeline.ts";
import { RECEIPT_FILE } from "../src/prior.ts";
import { parseReceipt, recordedClock } from "../src/receipt.ts";
import { META_MODEL_API_URL, META_SAM_MODEL_ID, META_SAM_REQUEST_MODEL, SegmentTransportError, joinOutputText, metaSamRequestBody, metaSamTransport, metaSamTransportFromEnv } from "../src/sam-meta.ts";
import type { FetchLike, SamCallLog } from "../src/sam-meta.ts";
import { SegmentConfigError, SegmentProtocolError, samSegmenter } from "../src/sam.ts";
import { ATTRIBUTES } from "../src/types.ts";
import { sha256Hex } from "../src/util.ts";
import { encodePng } from "./helpers.ts";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 2, 3]);
const PNG = encodePng(2, 2, 1, new Uint8Array([0, 255, 255, 0]));
const front: SourceImage = { name: "1-front.jpg", bytes: JPEG };
const back: SourceImage = { name: "2-back.png", bytes: PNG };
const KEY = "test-key-value-never-logged";

/** An SSE body from a list of events. */
const sse = (...events: unknown[]) => events.map((e) => (typeof e === "string" ? e : `data: ${JSON.stringify(e)}`)).join("\n\n") + "\n\n";
const delta = (text: string) => ({ type: "response.output_text.delta", delta: text });

/** A fetch that records every request and answers from a table by image name. */
function fakeFetch(answer: (body: string) => { status: number; text: string }) {
  const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers, body: init.body });
    const a = answer(init.body);
    return { ok: a.status >= 200 && a.status < 300, status: a.status, text: async () => a.text };
  };
  return { calls, fetch };
}

test("the request is the Responses-API shape Grok specified: sam-3.1, stream, one input_text and one input_image data URL, the metadata, the key in the header only", async () => {
  const body = JSON.parse(metaSamRequestBody("the garment", front)) as { model: string; stream: boolean; input: { role: string; content: { type: string; text?: string; image_url?: string }[] }[]; metadata: Record<string, string> };
  assert.equal(body.model, META_SAM_REQUEST_MODEL);
  assert.equal(body.stream, true);
  assert.deepEqual(body.metadata, { mask_encoding: "one_bit", include_confidence: "true" });
  assert.equal(body.input.length, 1);
  assert.equal(body.input[0]!.role, "user");
  assert.deepEqual(body.input[0]!.content.map((c) => c.type), ["input_text", "input_image"]);
  assert.equal(body.input[0]!.content[0]!.text, "the garment");
  assert.equal(body.input[0]!.content[1]!.image_url, `data:image/jpeg;base64,${JPEG.toString("base64")}`);
  const pngBody = JSON.parse(metaSamRequestBody("the garment", back)) as typeof body;
  assert.match(pngBody.input[0]!.content[1]!.image_url!, /^data:image\/png;base64,/);
  assert.throws(() => metaSamRequestBody("the garment", { name: "note.txt", bytes: Buffer.from("words") }), SegmentConfigError);

  const parsed: string[] = [];
  const { calls, fetch } = fakeFetch(() => ({ status: 200, text: sse(delta("no match here"), { type: "response.completed", response: {} }) }));
  const transport = metaSamTransportFromEnv({ MODEL_API_KEY: ` ${KEY} ` }, fetch, (text) => (parsed.push(text), { segments: [] }));
  const out = await transport({ model: META_SAM_MODEL_ID, prompt: "the garment", image: front });
  assert.deepEqual(out, { segments: [] });
  assert.deepEqual(parsed, [], "no mask token, so the parser is not asked");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, META_MODEL_API_URL);
  assert.equal(calls[0]!.headers.authorization, `Bearer ${KEY}`);
  assert.equal(calls[0]!.headers["content-type"], "application/json");
  assert.ok(!calls[0]!.body.includes(KEY), "the key is not in the body");
});

test("the deltas of the stream are joined in order and handed to the parser only when a mask token is present; the segments reach the receipt labelled per image", async () => {
  const seen: { text: string; image: string }[] = [];
  const { calls, fetch } = fakeFetch((body) => {
    const isFront = body.includes("image/jpeg");
    return isFront
      ? { status: 200, text: sse({ type: "response.created" }, delta("here: <|ma"), delta("sk;0,1,2|> done"), { type: "response.output_text.done", text: "ignored" }, { type: "response.completed", response: {} }, "data: [DONE]") }
      : { status: 200, text: sse(delta("nothing matched")) };
  });
  const parse = (text: string, image: SourceImage) => {
    seen.push({ text, image: image.name });
    return { segments: [{ label: "kurta", box: [0.1, 0.2, 0.5, 0.6], score: 0.9, mask: PNG.toString("base64") }] };
  };
  const segmenter = samSegmenter({ model: META_SAM_MODEL_ID, transport: metaSamTransport({ fetch, apiKey: () => KEY, parse }) });
  const segments = await segmenter.segment([front, back]);
  assert.deepEqual(seen, [{ text: "here: <|mask;0,1,2|> done", image: "1-front.jpg" }]);
  assert.equal(calls.length, 2, "one request per image");
  assert.deepEqual(segments.map((s) => [s.label, s.score]), [["1-front.jpg/kurta", 0.9]]);
  assert.deepEqual(segmenter.identity, { provider: "meta", model: META_SAM_MODEL_ID });

  // Through the pipeline: the segments entry carries the claim and the mask hash; the back photo's "no match" is not an error.
  const p = { ...fixtureProviders({ renders: () => Buffer.from("r"), findings: () => ({ findings: ATTRIBUTES.map((attribute) => ({ attribute, verdict: "match", confidence: 0.95 })) }) }), segmenter };
  const r = await runJob(
    { jobId: "meta-sam", garmentNote: "kurta", scenes: ["studio"], sources: [front, back] },
    { outRoot: mkdtempSync(join(tmpdir(), "sam-meta-")), providers: p, provenance: "fixture", clock: recordedClock(Array(20).fill("2026-10-28T03:00:00.000Z")) },
  );
  assert.equal(r.refused, null);
  const seg = parseReceipt(readFileSync(join(r.dir, RECEIPT_FILE), "utf8")).find((e) => e.kind === "segments")!.payload as { count: number; segmenter: unknown; segments: { label: string; mask_sha256: string | null }[] };
  assert.equal(seg.count, 1);
  assert.deepEqual(seg.segmenter, { provider: "meta", model: META_SAM_MODEL_ID });
  assert.equal(seg.segments[0]!.label, "1-front.jpg/kurta");
  assert.match(String(seg.segments[0]!.mask_sha256), /^[0-9a-f]{64}$/);
});

test("joinOutputText: a failure event, a non-JSON event, an empty body and a JSON body with no text all throw; a plain JSON answer gives its output text", () => {
  assert.throws(() => joinOutputText(sse(delta("a"), { type: "response.failed", response: { error: { message: "quota" } } }), "x.jpg"), /server reported a failure: quota/);
  assert.throws(() => joinOutputText(sse({ type: "error", error: { code: "rate_limited" } }), "x.jpg"), /rate_limited/);
  assert.throws(() => joinOutputText("data: {not json}\n\n", "x.jpg"), SegmentProtocolError);
  assert.throws(() => joinOutputText("", "x.jpg"), /empty body/);
  assert.throws(() => joinOutputText(sse({ type: "response.created" }), "x.jpg"), /no output_text delta and no completed response/);
  assert.throws(() => joinOutputText(sse({ type: "response.completed", response: { output: [] } }), "x.jpg"), /completed response has no output text/);
  assert.throws(() => joinOutputText("{\"output\": 1}", "x.jpg"), /JSON body has no output text/);
  assert.throws(() => joinOutputText("{nope", "x.jpg"), /neither an event stream nor JSON/);
  assert.equal(joinOutputText(sse({ type: "response.completed", response: { output: [{ content: [{ type: "output_text", text: "<|mask;1|>" }] }] } }), "x.jpg"), "<|mask;1|>");
  assert.equal(joinOutputText("{\"output_text\": \"whole\"}", "x.jpg"), "whole");
  assert.equal(joinOutputText(sse(delta("a"), delta("b"), "data: [DONE]"), "x.jpg"), "ab");
});

test("before any request: a wrong MODEL_SEGMENT, a blank key, or a non-image source is refused; an HTTP error names the status and never the key", async () => {
  const { calls, fetch } = fakeFetch(() => ({ status: 401, text: "{\"error\":{\"message\":\"bad key\"}}" }));
  const parse = () => ({ segments: [] });
  await assert.rejects(metaSamTransport({ fetch, apiKey: () => KEY, parse })({ model: "sam-3.1", prompt: "p", image: front }), /MODEL_SEGMENT says "sam-3.1"/);
  await assert.rejects(metaSamTransportFromEnv({}, fetch, parse)({ model: META_SAM_MODEL_ID, prompt: "p", image: front }), /MODEL_API_KEY is not set/);
  await assert.rejects(metaSamTransportFromEnv({ MODEL_API_KEY: KEY }, fetch, parse)({ model: META_SAM_MODEL_ID, prompt: "p", image: { name: "note.txt", bytes: Buffer.from("words") } }), SegmentConfigError);
  assert.equal(calls.length, 0, "nothing was sent");

  let err: unknown;
  try {
    await metaSamTransportFromEnv({ MODEL_API_KEY: KEY }, fetch, parse)({ model: META_SAM_MODEL_ID, prompt: "p", image: front });
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof SegmentTransportError);
  assert.equal((err as Error).message, "Meta Model API answered HTTP 401 for 1-front.jpg");
  assert.equal(calls.length, 1);

  // Through the pipeline every one of these is a segment_failed refusal before any render.
  const segmenter = samSegmenter({ model: META_SAM_MODEL_ID, transport: metaSamTransportFromEnv({ MODEL_API_KEY: KEY }, fetch, parse) });
  const p = { ...fixtureProviders({ renders: () => Buffer.from("r"), findings: () => ({ findings: [] }) }), segmenter };
  const r = await runJob(
    { jobId: "meta-sam-401", garmentNote: "kurta", scenes: ["studio"], sources: [front] },
    { outRoot: mkdtempSync(join(tmpdir(), "sam-meta-")), providers: p, provenance: "fixture", clock: recordedClock(Array(20).fill("2026-10-28T03:00:00.000Z")) },
  );
  assert.equal(r.refused?.rule, "segment_failed");
  assert.equal(r.refused?.reason, "SegmentTransportError: Meta Model API answered HTTP 401 for 1-front.jpg");
  assert.deepEqual(r.renders, []);
});

test("onCall gets one redacted log per request sent (rule 13): no header, image as size and hash, the answer, the joined text; failures are logged before they throw; nothing for a request never sent", async () => {
  const logs: SamCallLog[] = [];
  const onCall = (l: SamCallLog) => logs.push(l);
  const parse = () => ({ segments: [] });
  // The server echoes the key back: the log must still not hold it.
  const { fetch } = fakeFetch((body) => (body.includes("image/jpeg") ? { status: 200, text: sse(delta(`<|mask;1|> ${KEY}`)) } : { status: 500, text: "oops" }));
  const transport = metaSamTransport({ fetch, apiKey: () => KEY, parse, onCall });
  await transport({ model: META_SAM_MODEL_ID, prompt: "kurta", image: front });
  await assert.rejects(transport({ model: META_SAM_MODEL_ID, prompt: "kurta", image: back }), SegmentTransportError);
  await assert.rejects(transport({ model: "sam-3.1", prompt: "kurta", image: front }), SegmentConfigError);
  assert.equal(logs.length, 2, "the refused-before-sending call is not logged");

  const [ok, failed] = logs as [SamCallLog, SamCallLog];
  const json = JSON.stringify(logs);
  assert.ok(!json.includes(KEY), "the key's value is nowhere in the logs");
  assert.ok(!json.includes(JPEG.toString("base64")) && !json.includes(PNG.toString("base64")), "no image bytes");
  assert.ok(!/authorization|bearer/i.test(json), "no header");
  assert.match(ok.started_at, /^\d{4}-\d\d-\d\dT/);
  assert.equal(ok.url, META_MODEL_API_URL);
  assert.equal(ok.model_segment, META_SAM_MODEL_ID);
  assert.equal(ok.prompt, "kurta");
  assert.deepEqual(ok.image, { name: "1-front.jpg", bytes: JPEG.length, sha256: sha256Hex(JPEG) });
  assert.match(JSON.stringify(ok.request), new RegExp(`data:image/jpeg;base64,\\[${JPEG.length} bytes, sha256 ${sha256Hex(JPEG)}, left out of the log\\]`));
  assert.equal(ok.response!.status, 200);
  assert.equal(ok.output_text, "<|mask;1|> [MODEL_API_KEY]");
  assert.equal(ok.mask_token_present, true);
  assert.equal(ok.error, null);
  assert.equal(failed.response!.status, 500);
  assert.equal(failed.output_text, null);
  assert.equal(failed.mask_token_present, null);
  assert.equal(failed.error, "SegmentTransportError: Meta Model API answered HTTP 500 for 2-back.png");

  // A fetch that throws (network) is logged with no response, then rethrown.
  const net = metaSamTransport({ fetch: async () => { throw new TypeError("fetch failed"); }, apiKey: () => KEY, parse, onCall });
  await assert.rejects(net({ model: META_SAM_MODEL_ID, prompt: "kurta", image: front }), /fetch failed/);
  assert.equal(logs.length, 3);
  assert.equal(logs[2]!.response, null);
  assert.equal(logs[2]!.error, "TypeError: fetch failed");
});
