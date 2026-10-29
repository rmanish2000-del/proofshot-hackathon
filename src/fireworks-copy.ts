// FW1 / FW1b (Grok 29 Oct 08:24 and 10:21 IST on proofshot #23): a Meta model
// on Fireworks (OpenAI-compatible chat completions) writes two pieces of plain
// text from facts the pipeline already recorded: a receipt summary a seller
// can read, and listing copy from the seller's own claims. It never decides
// anything: the gate decision is read from the receipt and quoted, and the
// text is stored beside the receipt (data/copy/), never inside the chain. An
// answer that drops, changes or softens the decision word is not used: the
// record falls back to the template with fallback_reason decision_changed.
//
// The model is Meta's muse-spark-open, the only Meta model Fireworks lists for
// this key (npm run models:fireworks, 29 Oct). It is not Llama. FW1 first tried
// Llama 3.3 70B; Fireworks answered 404 to all 6 calls (proofshot-hackathon
// 3097a7b, evidence/fireworks-2026-10-29T04-39-*.json), so that id is kept only
// as FIREWORKS_LLAMA_MODEL, an override that does not work for this key.
//
// The key is FIREWORKS_API_KEY. It is read from the process env first and, on
// Windows, from the User env scope (HKCU\Environment) when the process did not
// inherit it, so a shell started before the key was set does not silently fall
// back. It goes in the Authorization header and nowhere else. With no key, or
// a spend ledger that would pass the limit (CAP1b: a 60 USD batch cap; the 40
// USD reserve on top only with PROOFSHOT_USE_RESERVE=1), the text comes from a
// fixed template and the record says why (`fallback_reason`), never silently.

import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { fileLedger } from "./render-replicate.ts";
import type { Ledger } from "./render-replicate.ts";
import type { ReceiptEntry } from "./receipt.ts";
import { spendLimitUsd } from "./spend-meta.ts";
import type { SpendLimit } from "./spend-meta.ts";
import { sha256Hex } from "./util.ts";

export const FIREWORKS_PROVIDER = "fireworks";
export const FIREWORKS_URL = "https://api.fireworks.ai/inference/v1/chat/completions";
/** Meta muse-spark-open, the id `npm run models:fireworks` printed on 29 Oct; FIREWORKS_MODEL overrides it. */
export const FIREWORKS_MODEL = "accounts/fireworks/models/muse-spark-open";
/** Meta Llama 3.3 70B Instruct: Fireworks answers 404 "Model not found" for this key (3097a7b). Documented, not used. */
export const FIREWORKS_LLAMA_MODEL = "accounts/fireworks/models/llama-v3p3-70b-instruct";
export const FIREWORKS_KEY_ENV = "FIREWORKS_API_KEY";
/** USD per million tokens for muse-spark-open, serverless, from fireworks.ai/models/fireworks/muse-spark-open (read 29 Oct). Output includes reasoning tokens. */
export const FIREWORKS_PRICE_PER_MTOK = Object.freeze({ input: 1.25, output: 4.25 });
/** CAP1b (Grok 29 Oct 10:55 IST, Manish approved): the Fireworks credit, 100 USD = a 60 USD batch cap + 40 USD reserve. */
export const FIREWORKS_SPEND_CAP_USD = 60;
/** Above the cap, for the live judge demo and re-runs; only PROOFSHOT_USE_RESERVE=1 may spend it. */
export const FIREWORKS_RESERVE_USD = 40;
export const FIREWORKS_LIMIT: SpendLimit = Object.freeze({ cap_usd: FIREWORKS_SPEND_CAP_USD, reserve_usd: FIREWORKS_RESERVE_USD });
/** A reasoning model spends output tokens thinking before it answers: 400 cut most answers off, and 4096 cut the live-kurta-01-mismatch summary (FW1b, 29 Oct). */
/** FW2 fix: 15 of 96 FW2 answers spent all of 8192 tokens reasoning (finish_reason length), so the limit is doubled. */
export const FIREWORKS_MAX_TOKENS = 16384;
/** muse-spark-open reasons for 30 s or more before answering (FW1b run, 29 Oct); one listing call passed 60 s. */
export const FIREWORKS_TIMEOUT_MS = 180_000;
export const TEMPLATE_PROVIDER = "template";

