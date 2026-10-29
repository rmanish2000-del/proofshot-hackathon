import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  FIREWORKS_MODEL, FIREWORKS_SPEND_CAP_USD, FIREWORKS_URL, copyFacts, copyMessages, fireworksCostUsd, noteClaims, parseRegQuery,
  resolveFireworksKey, templateText, writeCopy,
} from "../src/llama-fireworks.ts";
import type { CopyFacts, FireworksCallLog, FireworksFetch } from "../src/llama-fireworks.ts";
import { parseReceipt } from "../src/receipt.ts";
import type { Ledger, LedgerEntry } from "../src/render-replicate.ts";

const KEY = "fw-test-not-a-key"; // gitleaks:allow
const NO_USER_ENV = { platform: "linux" };

const FACTS: CopyFacts = {
  job_id: "job-1",
  receipt_head: "a".repeat(64),
  decision: "REVIEW",
  reasons: ["hem: mismatch (soft)"],
  findings: [{ attribute: "color", verdict: "match" }, { attribute: "hem", verdict: "mismatch" }],
  claims: [{ field: "Type", value: "kurta (women's)" }, { field: "Main colour", value: "peach" }, { field: "Buttons", value: "as in the photos" }],
};

function memoryLedger(entries: LedgerEntry[] = []): Ledger & { entries: LedgerEntry[] } {
  return { entries, read: () => entries, append: (e) => void entries.push(e) };
}

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
  const fetch: FireworksFetch = async (url, init) => {
    calls.push({ url, headers: init.headers, body: init.body });
    return { status, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) };
  };
  return { calls, fetch };
}

const OK = {
  model: FIREWORKS_MODEL,
  choices: [{ message: { role: "assistant", content: " Decision: REVIEW. A person must look first. " } }],
  usage: { prompt_tokens: 300, completion_tokens: 40 },
};

test("FW1 1: no key in the process or the User env falls back to the template with fallback_reason no_api_token, and nothing is sent", async () => {
  const { calls, fetch } = fakeFetch(200, OK);
  const ledger = memoryLedger();
  const rec = await writeCopy("receipt_summary", FACTS, { env: {}, fetch, ledger, lookup: { platform: "win32", readUserEnv: () => null } });
  assert.equal(rec.provider, "template");
  assert.equal(rec.model, "none");
  assert.equal(rec.generated, false);
  assert.equal(rec.fallback_reason, "no_api_token");
  assert.equal(rec.text, "Decision: REVIEW, a person must look before it is published. Reasons: hem: mismatch (soft).");
  assert.equal(calls.length, 0);
  assert.equal(ledger.entries.length, 0);
});

test("FW1 2: the request is OpenAI chat-completions shape, names the exact Llama model, sends facts only, and the key is only in the header", async () => {
  const { calls, fetch } = fakeFetch(200, OK);
  const logs: FireworksCallLog[] = [];
  const ledger = memoryLedger();
  const rec = await writeCopy("receipt_summary", FACTS, { env: { FIREWORKS_API_KEY: KEY }, fetch, ledger, lookup: NO_USER_ENV, onCall: (l) => logs.push(l) });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, FIREWORKS_URL);
  assert.equal(calls[0]!.url, "https://api.fireworks.ai/inference/v1/chat/completions");
  assert.equal(calls[0]!.headers.Authorization, `Bearer ${KEY}`);
  const body = JSON.parse(calls[0]!.body);
  assert.deepEqual(Object.keys(body).sort(), ["max_tokens", "messages", "model", "temperature"]);
  assert.equal(body.model, "accounts/fireworks/models/llama-v3p3-70b-instruct");
  assert.equal(body.temperature, 0);
  assert.deepEqual(body.messages.map((m: { role: string }) => m.role), ["system", "user"]);
  assert.match(body.messages[1].content, /Decision: REVIEW/);
  assert.match(body.messages[1].content, /- hem: mismatch/);
  assert.equal(calls[0]!.body.includes(KEY), false);

  assert.equal(rec.provider, "fireworks");
  assert.equal(rec.model, FIREWORKS_MODEL);
  assert.equal(rec.response_model, FIREWORKS_MODEL);
  assert.equal(rec.generated, true);
  assert.equal(rec.key_source, "process_env");
  assert.equal(rec.text, "Decision: REVIEW. A person must look first.");
  assert.deepEqual(rec.usage, { prompt_tokens: 300, completion_tokens: 40 });
  assert.equal(rec.cost_usd, fireworksCostUsd(300, 40));
  assert.equal(rec.receipt_head, FACTS.receipt_head);
  assert.match(rec.request_sha256 ?? "", /^[0-9a-f]{64}$/);
  assert.deepEqual(ledger.entries.map((e) => e.cost_usd), [fireworksCostUsd(300, 40)]);

  assert.equal(logs.length, 1);
  const logText = JSON.stringify(logs[0]);
  assert.equal(logText.includes(KEY), false, "the log has no key");
  assert.equal(logs[0]!.request.headers.Authorization, "Bearer [FIREWORKS_API_KEY]");
  assert.equal(JSON.stringify(rec).includes(KEY), false, "the record has no key");
});

