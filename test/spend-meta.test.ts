import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { Ledger, LedgerEntry } from "../src/render-replicate.ts";
import { fileLedger } from "../src/render-replicate.ts";
import {
  BASETEN_LIMIT, META_LIMIT, SAM_PRICE_PER_CALL_USD, SpendCapError, callUsd, estimateCallUsd, ledgerPath, meteredFetch, spendLimitUsd, spendSummary, tokensUsd,
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

const spent = (usd: number): LedgerEntry => ({ at: "t", prediction_id: "old", cost_usd: usd, estimated: true });

const VERIFIER_BODY = JSON.stringify({
  model: "meta-models/muse-spark-open-1026",
  max_tokens: 8192,
  messages: [{ role: "user", content: [{ type: "text", text: "compare" }, { type: "image_url", image_url: { url: "data:x" } }, { type: "image_url", image_url: { url: "data:y" } }] }],
});

test("CAP1b 1: Meta is an 80 USD batch cap with a 70 USD reserve on top; the reserve needs PROOFSHOT_USE_RESERVE=1", () => {
  assert.deepEqual({ ...META_LIMIT }, { cap_usd: 80, reserve_usd: 70 });
  assert.equal(spendLimitUsd(META_LIMIT, {}), 80);
  assert.equal(spendLimitUsd(META_LIMIT, { PROOFSHOT_USE_RESERVE: "1" }), 150);
  assert.equal(spendLimitUsd(META_LIMIT, { PROOFSHOT_USE_RESERVE: "yes" }), 80, "only the exact opt-in");
  assert.deepEqual(spendSummary(memoryLedger([spent(2.5)]), META_LIMIT), { calls: 1, spent_usd: 2.5, cap_usd: 80, reserve_usd: 70, batch_left_usd: 77.5, reserve_left_usd: 70 });
  assert.deepEqual(spendSummary(memoryLedger([spent(90)]), META_LIMIT), { calls: 1, spent_usd: 90, cap_usd: 80, reserve_usd: 70, batch_left_usd: 0, reserve_left_usd: 60 });
  assert.equal(ledgerPath("meta", { LOCALAPPDATA: "C:\\L" }), join("C:\\L", "ProofShot", "meta-ledger.json"));
  assert.equal(ledgerPath("baseten", { LOCALAPPDATA: "C:\\L" }), join("C:\\L", "ProofShot", "baseten-ledger.json"), "Baseten is its own account, not the Meta credit");
  assert.equal(ledgerPath("meta", {}), null);
});

test("CAP1b 2: a token-priced call is booked at its reported usage (chat or responses shape), a SAM call at the per-image price; the caller gets the same status and body", async () => {
  const ledger = memoryLedger();
  const answer = JSON.stringify({ choices: [{ message: { content: "{}" } }], usage: { prompt_tokens: 7000, completion_tokens: 2000 } });
  const v = server(200, answer);
  const res = await meteredFetch(v.fetch, { kind: "verifier", account: "baseten", ledger, env: {}, now: () => 0 })("https://baseten", { body: VERIFIER_BODY });
  assert.equal(res.status, 200);
  assert.equal(res.ok, true);
  assert.equal(await res.text(), answer);
  const s = server(500, "boom");
  const sam = await meteredFetch(s.fetch, { kind: "sam", account: "meta", ledger, env: {} })("https://api.meta.ai", { body: "{}" });
  assert.equal(sam.ok, false, "a failed call is still booked: it reached the server");
  assert.deepEqual(ledger.entries.map((e) => e.cost_usd), [tokensUsd(7000, 2000), SAM_PRICE_PER_CALL_USD]);
  assert.match(ledger.entries[0]!.prediction_id, /^baseten:verifier:/);
  assert.match(ledger.entries[1]!.prediction_id, /^meta:sam:/);
  assert.equal(tokensUsd(1_000_000, 1_000_000), 5.5, "1.25 + 4.25 USD per million");
  assert.equal(callUsd("muse", "{}", JSON.stringify({ usage: { input_tokens: 1000, output_tokens: 1000 } })).cost, tokensUsd(1000, 1000), "responses-style usage");
});

test("CAP1b 3: a batch stops at the cap; past cap + reserve nothing goes even with the opt-in; no or unreadable ledger refuses too; nothing is sent", async () => {
  const atCap = memoryLedger([spent(META_LIMIT.cap_usd - SAM_PRICE_PER_CALL_USD / 2)]);
  const s1 = server(200, "{}");
  await assert.rejects(meteredFetch(s1.fetch, { kind: "sam", account: "meta", ledger: atCap, env: {} })("https://x", { body: "{}" }), /PROOFSHOT_USE_RESERVE=1/);
  assert.equal(s1.calls.length, 0);
  const ok = await meteredFetch(s1.fetch, { kind: "sam", account: "meta", ledger: atCap, env: { PROOFSHOT_USE_RESERVE: "1" } })("https://x", { body: "{}" });
  assert.equal(ok.status, 200, "the opt-in may use the reserve");

  const full = memoryLedger([spent(META_LIMIT.cap_usd + META_LIMIT.reserve_usd - SAM_PRICE_PER_CALL_USD / 2)]);
  const broken: Ledger = { read: () => { throw new Error("bad"); }, append: () => {} };
  for (const [ledger, env] of [[full, { PROOFSHOT_USE_RESERVE: "1" }], [broken, {}], [null, {}]] as const) {
    const s = server(200, "{}");
    await assert.rejects(meteredFetch(s.fetch, { kind: "sam", account: "meta", ledger, env })("https://x", { body: "{}" }), SpendCapError);
    assert.equal(s.calls.length, 0);
  }
  const bas = memoryLedger([spent(BASETEN_LIMIT.cap_usd)]);
  const s2 = server(200, "{}");
  await assert.rejects(meteredFetch(s2.fetch, { kind: "verifier", account: "baseten", ledger: bas, env: {} })("https://x", { body: VERIFIER_BODY }), SpendCapError);
  assert.equal(s2.calls.length, 0);
});

test("CAP1b 4: the estimate before a call counts its images and every output token it allows", () => {
  const est = estimateCallUsd("verifier", VERIFIER_BODY);
  assert.ok(est >= tokensUsd(2 * 2000, 8192), `estimate ${est}`);
  assert.equal(estimateCallUsd("sam", "anything"), SAM_PRICE_PER_CALL_USD);
  assert.ok(estimateCallUsd("verifier", "not json") > 0, "an unreadable body is still estimated");
  const responses = JSON.stringify({ model: "muse-spark-1.3", max_output_tokens: 4000, input: [{ role: "user", content: [{ type: "input_text", text: "hi" }, { type: "input_image", image_url: "data:x" }] }] });
  assert.ok(estimateCallUsd("muse", responses) >= tokensUsd(2000, 4000));
});

test("CAP1b 5: the file ledger lives outside the repo and holds amounts only", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "ps-meta-")), "meta-ledger.json");
  const ledger = fileLedger(path);
  const s = server(200, JSON.stringify({ usage: { prompt_tokens: 10, completion_tokens: 10 } }));
  await meteredFetch(s.fetch, { kind: "verifier", account: "baseten", ledger, env: {} })("https://x", { body: VERIFIER_BODY });
  assert.equal(ledger.read().length, 1);
  assert.equal(readFileSync(path, "utf8").includes("data:x"), false, "no request body in the ledger");
});