export type CopyTask = "receipt_summary" | "listing_copy";
/** FW2: English, or Hindi in Devanagari with the decision word kept in English capitals. */
export type CopyLang = "en" | "hi";
/**
 * no_api_token: no key; spend_cap: the ledger would pass the cap, or cannot be read;
 * fireworks_failed: an error or empty answer; truncated: the answer stopped at max_tokens;
 * decision_changed: the answer drops, changes or softens the gate decision;
 * too_short: listing copy under two sentences, twice (FW2: one retry);
 * off_topic: listing copy that talks about the check, gate or receipt instead of the garment,
 *   or a fixture listing that does not say it is fixture data, twice (FW2 fix);
 * unsupported: a summary that says details matched or were kept when the receipt has no verifier findings, twice (FW2 fix).
 */
export type CopyFallbackReason = "no_api_token" | "spend_cap" | "fireworks_failed" | "truncated" | "decision_changed" | "too_short" | "off_topic" | "unsupported";

export type FireworksFetch = (
  url: string,
  init: { method: "POST"; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ status: number; text(): Promise<string> }>;

export interface ChatMessage {
  readonly role: "system" | "user";
  readonly content: string;
}

/** The facts one text is written from: what the receipt and the seller's note say, nothing else. */
export interface CopyFacts {
  readonly job_id: string;
  readonly receipt_head: string;
  readonly decision: string | null;
  readonly reasons: readonly string[];
  readonly findings: readonly { attribute: string; verdict: string }[];
  readonly claims: readonly { field: string; value: string }[];
  /** The job's provenance ("fixture" or "live"); absent when the job entry has none. */
  readonly provenance?: string;
  /** A free-text note's closing parenthesis, e.g. "fixture: synthetic images, no garment was photographed". */
  readonly aside?: string;
}

export interface CopyRecord {
  readonly job_id: string;
  readonly task: CopyTask;
  /** Absent on FW1/FW1b records, which are all English. */
  readonly lang?: CopyLang;
  /** The receipt's last hash when the text was written: the text describes that receipt and no later entry. */
  readonly receipt_head: string;
  readonly provider: typeof FIREWORKS_PROVIDER | typeof TEMPLATE_PROVIDER;
  /** The model id sent, or "none" for the template. */
  readonly model: string;
  /** The model id the API answered with, when it named one. */
  readonly response_model?: string;
  readonly generated: boolean;
  readonly fallback_reason?: CopyFallbackReason;
  readonly key_source?: "process_env" | "user_env";
  /** sha256 of the exact request body sent (no key in it). */
  readonly request_sha256?: string;
  readonly usage?: { prompt_tokens: number; completion_tokens: number };
  readonly cost_usd?: number;
  readonly cost_estimated?: boolean;
  /** Calls made for this text when more than one (FW2 listing retry); cost_usd covers all of them. */
  readonly attempts?: number;
  readonly text: string;
}

export interface FireworksCallLog {
  readonly provider: typeof FIREWORKS_PROVIDER;
  readonly model: string;
  readonly url: string;
  readonly task: CopyTask;
  readonly job_id: string;
  readonly started_at: string;
  readonly finished_at: string;
  readonly latency_ms: number;
  /** The auth header is a placeholder; the body is what was sent. */
  readonly request: { method: "POST"; headers: Record<string, string>; body: unknown };
  readonly response: { status: number; body: unknown } | null;
  readonly error: string | null;
}

type Env = Readonly<Record<string, string | undefined>>;

/** Reads one User-scope variable from HKCU\Environment. Null when it is absent or reg fails. The value is returned, never printed. */
export function readWindowsUserEnv(name: string): string | null {
  try {
    const out = execFileSync("reg", ["query", "HKCU\\Environment", "/v", name], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    return parseRegQuery(out, name);
  } catch {
    return null;
  }
}

/** The value of `name` in `reg query` output (`    NAME    REG_SZ    value`), or null. */
export function parseRegQuery(out: string, name: string): string | null {
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s+(\S+)\s+REG_(?:EXPAND_)?SZ\s+(.*)$/.exec(line);
    if (m && m[1]!.toLowerCase() === name.toLowerCase()) return m[2]!.trim() || null;
  }
  return null;
}

export interface KeyLookup {
  readonly platform?: string;
  readonly readUserEnv?: (name: string) => string | null;
}

/** The key and where it came from, or null. The process env wins; the Windows User scope is the fallback. */
export function resolveFireworksKey(env: Env, lookup: KeyLookup = {}): { key: string; source: "process_env" | "user_env" } | null {
  const own = (env[FIREWORKS_KEY_ENV] ?? "").trim();
  if (own) return { key: own, source: "process_env" };
  if ((lookup.platform ?? process.platform) !== "win32") return null;
  const user = ((lookup.readUserEnv ?? readWindowsUserEnv)(FIREWORKS_KEY_ENV) ?? "").trim();
  return user ? { key: user, source: "user_env" } : null;
}

/** The default ledger: %LOCALAPPDATA%\ProofShot\fireworks-ledger.json, outside the repo, beside the Replicate one. */
export function defaultFireworksLedgerPath(env: Env): string | null {
  const base = (env.LOCALAPPDATA ?? "").trim();
  return base ? join(base, "ProofShot", "fireworks-ledger.json") : null;
}

export function fireworksCostUsd(promptTokens: number, completionTokens: number): number {
  const usd = (promptTokens * FIREWORKS_PRICE_PER_MTOK.input + completionTokens * FIREWORKS_PRICE_PER_MTOK.output) / 1_000_000;
  return Math.round(usd * 1e6) / 1e6;
}

/** A ceiling for one call before it is made: about 3 characters a token for the prompt, plus every output token allowed. */
export function estimateCallUsd(body: string, maxTokens: number): number {
  return fireworksCostUsd(Math.ceil(body.length / 3), maxTokens);
}

/**
 * The facts from a parsed receipt and the seller's note. Bounding boxes, scores and notes from the verifier are left out.
 * `noteFile` is the garment's data/garments/<id>/note.txt: a preview job's receipt carries only Type and
 * Main colour (src/shop.ts garmentNoteFrom), so its claims come from the full note when it is given
 * (shirt-zebra, 29 Oct: the preview listing dropped the zebra print). The receipt is not changed.
 */
export function copyFacts(jobId: string, entries: readonly ReceiptEntry[], noteFile?: string): CopyFacts {
  const head = entries.at(-1)?.hash ?? "";
  const job = entries.find((e) => e.kind === "job")?.payload as { garment_note?: string; provenance?: string } | undefined;
  const aside = noteAside(job?.garment_note ?? "");
  const preview = job?.provenance === "fixture" && /^preview:/i.test(aside ?? "");
  const fileClaims = preview && noteFile !== undefined ? noteFileClaims(noteFile) : [];
  const gates = entries.filter((e) => e.kind === "gate");
  const gate = gates.at(-1)?.payload as { decision?: string; reasons?: readonly unknown[] } | undefined;
  const verifier = entries.filter((e) => e.kind === "verifier").at(-1)?.payload as { findings?: readonly { attribute?: unknown; verdict?: unknown }[] } | undefined;
  return {
    job_id: jobId,
    receipt_head: head,
    decision: typeof gate?.decision === "string" ? gate.decision : null,
    reasons: (gate?.reasons ?? []).map(reasonText).filter((r) => r !== ""),
    findings: (verifier?.findings ?? [])
      .filter((f) => typeof f.attribute === "string" && typeof f.verdict === "string")
      .map((f) => ({ attribute: f.attribute as string, verdict: f.verdict as string })),
    claims: fileClaims.length > 0 ? fileClaims : noteClaims(job?.garment_note ?? ""),
    ...(typeof job?.provenance === "string" ? { provenance: job.provenance } : {}),
    ...(aside ? { aside } : {}),
  };
}

function reasonText(r: unknown): string {
  if (typeof r === "string") return r;
  if (r && typeof r === "object") {
    const o = r as Record<string, unknown>;
    for (const k of ["message", "reason", "text", "code"]) if (typeof o[k] === "string") return o[k] as string;
  }
  return "";
}

/** `Field: value` claims from the job's garment note, minus empty and "not recorded" values. */
const FIELD_START = /^[A-Z][^:;()]*:/;

/** The job entry prefixes the note with the garment folder id ("kurta-02: Type: ..."). */
function noteBody(note: string): string {
  return note.trim().replace(/^[a-z0-9][a-z0-9-]*:\s+/, "");
}

/**
 * The closing parenthesis of a free-text note (the fixture jobs: "indigo cotton
 * shirt, ... (fixture: synthetic images, ...)"), or null. A `Field: value` note
 * has none: its "(as photographed)" belongs to the value.
 */
export function noteAside(note: string): string | null {
  const body = noteBody(note);
  if (FIELD_START.test(body)) return null;
  return /\(([^()]*)\)\s*$/.exec(body)?.[1]?.trim() || null;
}

export function noteClaims(note: string): { field: string; value: string }[] {
  const body = noteBody(note);
  // FW2 fix: a free-text note is one description, without its closing parenthesis;
  // before, "(preview: ...)" was read as a field named "kurta (women's), rust / orange (preview".
  if (body && !FIELD_START.test(body)) {
    const value = body.replace(/\s*\([^()]*\)\s*$/, "").trim();
    return value ? [{ field: "Description", value }] : [];
  }
  const out: { field: string; value: string }[] = [];
  for (const part of body.split(/;\s*(?=[A-Z][^:;]*:)/)) {
    const i = part.indexOf(":");
    if (i < 1) continue;
    const field = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (!value || /^not recorded$/i.test(value)) continue;
    out.push({ field, value });
  }
  return out;
}

/** `Field: value` lines of a note.txt (one per line), minus empty and "not recorded" values; the header and the closing "(Written by ...)" line have no field. */
export function noteFileClaims(text: string): { field: string; value: string }[] {
  const out: { field: string; value: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Z][^:;()]*(?:\([^()]*\))?[^:;()]*):[^\S\r\n]*(.*?)\s*$/.exec(line);
    if (!m) continue;
    const field = m[1]!.trim();
    const value = m[2]!;
    if (!value || /^not recorded$/i.test(value)) continue;
    out.push({ field, value });
  }
  return out;
}