test("FW1 3: a key only in the Windows User env scope is used and recorded as user_env; process env wins over it", async () => {
  const { calls, fetch } = fakeFetch(200, OK);
  const lookup = { platform: "win32", readUserEnv: (n: string) => (n === "FIREWORKS_API_KEY" ? "fw-user-scope" : null) };
  const rec = await writeCopy("listing_copy", FACTS, { env: {}, fetch, ledger: memoryLedger(), lookup });
  assert.equal(rec.key_source, "user_env");
  assert.equal(calls[0]!.headers.Authorization, "Bearer fw-user-scope");
  assert.deepEqual(resolveFireworksKey({ FIREWORKS_API_KEY: "own" }, lookup), { key: "own", source: "process_env" });
  assert.equal(resolveFireworksKey({}, { platform: "linux", readUserEnv: () => "x" }), null, "only Windows has a User scope to read");
  const reg = "\r\nHKEY_CURRENT_USER\\Environment\r\n    FIREWORKS_API_KEY    REG_SZ    abc123\r\n\r\n";
  assert.equal(parseRegQuery(reg, "FIREWORKS_API_KEY"), "abc123");
  assert.equal(parseRegQuery(reg, "OTHER"), null);
});

test("FW1 4: the 5 USD cap: a ledger near the cap, an unreadable ledger or no ledger falls back with spend_cap before any request", async () => {
  const near = memoryLedger([{ at: "2026-10-29T00:00:00.000Z", prediction_id: "old", cost_usd: FIREWORKS_SPEND_CAP_USD - 0.0001, estimated: true }]);
  const broken: Ledger = { read: () => { throw new Error("bad"); }, append: () => {} };
  for (const ledger of [near, broken, null]) {
    const { calls, fetch } = fakeFetch(200, OK);
    const rec = await writeCopy("receipt_summary", FACTS, { env: { FIREWORKS_API_KEY: KEY }, fetch, ledger, lookup: NO_USER_ENV });
    assert.equal(rec.fallback_reason, "spend_cap");
    assert.equal(rec.generated, false);
    assert.equal(calls.length, 0);
  }
});

test("FW1 5: an HTTP error or an empty answer falls back with fireworks_failed, and a call that reached the server is still in the ledger", async () => {
  for (const [status, body] of [[401, { error: "unauthorized" }], [200, { choices: [{ message: { content: "" } }] }], [200, "not json"]] as const) {
    const { fetch } = fakeFetch(status, body);
    const ledger = memoryLedger();
    const rec = await writeCopy("receipt_summary", FACTS, { env: { FIREWORKS_API_KEY: KEY }, fetch, ledger, lookup: NO_USER_ENV });
    assert.equal(rec.fallback_reason, "fireworks_failed");
    assert.equal(rec.provider, "template");
    assert.equal(ledger.entries.length, 1);
  }
  const thrown: FireworksFetch = async () => { throw new Error("network down"); };
  const ledger = memoryLedger();
  const rec = await writeCopy("receipt_summary", FACTS, { env: { FIREWORKS_API_KEY: KEY }, fetch: thrown, ledger, lookup: NO_USER_ENV });
  assert.equal(rec.fallback_reason, "fireworks_failed");
  assert.equal(ledger.entries.length, 0, "nothing reached the server");
});

test("FW1 6: listing copy is written from the seller's claims only; the template drops 'as in the photos' lines", () => {
  const user = copyMessages("listing_copy", FACTS)[1]!;
  assert.match(user.content, /- Main colour: peach/);
  assert.equal(user.content.includes("REVIEW"), false, "the listing prompt carries no gate decision");
  assert.equal(templateText("listing_copy", FACTS), "Type: kurta (women's). Main colour: peach.");
});

test("FW1 7: facts from a committed receipt: decision and reasons from the last gate entry, claims from the job note, no bounding boxes", () => {
  const dir = new URL("../data/jobs/live-kurta-02-sam/receipt.jsonl", import.meta.url);
  const entries = parseReceipt(readFileSync(dir, "utf8"));
  const f = copyFacts("live-kurta-02-sam", entries);
  assert.equal(f.receipt_head, entries.at(-1)?.hash);
  assert.equal(f.decision, "RELEASE");
  assert.ok(f.findings.length > 0);
  assert.deepEqual(f.claims.slice(0, 2), [{ field: "Type", value: "kurta (women's)" }, { field: "Main colour", value: "peach" }]);
  assert.equal(JSON.stringify(copyMessages("receipt_summary", f)).includes("bbox"), false);
  assert.deepEqual(noteClaims("kurta-02: Type: kurta; Fabric and weave: not recorded; Print or motif (what, where, size): as in the photos; not recorded in words"), [
    { field: "Type", value: "kurta" },
    { field: "Print or motif (what, where, size)", value: "as in the photos; not recorded in words" },
  ]);
});

test("FW1 8: a file ledger outside the repo accumulates Fireworks spend", async () => {
  const { fileLedger } = await import("../src/render-replicate.ts");
  const path = join(mkdtempSync(join(tmpdir(), "ps-fw-")), "fireworks-ledger.json");
  const ledger = fileLedger(path);
  const { fetch } = fakeFetch(200, OK);
  await writeCopy("receipt_summary", FACTS, { env: { FIREWORKS_API_KEY: KEY }, fetch, ledger, lookup: NO_USER_ENV });
  await writeCopy("listing_copy", FACTS, { env: { FIREWORKS_API_KEY: KEY }, fetch, ledger, lookup: NO_USER_ENV });
  assert.equal(ledger.read().length, 2);
  assert.equal(readFileSync(path, "utf8").includes(KEY), false);
});
