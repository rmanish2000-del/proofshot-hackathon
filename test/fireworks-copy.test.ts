import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  FIREWORKS_LLAMA_MODEL, FIREWORKS_MAX_TOKENS, FIREWORKS_MODEL, FIREWORKS_RESERVE_USD, FIREWORKS_SPEND_CAP_USD, FIREWORKS_URL, answerText, copyFacts, copyMessages, fireworksCostUsd,
  keepsDecision, noteClaims, parseRegQuery,
  COPY_SYSTEM_PROMPT_HI, listingLongEnough, matchedAttributes, resolveFireworksKey, sentenceCount, templateText, writeCopy,
} from "../src/fireworks-copy.ts";
import type { CopyFacts, FireworksCallLog, FireworksFetch } from "../src/fireworks-copy.ts";
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

test("FW 1: no key in the process or the User env falls back to the template with fallback_reason no_api_token, and nothing is sent", async () => {
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

test("FW 2: the request is OpenAI chat-completions shape, names the exact muse-spark-open model id, sends facts only, and the key is only in the header", async () => {
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
  assert.equal(body.model, "accounts/fireworks/models/muse-spark-open");
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

test("FW 3: a key only in the Windows User env scope is used and recorded as user_env; process env wins over it", async () => {
  const { calls, fetch } = fakeFetch(200, { ...OK, choices: [{ message: { role: "assistant", content: "A peach women's kurta. It is cut for women, in peach." } }] });
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

test("FW 4: the spend cap: a ledger at the 60 USD batch cap, past 100 USD with the reserve opt-in, unreadable or missing falls back with spend_cap before any request", async () => {
  const near = memoryLedger([{ at: "2026-10-29T00:00:00.000Z", prediction_id: "old", cost_usd: FIREWORKS_SPEND_CAP_USD - 0.0001, estimated: true }]);
  const broken: Ledger = { read: () => { throw new Error("bad"); }, append: () => {} };
  for (const ledger of [near, broken, null]) {
    const { calls, fetch } = fakeFetch(200, OK);
    const rec = await writeCopy("receipt_summary", FACTS, { env: { FIREWORKS_API_KEY: KEY }, fetch, ledger, lookup: NO_USER_ENV });
    assert.equal(rec.fallback_reason, "spend_cap");
    assert.equal(rec.generated, false);
    assert.equal(calls.length, 0);
  }
  // The 40 USD reserve: only PROOFSHOT_USE_RESERVE=1 may spend past the cap, and never past cap + reserve.
  const reserve = { env: { FIREWORKS_API_KEY: KEY, PROOFSHOT_USE_RESERVE: "1" }, lookup: NO_USER_ENV };
  const opted = await writeCopy("receipt_summary", FACTS, { ...reserve, fetch: fakeFetch(200, OK).fetch, ledger: near });
  assert.equal(opted.generated, true, "the opt-in reaches the reserve");
  const full = memoryLedger([{ at: "t", prediction_id: "old", cost_usd: FIREWORKS_SPEND_CAP_USD + FIREWORKS_RESERVE_USD - 0.0001, estimated: true }]);
  const past = fakeFetch(200, OK);
  assert.equal((await writeCopy("receipt_summary", FACTS, { ...reserve, fetch: past.fetch, ledger: full })).fallback_reason, "spend_cap");
  assert.equal(past.calls.length, 0);
});

test("FW 5: an HTTP error or an empty answer falls back with fireworks_failed, and a call that reached the server is still in the ledger", async () => {
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

test("FW 6: listing copy is written from the seller's claims only; the template drops 'as in the photos' lines", () => {
  const user = copyMessages("listing_copy", FACTS)[1]!;
  assert.match(user.content, /- Main colour: peach/);
  assert.equal(user.content.includes("REVIEW"), false, "the listing prompt carries no gate decision");
  assert.equal(templateText("listing_copy", FACTS), "Type: kurta (women's). Main colour: peach.");
});

test("FW 7: facts from a committed receipt: decision and reasons from the last gate entry, claims from the job note, no bounding boxes", () => {
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

test("FW 8: a file ledger outside the repo accumulates Fireworks spend", async () => {
  const { fileLedger } = await import("../src/render-replicate.ts");
  const path = join(mkdtempSync(join(tmpdir(), "ps-fw-")), "fireworks-ledger.json");
  const ledger = fileLedger(path);
  const { fetch } = fakeFetch(200, OK);
  await writeCopy("receipt_summary", FACTS, { env: { FIREWORKS_API_KEY: KEY }, fetch, ledger, lookup: NO_USER_ENV });
  await writeCopy("listing_copy", FACTS, { env: { FIREWORKS_API_KEY: KEY }, fetch, ledger, lookup: NO_USER_ENV });
  assert.equal(ledger.read().length, 2);
  assert.equal(readFileSync(path, "utf8").includes(KEY), false);
});

test("FW 9: muse-spark-open is the default; the Llama id is only a documented override, and FIREWORKS_MODEL still wins", async () => {
  assert.equal(FIREWORKS_MODEL, "accounts/fireworks/models/muse-spark-open");
  assert.equal(FIREWORKS_LLAMA_MODEL, "accounts/fireworks/models/llama-v3p3-70b-instruct");
  const { calls, fetch } = fakeFetch(200, OK);
  await writeCopy("receipt_summary", FACTS, { env: { FIREWORKS_API_KEY: KEY, FIREWORKS_MODEL: FIREWORKS_LLAMA_MODEL }, fetch, ledger: memoryLedger(), lookup: NO_USER_ENV });
  assert.equal(JSON.parse(calls[0]!.body).model, FIREWORKS_LLAMA_MODEL);
  assert.equal(JSON.parse(calls[0]!.body).max_tokens, FIREWORKS_MAX_TOKENS);
});

test("FW 10: an answer that drops, changes or softens the gate decision falls back to the template with decision_changed", async () => {
  const answer = (content: string) => ({ ...OK, choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }] });
  const refuse: CopyFacts = { ...FACTS, decision: "REFUSE", reasons: ["color: mismatch at 0.95 on a hard attribute"] };
  const cases: [CopyFacts, string][] = [
    [FACTS, "Decision: RELEASE. The image can be published."], // changed
    [FACTS, "A person should take a look at this one first."], // dropped
    [FACTS, "REVIEW, not REFUSE: a person must look first."], // names a second decision
    [refuse, "REFUSE for now, but the image can be published once the colour is fixed."], // softened
    [FACTS, "Decision: review. A person must look first."], // not the word as given
  ];
  for (const [facts, content] of cases) {
    const { fetch } = fakeFetch(200, answer(content));
    const ledger = memoryLedger();
    const rec = await writeCopy("receipt_summary", facts, { env: { FIREWORKS_API_KEY: KEY }, fetch, ledger, lookup: NO_USER_ENV });
    assert.equal(rec.fallback_reason, "decision_changed", content);
    assert.equal(rec.provider, "template");
    assert.equal(rec.model, "none");
    assert.equal(rec.text, templateText("receipt_summary", facts), "the template quotes the receipt");
    assert.equal(ledger.entries.length, 1, "the call was still paid for");
  }
  assert.equal(keepsDecision("receipt_summary", "REFUSE: the image must not be published.", "REFUSE"), true);
  assert.equal(keepsDecision("receipt_summary", "RELEASE: the image can be published.", "RELEASE"), true);
  assert.equal(keepsDecision("listing_copy", "A peach kurta.", "REVIEW"), true);
  assert.equal(keepsDecision("listing_copy", "A peach kurta, RELEASE ready.", "RELEASE"), false, "listing copy names no decision");
  const { fetch } = fakeFetch(200, answer("Decision: REVIEW. A person must look before it is published."));
  const kept = await writeCopy("receipt_summary", FACTS, { env: { FIREWORKS_API_KEY: KEY }, fetch, ledger: memoryLedger(), lookup: NO_USER_ENV });
  assert.equal(kept.generated, true);
});

test("FW 11: an answer cut off at max_tokens falls back with truncated; a <think> block is never kept as text", async () => {
  const cut = { ...OK, choices: [{ message: { role: "assistant", content: "Decision: REVIEW. A person" }, finish_reason: "length" }] };
  const { fetch } = fakeFetch(200, cut);
  const rec = await writeCopy("receipt_summary", FACTS, { env: { FIREWORKS_API_KEY: KEY }, fetch, ledger: memoryLedger(), lookup: NO_USER_ENV });
  assert.equal(rec.fallback_reason, "truncated");
  assert.equal(answerText("<think>the hem differs, so REFUSE?</think>\nDecision: REVIEW. A person must look first."), "Decision: REVIEW. A person must look first.");
  const thinking = { ...OK, choices: [{ message: { role: "assistant", content: "<think>maybe RELEASE</think> Decision: REVIEW. A person must look first.", reasoning_content: "RELEASE?" }, finish_reason: "stop" }] };
  const f2 = fakeFetch(200, thinking);
  const kept = await writeCopy("receipt_summary", FACTS, { env: { FIREWORKS_API_KEY: KEY }, fetch: f2.fetch, ledger: memoryLedger(), lookup: NO_USER_ENV });
  assert.equal(kept.text, "Decision: REVIEW. A person must look first.");
});

test("FW2 1: Hindi asks for Devanagari with the decision word in English capitals; the record says lang hi; English records are unchanged", async () => {
  const msgs = copyMessages("receipt_summary", FACTS, "hi");
  assert.equal(msgs[0]!.content, COPY_SYSTEM_PROMPT_HI);
  assert.match(msgs[0]!.content, /Devanagari/);
  assert.match(msgs[0]!.content, /RELEASE, REVIEW or REFUSE in English capital letters/);
  assert.match(msgs[1]!.content, /Write the text in Hindi \(Devanagari script\)\.\n\nDecision: REVIEW/);
  assert.deepEqual(copyMessages("receipt_summary", FACTS), copyMessages("receipt_summary", FACTS, "en"), "English is the default");
  const { calls, fetch } = fakeFetch(200, { ...OK, choices: [{ message: { role: "assistant", content: "निर्णय REVIEW है: प्रकाशित करने से पहले किसी व्यक्ति को देखना होगा।" }, finish_reason: "stop" }] });
  const rec = await writeCopy("receipt_summary", FACTS, { env: { FIREWORKS_API_KEY: KEY }, fetch, ledger: memoryLedger(), lookup: NO_USER_ENV, lang: "hi" });
  assert.equal(rec.lang, "hi");
  assert.equal(rec.generated, true);
  assert.match(JSON.parse(calls[0]!.body).messages[0].content, /Hindi/);
  const en = await writeCopy("receipt_summary", FACTS, { env: {}, fetch: null, ledger: null, lookup: NO_USER_ENV });
  assert.equal("lang" in en, false, "an English record without lang keeps the FW1 shape");
});

test("FW2 2: the Hindi template frames the receipt's facts in Hindi and keeps the decision word", () => {
  assert.equal(templateText("receipt_summary", FACTS, "hi"), "निर्णय: REVIEW, प्रकाशित करने से पहले किसी व्यक्ति को इसे देखना होगा। कारण: hem: mismatch (soft).");
  assert.equal(templateText("listing_copy", FACTS, "hi"), "विक्रेता का विवरण: Type: kurta (women's). Main colour: peach.");
  assert.ok(keepsDecision("receipt_summary", templateText("receipt_summary", { ...FACTS, decision: "REFUSE" }, "hi"), "REFUSE"), "the REFUSE template passes its own guard");
});

test("FW2 3: a Hindi answer that softens REVIEW or REFUSE, or drops the English word, falls back with decision_changed", async () => {
  const refuse: CopyFacts = { ...FACTS, decision: "REFUSE" };
  const cases: [CopyFacts, string][] = [
    [refuse, "निर्णय REFUSE है, पर रंग ठीक करने के बाद तस्वीर प्रकाशित की जा सकती है।"],
    [FACTS, "निर्णय REVIEW है, तस्वीर मंज़ूर है।"],
    [FACTS, "निर्णय समीक्षा है: किसी व्यक्ति को देखना होगा।"],
  ];
  for (const [facts, content] of cases) {
    const { fetch } = fakeFetch(200, { ...OK, choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }] });
    const rec = await writeCopy("receipt_summary", facts, { env: { FIREWORKS_API_KEY: KEY }, fetch, ledger: memoryLedger(), lookup: NO_USER_ENV, lang: "hi" });
    assert.equal(rec.fallback_reason, "decision_changed", content);
    assert.equal(rec.text, templateText("receipt_summary", facts, "hi"));
  }
  assert.equal(keepsDecision("receipt_summary", "निर्णय REFUSE है: तस्वीर प्रकाशित नहीं की जा सकती।", "REFUSE"), true, "a negated 'can be published' is not softening");
});

test("FW2 4: listing copy under two sentences is asked once more; still short falls back with too_short; both calls are logged and paid", async () => {
  const one = { ...OK, choices: [{ message: { role: "assistant", content: "Women's kurta in rust/orange." }, finish_reason: "stop" }] };
  const two = { ...OK, choices: [{ message: { role: "assistant", content: "A women's kurta in peach. It is cut long, as photographed." }, finish_reason: "stop" }] };
  const answers = [one, two];
  let n = 0;
  const retried: FireworksFetch = async () => ({ status: 200, text: async () => JSON.stringify(answers[n++]) });
  const logs: FireworksCallLog[] = [];
  const ledger = memoryLedger();
  const rec = await writeCopy("listing_copy", FACTS, { env: { FIREWORKS_API_KEY: KEY }, fetch: retried, ledger, lookup: NO_USER_ENV, onCall: (l) => logs.push(l), lang: "en" });
  assert.equal(rec.generated, true);
  assert.equal(rec.attempts, 2);
  assert.equal(rec.text, "A women's kurta in peach. It is cut long, as photographed.");
  assert.equal(logs.length, 2);
  assert.equal(ledger.entries.length, 2);
  assert.equal(rec.cost_usd, Math.round(2 * fireworksCostUsd(300, 40) * 1e6) / 1e6);

  const { fetch } = fakeFetch(200, one);
  const short = memoryLedger();
  const fell = await writeCopy("listing_copy", FACTS, { env: { FIREWORKS_API_KEY: KEY }, fetch, ledger: short, lookup: NO_USER_ENV });
  assert.equal(fell.fallback_reason, "too_short");
  assert.equal(fell.text, templateText("listing_copy", FACTS));
  assert.equal(short.entries.length, 2, "one retry, not more");

  const user = copyMessages("listing_copy", FACTS)[1]!.content;
  assert.match(user, /2 to 3 full sentences/);
  assert.ok(user.endsWith("Seller's description:\n- Type: kurta (women's)\n- Main colour: peach"), user);
  assert.equal(user.includes("mismatch"), false, "no check result is offered for the listing");
  assert.deepEqual(matchedAttributes(FACTS), ["colour"]);
  assert.equal(sentenceCount("Women's kurta in rust/orange."), 1);
  assert.equal(sentenceCount("गहरे नारंगी रंग का कुर्ता। रंग तस्वीरों से मेल खाता है।"), 2);
  assert.equal(listingLongEnough(templateText("listing_copy", FACTS)), true, "the template itself has two sentences");
});

test("FW2 5: Hindi listing copy gets a system prompt that names no decision word; the Hindi summary keeps its own", async () => {
  const { COPY_SYSTEM_PROMPT_HI_LISTING } = await import("../src/fireworks-copy.ts");
  const listing = copyMessages("listing_copy", FACTS, "hi")[0]!.content;
  assert.equal(listing, COPY_SYSTEM_PROMPT_HI_LISTING);
  assert.match(listing, /never write RELEASE, REVIEW or REFUSE/);
  assert.doesNotMatch(listing, /in English capital letters exactly as given/);
  assert.equal(copyMessages("receipt_summary", FACTS, "hi")[0]!.content, COPY_SYSTEM_PROMPT_HI);
});

test("FW2 fix 1: a free-text fixture note is one Description plus its closing aside; provenance comes from the job entry; a Field: value note keeps its (as photographed)", async () => {
  const { noteAside } = await import("../src/fireworks-copy.ts");
  assert.deepEqual(noteClaims("kurta (women's), rust / orange (preview: the owner's photo of the garment stands in for the render)"), [{ field: "Description", value: "kurta (women's), rust / orange" }]);
  assert.equal(noteAside("kurta (women's), rust / orange (preview: the owner's photo of the garment stands in for the render)"), "preview: the owner's photo of the garment stands in for the render");
  assert.equal(noteAside("kurta-02: Type: kurta (women's); Length: long, below the knee (as photographed)"), null);
  assert.deepEqual(noteClaims("kurta-02: Type: kurta (women's); Length: long, below the knee (as photographed)").at(-1), { field: "Length", value: "long, below the knee (as photographed)" });
  const f = copyFacts("fixture-shirt-01", parseReceipt(readFileSync(new URL("../data/jobs/fixture-shirt-01/receipt.jsonl", import.meta.url), "utf8")));
  assert.equal(f.provenance, "fixture");
  assert.deepEqual(f.claims, [{ field: "Description", value: "indigo cotton shirt, white placket, spread collar" }]);
  assert.equal(f.aside, "fixture: synthetic images, no garment was photographed");
  assert.equal(FIREWORKS_MAX_TOKENS, 16384, "doubled after 15 FW2 answers stopped at 8192");
});

test("FW2 fix 2: listing copy describes the garment: a pipeline word (EN or HI) or a fixture listing without 'fixture' is asked once more, then falls back with off_topic", async () => {
  const { listingOnTopic } = await import("../src/fireworks-copy.ts");
  const fixture: CopyFacts = { ...FACTS, provenance: "fixture", aside: "fixture: synthetic images, no garment was photographed" };
  assert.equal(listingOnTopic("This is a women's kurta in peach. The colour matches the seller's photos.", FACTS), false);
  assert.equal(listingOnTopic("The seller lists this as a women's kurta. No attributes were found matching the photos.", FACTS), false);
  assert.equal(listingOnTopic("यह महिलाओं का कुर्ता है। रंग तस्वीरों से मेल खाता है।", FACTS), false);
  assert.equal(listingOnTopic("A women's kurta in peach. It is long and falls below the knee.", FACTS), true);
  assert.equal(listingOnTopic("An indigo cotton shirt with a spread collar. It has a white placket.", fixture), false, "a fixture listing must say so");
  assert.equal(listingOnTopic("An indigo cotton shirt with a spread collar. This is fixture data: no garment was photographed.", fixture), true);
  for (const f of [FACTS, fixture]) for (const lang of ["en", "hi"] as const) assert.ok(listingOnTopic(templateText("listing_copy", f, lang), f), `template ${lang}`);
  assert.match(copyMessages("listing_copy", fixture)[1]!.content, /contains the English word "fixture"/);
  assert.equal(copyMessages("listing_copy", FACTS)[1]!.content.includes("fixture data"), false);

  const off = { ...OK, choices: [{ message: { role: "assistant", content: "A women's kurta in peach. The colour matches the seller's photos." }, finish_reason: "stop" }] };
  const good = { ...OK, choices: [{ message: { role: "assistant", content: "A women's kurta in peach. It is long and falls below the knee." }, finish_reason: "stop" }] };
  let n = 0;
  const answers = [off, good];
  const ledger = memoryLedger();
  const rec = await writeCopy("listing_copy", FACTS, { env: { FIREWORKS_API_KEY: KEY }, fetch: async () => ({ status: 200, text: async () => JSON.stringify(answers[n++]) }), ledger, lookup: NO_USER_ENV });
  assert.equal(rec.generated, true);
  assert.equal(rec.attempts, 2);
  const twice = memoryLedger();
  const fell = await writeCopy("listing_copy", FACTS, { env: { FIREWORKS_API_KEY: KEY }, fetch: fakeFetch(200, off).fetch, ledger: twice, lookup: NO_USER_ENV });
  assert.equal(fell.fallback_reason, "off_topic");
  assert.equal(fell.text, templateText("listing_copy", FACTS));
  assert.equal(twice.entries.length, 2);
});

test("FW2 fix 3: with no verifier findings the summary prompt says so, and a summary claiming a match or a kept detail is asked once more, then falls back with unsupported", async () => {
  const { summarySupported } = await import("../src/fireworks-copy.ts");
  const none: CopyFacts = {
    ...FACTS, decision: "REFUSE", reasons: ["fidelity REFUSE: area 0.213 below 0.400"], findings: [],
    claims: [...FACTS.claims, { field: "Anything the render must not change", value: "colour, print and neckline exactly as photographed" }],
  };
  const user = copyMessages("receipt_summary", none)[1]!.content;
  assert.match(user, /No verifier findings were recorded: say the garment details could not be compared/);
  assert.match(user, /- The seller asked that these stay as photographed: colour, print and neckline/);
  assert.equal(user.includes("Buttons: as in the photos"), false);
  assert.doesNotMatch(copyMessages("receipt_summary", FACTS)[1]!.content, /No verifier findings were recorded/);
  assert.equal(summarySupported("Decision is REFUSE. Colour, print and neckline were not kept as required.", none), false);
  assert.equal(summarySupported("Decision is REFUSE. No attributes were found matching the photos.", none), false);
  assert.equal(summarySupported("निर्णय REFUSE है। रंग, प्रिंट फोटो जैसे मिले।", none), false);
  assert.equal(summarySupported("Decision is REFUSE, which means the image must not be published. The garment details could not be compared.", none), true);
  assert.equal(summarySupported("Decision is REVIEW. Colour matched.", FACTS), true, "with findings the check does not apply");

  const bad = { ...OK, choices: [{ message: { role: "assistant", content: "Decision is REFUSE, which means the image must not be published. Colour was kept." }, finish_reason: "stop" }] };
  const ledger = memoryLedger();
  const rec = await writeCopy("receipt_summary", none, { env: { FIREWORKS_API_KEY: KEY }, fetch: fakeFetch(200, bad).fetch, ledger, lookup: NO_USER_ENV });
  assert.equal(rec.fallback_reason, "unsupported");
  assert.equal(ledger.entries.length, 2);
});

test("FW2 fix 4: every committed listing describes the garment (no gate, receipt or pipeline word, EN or HI; fixture jobs say fixture), and no summary claims a match the receipt has no finding for", async () => {
  const { listingOnTopic, summarySupported } = await import("../src/fireworks-copy.ts");
  const { readdirSync } = await import("node:fs");
  const dir = new URL("../data/copy/", import.meta.url);
  const files = readdirSync(dir).filter((n) => n.endsWith(".json"));
  assert.ok(files.length >= 24);
  for (const name of files) {
    const { job_id, records } = JSON.parse(readFileSync(new URL(name, dir), "utf8")) as { job_id: string; records: { task: string; lang?: string; text: string; receipt_head: string }[] };
    const f = copyFacts(job_id, parseReceipt(readFileSync(new URL(`../data/jobs/${job_id}/receipt.jsonl`, import.meta.url), "utf8")));
    for (const r of records) {
      const where = `${job_id} ${r.task} ${r.lang ?? "en"}: ${r.text}`;
      assert.equal(r.receipt_head, f.receipt_head, where);
      if (r.task === "listing_copy") {
        assert.ok(listingOnTopic(r.text, f), where);
        assert.ok(listingLongEnough(r.text), where);
      } else {
        assert.ok(summarySupported(r.text, f), where);
        assert.ok(keepsDecision("receipt_summary", r.text, f.decision), where);
      }
    }
  }
});

test("FW2 shirts: 'check' is a garment word when the seller's own description uses it (a plaid shirt), and still off topic otherwise", async () => {
  const { listingOnTopic } = await import("../src/fireworks-copy.ts");
  const plaid: CopyFacts = { ...FACTS, claims: [{ field: "Type", value: "shirt (long sleeves, button front)" }, { field: "Main colour", value: "cream with navy, light blue, mustard and maroon checks" }] };
  assert.equal(listingOnTopic("A long-sleeved shirt in cream with navy, mustard and maroon checks. It has a point collar.", plaid), true);
  assert.equal(listingOnTopic("A long-sleeved checked shirt. The colour matches the photos.", plaid), false, "match is still a pipeline word");
  assert.equal(listingOnTopic("A women's kurta in peach. Its colour was checked against the photos.", FACTS), false, "no check in the kurta's description");
  assert.ok(listingOnTopic(templateText("listing_copy", plaid), plaid), "the plaid template passes");
});

test("FW2 fix 5: a preview job (real garment, owner's photo as the image) gets a garment-only listing: no fixture sentence, and 'preview' or 'stands in' in either language is off topic", async () => {
  const { listingOnTopic, isPreview } = await import("../src/fireworks-copy.ts");
  const preview: CopyFacts = { ...FACTS, provenance: "fixture", aside: "preview: the owner's photo of the garment stands in for the render" };
  const synthetic: CopyFacts = { ...FACTS, provenance: "fixture", aside: "fixture: synthetic images, no garment was photographed" };
  assert.equal(isPreview(preview), true);
  assert.equal(isPreview(synthetic), false);
  assert.equal(isPreview(FACTS), false);
  const ask = copyMessages("listing_copy", preview)[1]!.content;
  assert.equal(ask.includes("fixture"), false, "no fixture sentence is asked for");
  assert.equal(ask.includes("stands in"), false, "the preview aside is not offered to the model");
  assert.match(copyMessages("listing_copy", synthetic)[1]!.content, /contains the English word "fixture"/, "the synthetic fixture still says so");
  assert.equal(listingOnTopic("This is a women's kurta in peach. This is fixture data, not a live listing, with the owner's photo standing in for the preview.", preview), false);
  assert.equal(listingOnTopic("This women's kurta is in rust orange. The owner's photo stands in for the image.", preview), false);
  assert.equal(listingOnTopic("यह महिलाओं का कुर्ता है। मालिक की फोटो पूर्वावलोकन के लिए है।", preview), false);
  assert.equal(listingOnTopic("This is a women's kurta in peach. It is long and falls below the knee.", preview), true, "no fixture word needed");
  assert.equal(templateText("listing_copy", preview), "Type: kurta (women's). Main colour: peach.");
  assert.ok(listingOnTopic(templateText("listing_copy", preview, "hi"), preview));
});

test("FW2 fix 6: a detail written before '; as in the photos' is kept for the listing; a line that is only the sentinel is dropped", async () => {
  const { garmentClaims } = await import("../src/fireworks-copy.ts");
  const zebra: CopyFacts = { ...FACTS, claims: [
    { field: "Type", value: "shirt (short sleeves, button front)" },
    { field: "Print or motif (what, where, size)", value: "zebra-style stripe print all over; as in the photos" },
    { field: "Buttons", value: "black, as in the photos" },
    { field: "Collar and cuffs", value: "as in the photos" },
    { field: "Print or motif", value: "as in the photos; not recorded in words" },
    { field: "Anything the render must not change", value: "stripe print and colours exactly as photographed" },
  ] };
  assert.deepEqual(garmentClaims(zebra), [
    { field: "Type", value: "shirt (short sleeves, button front)" },
    { field: "Print or motif (what, where, size)", value: "zebra-style stripe print all over" },
    { field: "Buttons", value: "black" },
  ]);
});

test("zebra preview: a preview job's listing facts come from the garment's full note.txt, so the print is asked for; the receipt's note is used for every other job", async () => {
  const { garmentClaims, noteFileClaims } = await import("../src/fireworks-copy.ts");
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
  const note = read("../data/garments/shirt-zebra/note.txt");
  assert.deepEqual(noteFileClaims("Header line; keep it short.\nType: shirt\nFabric and weave: not recorded\nColour:\n(Written by someone: not a field)\n"), [{ field: "Type", value: "shirt" }]);
  const entries = parseReceipt(read("../data/jobs/shirt-zebra/receipt.jsonl"));
  const before = copyFacts("shirt-zebra", entries);
  assert.equal(before.claims.some((c) => /zebra/.test(c.value)), false, "the receipt's preview note has Type and Main colour only");
  const f = copyFacts("shirt-zebra", entries, note);
  assert.equal(f.receipt_head, before.receipt_head);
  assert.equal(f.aside, before.aside);
  assert.deepEqual(garmentClaims(f), [
    { field: "Type", value: "shirt (short sleeves, button front)" },
    { field: "Main colour", value: "black and grey" },
    { field: "Print or motif (what, where, size)", value: "zebra-style stripe print all over" },
    { field: "Collar and cuffs", value: "point collar, short sleeves" },
    { field: "Buttons", value: "black" },
  ]);
  assert.match(copyMessages("listing_copy", f)[1]!.content, /zebra-style stripe print all over/);
  assert.match(copyMessages("listing_copy", f, "hi")[1]!.content, /zebra-style stripe print all over/);
  // Not a preview: the note file is ignored.
  const ms2 = parseReceipt(read("../data/jobs/ms2-shirt-zebra/receipt.jsonl"));
  assert.deepEqual(copyFacts("ms2-shirt-zebra", ms2, "Type: something else\n").claims, copyFacts("ms2-shirt-zebra", ms2).claims);
  // The committed preview listings name the print in both languages.
  const records = (JSON.parse(read("../data/copy/shirt-zebra.json")) as { records: { task: string; lang?: string; text: string }[] }).records;
  const listing = (lang: string) => records.find((r) => r.task === "listing_copy" && (r.lang ?? "en") === lang)!.text;
  assert.match(listing("en"), /zebra/i);
  assert.match(listing("hi"), /ज़ेबरा|जेबरा|zebra/i);
});