export const COPY_SYSTEM_PROMPT =
  "You write short, plain English for an Indian clothing seller. Use only the facts given. " +
  "Do not add colours, fabrics, sizes, prices, care advice or any claim that is not in the facts. " +
  "Do not change or soften the gate decision. No markdown, no emoji, no headings.";

export const COPY_SYSTEM_PROMPT_HI =
  "You write short, plain Hindi in Devanagari script for an Indian clothing seller. Use only the facts given. " +
  "Do not add colours, fabrics, sizes, prices, care advice or any claim that is not in the facts. " +
  "Do not change or soften the gate decision; keep the decision word RELEASE, REVIEW or REFUSE in English capital letters exactly as given. " +
  "No markdown, no emoji, no headings.";

/**
 * For Hindi listing copy. It must not mention decision words: with the summary
 * prompt above, the FW2 run's first Hindi listings ended in RELEASE or REFUSE,
 * one of them a word the listing request never carried, and the guard refused them.
 */
export const COPY_SYSTEM_PROMPT_HI_LISTING =
  "You write short, plain Hindi in Devanagari script for an Indian clothing seller. Use only the facts given. " +
  "Do not add colours, fabrics, sizes, prices, care advice or any claim that is not in the facts. " +
  "This is product listing copy: do not mention any check, decision or approval, and never write RELEASE, REVIEW or REFUSE. " +
  "No markdown, no emoji, no headings.";

