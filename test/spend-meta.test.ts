import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { Ledger, LedgerEntry } from "../src/render-replicate.ts";
import { fileLedger } from "../src/render-replicate.ts";
import {
  META_RESERVE_USD, META_SPEND_CAP_USD, SAM_PRICE_PER_CALL_USD, SpendCapError, estimateMetaUsd, meteredFetch, metaLedgerPath, spendSummary, tokensUsd,
} from "../src/spend-meta.ts";

function memoryLedger(entries: LedgerEntry[] = []): Ledger & { entries: LedgerEntry[] } {
  return { entries, read: () => entries, append: (e) => void entries.push(e) };
}

function server(status: number, body: string) {
  const calls: string[] = [];
  const fetch = async (url: string, _init: { body: string }) => {
    calls.push(url);
    return { status, text: async () => body };
  };
  return { calls, fetch };
}

const VERIFIER_BODY = JSON.stringify({
  model: "meta-models/muse-spark-open-1026",
  max_tokens: 8192,
  messages: [{ role: "user", content: [{ type: "text", text: "compare" }, { type: "image_url", image_url: { url: "data:x" } }, { type: "image_url", image_url: { url: "data:y" } }] }],
});

test("CAP1 1: the Meta cap is 80 USD with 70 kept back, so calls stop at 10 USD", () => {
  assert.equal(META_SPEND_CAP_USD, 80);
  assert.equal(META_RESERVE_USD, 70);
  const s = spendSummary(memoryLedger([{ at: "t", prediction_id: "a", cost_usd: 2.5, estimated: true }]), META_SPEND_CAP_USD, META_RESERVE_USD);
  assert.deepEqual(s, { calls: 1, spent_usd: 2.5, cap_usd: 80, reserve_usd: 70, available_usd: 7.5 });
  assert.equal(metaLedgerPath({ LOCALAPPDATA: "C:\\L" }), join("C:\\L", "ProofShot", "meta-ledger.json"));
  assert.equal(metaLedgerPath({}), null);
});

test("CAP1 2: a verifier call is booked at its reported token usage, a SAM call at the per-image price, and the caller gets the same status and body", async () => {
  const ledger = memoryLedger();
  const answer = JSON.stringify({ choices: [{ message: { content: "{}" } }], usage: { prompt_tokens: 7000, completion_tokens: 2000 } });
  const v = server(200, answer);
  const res = await meteredFetch(v.fetch, { kind: "verifier", ledger, now: () => 0 })("https://baseten", { body: VERIFIER_BODY });
  assert.equal(res.status, 200);
  assert.equal(res.ok, true);
  assert.equal(await res.text(), answer);
  const s = server(500, "boom");
  const sam = await meteredFetch(s.fetch, { kind: "sam", ledger })("https://api.meta.ai", { body: "{}" });
  assert.equal(sam.ok, false, "a failed call is still booked: it reached the server");
  assert.deepEqual(ledger.entries.map((e) => e.cost_usd), [tokensUsd(7000, 2000), SAM_PRICE_PER_CALL_USD]);
  assert.equal(tokensUsd(1_000_000, 1_000_000), 5.5, "1.25 + 4.25 USD per million");
});

test("CAP1 3: over cap - reserve, no ledger, or an unreadable ledger throws SpendCapError before any request", async () => {
  const near = memoryLedger([{ at: "t", prediction_id: "old", cost_usd: META_SPEND_CAP_USD - META_RESERVE_USD - SAM_PRICE_PER_CALL_USD / 2, estimated: true }]);
  const broken: Ledger = { read: () => { throw new Error("bad"); }, append: () => {} };
  for (const [kind, ledger] of [["sam", near], ["verifier", near], ["sam", broken], ["verifier", null]] as const) {
    const s = server(200, "{}");
    await assert.rejects(meteredFetch(s.fetch, { kind, ledger })("https://x", { body: VERIFIER_BODY }), SpendCapError);
    assert.equal(s.calls.length, 0, `${kind}: nothing sent`);
  }
  assert.equal(near.entries.length, 1, "a refused call books nothing");
});

test("CAP1 4: the estimate before a verifier call counts its images and every output token it allows", () => {
  const est = estimateMetaUsd("verifier", VERIFIER_BODY);
  assert.ok(est >= tokensUsd(2 * 2000, 8192), `estimate ${est}`);
  assert.equal(estimateMetaUsd("sam", "anything"), SAM_PRICE_PER_CALL_USD);
  assert.ok(estimateMetaUsd("verifier", "not json") > 0, "an unreadable body is still estimated");
});

test("CAP1 5: the file ledger lives outside the repo and holds amounts only", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "ps-meta-")), "meta-ledger.json");
  const ledger = fileLedger(path);
  const s = server(200, JSON.stringify({ usage: { prompt_tokens: 10, completion_tokens: 10 } }));
  await meteredFetch(s.fetch, { kind: "verifier", ledger })("https://x", { body: VERIFIER_BODY });
  assert.equal(ledger.read().length, 1);
  assert.equal(readFileSync(path, "utf8").includes("data:x"), false, "no request body in the ledger");
});
