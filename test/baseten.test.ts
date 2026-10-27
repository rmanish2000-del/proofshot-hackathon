import assert from "node:assert/strict";
import { test } from "node:test";

import { BASETEN_MODEL, BasetenConfigError, KEY_PLACEHOLDER, basetenCall } from "../src/baseten.ts";
import type { Fetch } from "../src/baseten.ts";
import { MuseImageRefused } from "../src/render.ts";

const KEY = "test-key-0123456789abcdef";
const messages = [{ role: "user" as const, content: "hi" }];

/** A fetch that records every request and answers with the given status and body. */
function recording(status: number, body: string | (() => never)) {
  const calls: { url: string; init: Parameters<Fetch>[1] }[] = [];
  const fetch: Fetch = async (url, init) => {
    calls.push({ url, init });
    if (typeof body === "function") body();
    return { status, text: async () => body as string };
  };
  return { calls, fetch };
}

/** A clock that returns the given epoch milliseconds in order. */
function ticks(...ms: number[]) {
  return () => ms.shift()!;
}

test("one call goes to Baseten's chat endpoint with the key as a bearer token and Muse Spark Open as the model", async () => {
  const { calls, fetch } = recording(200, JSON.stringify({ choices: [{ message: { content: "ready" } }], usage: { prompt_tokens: 9 } }));
  const log = await basetenCall({ env: { BASETEN_API_KEY: ` ${KEY} ` }, fetch, messages, now: ticks(1_000, 1_250) });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "https://inference.baseten.co/v1/chat/completions");
  assert.equal(calls[0]!.init.headers.authorization, `Bearer ${KEY}`);
  assert.deepEqual(JSON.parse(calls[0]!.init.body), { model: BASETEN_MODEL, messages, max_tokens: 64 });
  assert.equal(BASETEN_MODEL, "meta-models/muse-spark-open-1026");
  assert.deepEqual(
    [log.provider, log.model, log.started_at, log.finished_at, log.latency_ms, log.error],
    ["baseten", BASETEN_MODEL, "1970-01-01T00:00:01.000Z", "1970-01-01T00:00:01.250Z", 250, null],
  );
  assert.deepEqual(log.response, { status: 200, body: { choices: [{ message: { content: "ready" } }], usage: { prompt_tokens: 9 } } });
});

test("the log never holds the key: the auth header is a placeholder and an echoed key is replaced", async () => {
  const { fetch } = recording(401, `{"error":"bad key ${KEY}"}`);
  const log = await basetenCall({ env: { BASETEN_API_KEY: KEY }, fetch, messages });
  const text = JSON.stringify(log);
  assert.equal(text.includes(KEY), false);
  assert.equal(log.request.headers.authorization, `Bearer ${KEY_PLACEHOLDER}`);
  assert.deepEqual(log.response, { status: 401, body: { error: `bad key ${KEY_PLACEHOLDER}` } });
  assert.equal(log.error, "HttpError: status 401");
});

test("a missing or blank key, or a Muse Image model, throws before any request", async () => {
  const { calls, fetch } = recording(200, "{}");
  for (const env of [{}, { BASETEN_API_KEY: "  " }]) {
    await assert.rejects(basetenCall({ env, fetch, messages }), BasetenConfigError);
  }
  await assert.rejects(basetenCall({ env: { BASETEN_API_KEY: KEY, MODEL_VERIFIER: "meta/muse-image-1" }, fetch, messages }), MuseImageRefused);
  assert.equal(calls.length, 0);
});

test("MODEL_VERIFIER overrides the model, and a non-JSON body is kept as text", async () => {
  const { calls, fetch } = recording(200, "plain");
  const log = await basetenCall({ env: { BASETEN_API_KEY: KEY, MODEL_VERIFIER: " other/model " }, fetch, messages, maxTokens: 8 });
  assert.deepEqual(JSON.parse(calls[0]!.init.body), { model: "other/model", messages, max_tokens: 8 });
  assert.deepEqual([log.model, log.response?.body, log.error], ["other/model", "plain", null]);
});

test("a network error or timeout is logged with no response, not thrown, and the key is still scrubbed", async () => {
  const { fetch } = recording(0, () => {
    throw new TypeError(`fetch failed for ${KEY}`);
  });
  const log = await basetenCall({ env: { BASETEN_API_KEY: KEY }, fetch, messages });
  assert.equal(log.response, null);
  assert.equal(log.error, `TypeError: fetch failed for ${KEY_PLACEHOLDER}`);
});