const HINDI_ASK = " Write the text in Hindi (Devanagari script).";

/** The two messages for one task. Only the facts are sent: no image, no hash other than the receipt head. */
export function copyMessages(task: CopyTask, f: CopyFacts, lang: CopyLang = "en"): ChatMessage[] {
  if (lang === "hi") {
    // The English request with the Hindi system prompt, and the ask to write in Hindi before the facts.
    const system = task === "listing_copy" ? COPY_SYSTEM_PROMPT_HI_LISTING : COPY_SYSTEM_PROMPT_HI;
    return copyMessages(task, f, "en").map((m): ChatMessage => (m.role === "system" ? { role: "system", content: system } : { role: "user", content: m.content.replace("\n\n", `${HINDI_ASK}\n\n`) }));
  }
  if (task === "listing_copy") {
    const described = garmentClaims(f).map((c) => `- ${c.field}: ${c.value}`).join("\n") || "- none recorded";
    const fixture = needsFixtureWord(f)
      ? `\nThis job is fixture data, not a live listing${f.aside ? ` (${f.aside})` : ""}. Say so plainly in one sentence that contains the English word "fixture".`
      : "";
    return [
      { role: "system", content: COPY_SYSTEM_PROMPT },
      {
        role: "user",
        content:
          `Write a product listing of 2 to 3 full sentences, at most 60 words, describing the garment itself from the seller's description below: its type, colour, length and any detail stated. ` +
          `Use nothing else. Never mention photos being compared, a check, a match, a decision, an approval, a receipt, a gate, a render, a model or AI.${fixture}\n\nSeller's description:\n${described}`,
      },
    ];
  }
  const keep = f.claims.filter((c) => /must not change/i.test(c.field)).map((c) => c.value);
  const claims = [
    ...garmentClaims(f).map((c) => `- ${c.field}: ${c.value}`),
    ...keep.map((v) => `- The seller asked that these stay as photographed: ${v}`),
  ].join("\n") || "- none recorded";
  const findings = f.findings.map((x) => `- ${x.attribute}: ${x.verdict}`).join("\n") || "- none recorded";
  const noFindings = f.findings.length === 0
    ? `No verifier findings were recorded: say the garment details could not be compared, and do not say that any detail matched, did not match or was kept. `
    : "";
  const reasons = f.reasons.map((r) => `- ${r}`).join("\n") || "- none";
  return [
    { role: "system", content: COPY_SYSTEM_PROMPT },
    {
      role: "user",
      content:
        `Explain this check result to the seller in at most 70 words. State the decision word exactly as given (RELEASE, REVIEW or REFUSE) and what it means: RELEASE = the image can be published, REVIEW = a person must look first, REFUSE = the image must not be published. ` +
        `Write that one decision word in capitals and no other of RELEASE, REVIEW or REFUSE anywhere, even when a reason contains one: describe such a reason in plain words instead. ${noFindings}` +
        `The seller's description says what the garment is; it is not a check result.\n\n` +
        `Decision: ${f.decision ?? "none recorded"}\nReasons:\n${reasons}\nVerifier findings (attribute: verdict):\n${findings}\nSeller's claims:\n${claims}`,
    },
  ];
}

const ATTRIBUTE_WORDS: Readonly<Record<string, string>> = {
  color: "colour", print_pattern: "print", logo_text: "logo or text", collar: "collar", sleeve_length: "sleeve length",
  hem: "hem", pocket_count: "pockets", buttons: "buttons", fabric_texture: "fabric texture",
};

/** The attributes the verifier found matching, in plain words, in vocabulary order. */
export function matchedAttributes(f: CopyFacts): string[] {
  return f.findings.filter((x) => x.verdict === "match").map((x) => ATTRIBUTE_WORDS[x.attribute] ?? x.attribute.replace(/_/g, " "));
}

/** The seller's description of the garment: no "as in the photos" or "not recorded" value and no "must not change" line. */
export function garmentClaims(f: CopyFacts): { field: string; value: string }[] {
  // "zebra-style stripe print all over; as in the photos" keeps what was said before the sentinel
  // (shirt-zebra, 29 Oct: its print was dropped); "as in the photos; not recorded in words" says nothing.
  return f.claims
    .filter((c) => !/must not change/i.test(c.field))
    .map((c) => ({ field: c.field, value: c.value.replace(/\s*[;,]\s*as in the photos\s*$/i, "").trim() }))
    .filter((c) => c.value !== "" && !/as in the photos|not recorded/i.test(c.value));
}

export function isFixture(f: CopyFacts): boolean {
  return f.provenance === "fixture";
}

/**
 * A preview job (src/shop.ts): a real garment whose own front photo stands in
 * for the render, recorded as fixture provenance. Its listing describes the
 * garment only (Manish, 29 Oct: the kurta listings must not say the owner's
 * photo stands in for the preview); only a synthetic fixture says "fixture".
 */
export function isPreview(f: CopyFacts): boolean {
  return isFixture(f) && /^preview:/i.test(f.aside ?? "");
}

/** A fixture whose listing must say it is fixture data: synthetic images, no real garment. */
function needsFixtureWord(f: CopyFacts): boolean {
  return isFixture(f) && !isPreview(f);
}

/** Words that describe the pipeline, not the garment (FW2 fix): listing copy has none of them. */
export const LISTING_PIPELINE_WORDS =
  /\b(?:gate|receipts?|pipeline|check(?:s|ed|ing)?|verif\w*|match\w*|mismatch\w*|attributes?|decisions?|approv\w*|render\w*|findings?|fidelity|AI|RELEASE|REVIEW|REFUSE|previews?|stands? in|stand-in)\b/i;
export const LISTING_PIPELINE_WORDS_HI = /गेट|रसीद|पाइपलाइन|जाँच|जांच|मेल खा|मिलान|सत्याप|निर्णय|मंज़ूर|मंजूर|स्वीकृत|रेंडर|फ़िडेलिटी|फिडेलिटी|पूर्वावलोकन|प्रीव्यू/;
const FIXTURE_WORD = /fixture|फ़िक्स्चर|फिक्स्चर/i;

/** Listing copy describes the garment (no pipeline or preview word in either language), and a synthetic fixture's listing says it is fixture data. */
export function listingOnTopic(text: string, f: CopyFacts): boolean {
  // A plaid garment's own description says "checks" or "check pattern": that word describes the garment
  // there, so it is not read as the pipeline's check (shirt-plaid, 29 Oct).
  const own = /\bcheck(?:s|ed)?\b/i.test(garmentClaims(f).map((c) => c.value).join(" "));
  const t = own ? text.replace(/\bcheck(?:s|ed)?\b/gi, "") : text;
  if (LISTING_PIPELINE_WORDS.test(t) || LISTING_PIPELINE_WORDS_HI.test(t)) return false;
  return !needsFixtureWord(f) || FIXTURE_WORD.test(text);
}

const CLAIMS_MATCH = /\b(?:match\w*|kept)\b|\bas (?:in|shown in) (?:the )?photo/i;
const CLAIMS_MATCH_HI = /मेल खा|मिलान|मिलते|मिले|फ़?ोटो जैस/;

/** With no verifier findings, a summary must not say a detail matched or was kept (FW2 fix: live-kurta-02-tryon-2). */
export function summarySupported(text: string, f: CopyFacts): boolean {
  if (f.findings.length > 0) return true;
  return !CLAIMS_MATCH.test(text) && !CLAIMS_MATCH_HI.test(text);
}

/** Sentences in a text, by full stops (., !, ?, Devanagari ।); a text with none counts as one. */
export function sentenceCount(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  const ended = t.match(/[^.!?।]+[.!?।]+/g)?.filter((x) => x.trim().split(/\s+/).length >= 2).length ?? 0;
  const tail = /[.!?।]\s*$/.test(t) ? 0 : 1;
  return Math.max(1, ended + tail);
}

/** FW2: listing copy is at least two sentences. */
export function listingLongEnough(text: string): boolean {
  return sentenceCount(text) >= 2;
}

const MEANING_HI: Readonly<Record<string, string>> = {
  RELEASE: "तस्वीर प्रकाशित की जा सकती है",
  REVIEW: "प्रकाशित करने से पहले किसी व्यक्ति को इसे देखना होगा",
  REFUSE: "तस्वीर प्रकाशित नहीं की जानी चाहिए",
};

/** The text used when no model call is made: the facts, word for word (in Hindi, only the frame is translated). */
export function templateText(task: CopyTask, f: CopyFacts, lang: CopyLang = "en"): string {
  if (task === "listing_copy") {
    // FW2 fix: the seller's description only, word for word; nothing about the check.
    const parts = garmentClaims(f).map((c) => `${c.field}: ${c.value}.`);
    const aside = f.aside && !LISTING_PIPELINE_WORDS.test(f.aside) ? f.aside : null;
    if (lang === "hi") {
      const said = parts.length ? `विक्रेता का विवरण: ${parts.join(" ")}` : "विक्रेता का कोई विवरण दर्ज नहीं है।";
      return needsFixtureWord(f) ? `${said} यह डेमो का fixture (टेस्ट) डेटा है, असली लिस्टिंग नहीं।${aside ? ` (${aside})` : ""}` : said;
    }
    const said = parts.join(" ") || "No seller description recorded.";
    return needsFixtureWord(f) ? `${said} This is fixture data for the demo, not a live listing${aside ? ` (${aside})` : ""}.` : said;
  }
  if (lang === "hi") {
    const d = f.decision ?? "दर्ज नहीं";
    const why = f.reasons.length ? ` कारण: ${f.reasons.join("; ")}.` : "";
    return `निर्णय: ${d}${MEANING_HI[d] ? `, ${MEANING_HI[d]}` : ""}।${why}`;
  }
  const meaning: Record<string, string> = {
    RELEASE: "the image can be published",
    REVIEW: "a person must look before it is published",
    REFUSE: "the image must not be published",
  };
  const d = f.decision ?? "none recorded";
  const why = f.reasons.length ? ` Reasons: ${f.reasons.join("; ")}.` : "";
  return `Decision: ${d}${meaning[d] ? `, ${meaning[d]}` : ""}.${why}`;
}

export interface FireworksCopyOptions {
  readonly env: Env;
  /** Null means no network: every task falls back to the template. */
  readonly fetch: FireworksFetch | null;
  readonly ledger: Ledger | null;
  readonly lookup?: KeyLookup;
  readonly onCall?: (log: FireworksCallLog) => void;
  readonly now?: () => number;
  readonly timeoutMs?: number;
  /** FW2: the language to write in; English when absent. */
  readonly lang?: CopyLang;
}

export function fireworksLedger(env: Env): Ledger | null {
  const path = defaultFireworksLedgerPath(env);
  return path ? fileLedger(path) : null;
}

const DECISIONS = ["RELEASE", "REVIEW", "REFUSE"] as const;
/** Wording that says a held image can go out anyway. */
const SOFTENED = /\b(?:can|may|could|will|should) (?:now )?be (?:published|listed|sold|shown)\b|\bready to (?:publish|list|sell)\b|\b(?:is|was) approved\b/i;
/** The same in Hindi: "can be published / sold / shown", "approved". The REFUSE meaning puts नहीं in between, so it does not match. */
const SOFTENED_HI = /प्रकाशित (?:की|किया|हो) (?:जा )?सकत|(?:बेचा|बेची|दिखाया|दिखाई) जा सकत|मंज़ूर|मंजूर|स्वीकृत/;

/**
 * True when a model's text keeps the gate's word: a receipt summary states the
 * decision in capitals, names no other decision in capitals, and for REVIEW or
 * REFUSE does not say the image can be published; listing copy names no decision.
 * Anything else falls back to the template, which quotes the receipt.
 */
export function keepsDecision(task: CopyTask, text: string, decision: string | null): boolean {
  const named = DECISIONS.filter((d) => new RegExp(`\\b${d}\\b`).test(text));
  if (task === "listing_copy") return named.length === 0;
  if (decision === null || !(DECISIONS as readonly string[]).includes(decision)) return named.length === 0;
  if (named.length !== 1 || named[0] !== decision) return false;
  return decision === "RELEASE" || (!SOFTENED.test(text) && !SOFTENED_HI.test(text));
}

/** The answer text without a leading <think>...</think> block some reasoning models put in content. */
export function answerText(content: string): string {
  return content.replace(/^\s*<think>[\s\S]*?<\/think>/i, "").trim();
}

/** One text for one task, by the Fireworks model when it can run, by the template otherwise. */
export async function writeCopy(task: CopyTask, facts: CopyFacts, opts: FireworksCopyOptions): Promise<CopyRecord> {
  const lang = opts.lang ?? "en";
  const base = { job_id: facts.job_id, task, ...(opts.lang ? { lang } : {}), receipt_head: facts.receipt_head };
  const fallback = (reason: CopyFallbackReason): CopyRecord => ({
    ...base,
    provider: TEMPLATE_PROVIDER,
    model: "none",
    generated: false,
    fallback_reason: reason,
    text: templateText(task, facts, lang),
  });
  const found = resolveFireworksKey(opts.env, opts.lookup);
  if (!found || !opts.fetch) return fallback("no_api_token");
  const model = (opts.env.FIREWORKS_MODEL ?? "").trim() || FIREWORKS_MODEL;
  const body = JSON.stringify({ model, messages: copyMessages(task, facts, lang), max_tokens: FIREWORKS_MAX_TOKENS, temperature: 0 });
  let spent: number;
  try {
    if (!opts.ledger) return fallback("spend_cap");
    spent = opts.ledger.read().reduce((s, e) => s + e.cost_usd, 0);
  } catch {
    return fallback("spend_cap");
  }
  if (spent + estimateCallUsd(body, FIREWORKS_MAX_TOKENS) > spendLimitUsd(FIREWORKS_LIMIT, opts.env) + 1e-9) return fallback("spend_cap");

  const now = opts.now ?? Date.now;
  // A text that fails a content check (too short, off topic, unsupported) is asked once more; each attempt is logged and paid for.
  const attempts = 2;
  let paid = 0;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const started = now();
    let status = 0;
    let parsed: unknown = null;
    let error: string | null = null;
    try {
      const res = await opts.fetch(FIREWORKS_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${found.key}`, "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(opts.timeoutMs ?? FIREWORKS_TIMEOUT_MS),
      });
      status = res.status;
      const raw = await res.text();
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = { unparsed_bytes: raw.length };
      }
      if (status !== 200) error = `HTTP ${status}`;
    } catch (e) {
      error = e instanceof Error ? `${e.name}: ${e.message}` : "request failed";
    }
    const finished = now();
    opts.onCall?.({
      provider: FIREWORKS_PROVIDER,
      model,
      url: FIREWORKS_URL,
      task,
      job_id: facts.job_id,
      started_at: new Date(started).toISOString(),
      finished_at: new Date(finished).toISOString(),
      latency_ms: finished - started,
      request: { method: "POST", headers: { Authorization: `Bearer [${FIREWORKS_KEY_ENV}]`, "Content-Type": "application/json" }, body: JSON.parse(body) },
      response: status ? { status, body: parsed } : null,
      error,
    });

    const out = parsed as { model?: unknown; choices?: { message?: { content?: unknown }; finish_reason?: unknown }[]; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } } | null;
    // Only the answer is kept: reasoning (a separate field, or a <think> block) is never stored as text.
    const text = typeof out?.choices?.[0]?.message?.content === "string" ? answerText(out.choices[0].message.content as string) : "";
    const finish = out?.choices?.[0]?.finish_reason;
    const pt = typeof out?.usage?.prompt_tokens === "number" ? out.usage.prompt_tokens : null;
    const ct = typeof out?.usage?.completion_tokens === "number" ? out.usage.completion_tokens : null;
    // A call that reached the server is paid for even when its answer is unusable.
    const cost = pt !== null && ct !== null ? fireworksCostUsd(pt, ct) : status ? estimateCallUsd(body, FIREWORKS_MAX_TOKENS) : 0;
    const id = `fireworks:${facts.job_id}:${task}${lang === "en" ? "" : `:${lang}`}${attempt > 1 ? `:attempt${attempt}` : ""}`;
    if (cost > 0) opts.ledger.append({ at: new Date(finished).toISOString(), prediction_id: id, cost_usd: cost, estimated: true });
    paid += cost;
    if (error) return fallback("fireworks_failed");
    if (finish === "length") return fallback("truncated");
    if (!text) return fallback("fireworks_failed");
    if (!keepsDecision(task, text, facts.decision)) return fallback("decision_changed");
    const problem: CopyFallbackReason | null =
      task === "listing_copy"
        ? !listingLongEnough(text) ? "too_short" : !listingOnTopic(text, facts) ? "off_topic" : null
        : !summarySupported(text, facts) ? "unsupported" : null;
    if (problem) {
      if (attempt >= attempts) return fallback(problem);
      // The ledger must still allow the retry.
      let total: number;
      try {
        total = opts.ledger.read().reduce((sum, e) => sum + e.cost_usd, 0);
      } catch {
        return fallback("spend_cap");
      }
      if (total + estimateCallUsd(body, FIREWORKS_MAX_TOKENS) > spendLimitUsd(FIREWORKS_LIMIT, opts.env) + 1e-9) return fallback("spend_cap");
      continue;
    }
    return {
      ...base,
      provider: FIREWORKS_PROVIDER,
      model,
      ...(typeof out?.model === "string" ? { response_model: out.model } : {}),
      generated: true,
      key_source: found.source,
      request_sha256: sha256Hex(new TextEncoder().encode(body)),
      ...(pt !== null && ct !== null ? { usage: { prompt_tokens: pt, completion_tokens: ct } } : {}),
      ...(attempt > 1 ? { attempts: attempt } : {}),
      cost_usd: Math.round(paid * 1e6) / 1e6,
      cost_estimated: true,
      text,
    };
  }
  return fallback("fireworks_failed");
}

/** A committed record the batch may keep: written by the model for this receipt head, and passing today's checks. */
export function recordStillGood(r: CopyRecord, f: CopyFacts): boolean {
  if (!r.generated || r.receipt_head !== f.receipt_head) return false;
  if (!keepsDecision(r.task, r.text, f.decision)) return false;
  return r.task === "listing_copy" ? listingLongEnough(r.text) && listingOnTopic(r.text, f) : summarySupported(r.text, f);
}
