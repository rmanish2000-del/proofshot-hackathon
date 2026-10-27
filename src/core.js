// The receipt checks shared by node and the verify page (SPEC §3, §9).
//
// Plain JavaScript with no imports and no hashing of its own, so web/verify.html
// can inline this file as it is (test/page.test.ts fails if the copy drifts).
// The chain check is split in two: chainTexts gives the text each entry's hash
// covers, the caller hashes them (node:crypto in node, crypto.subtle in the
// browser), and checkChain decides from the digests. Types: core.d.ts.

const GENESIS = "0".repeat(64);
const HEX64 = /^[0-9a-f]{64}$/;

/**
 * JSON with object keys sorted at every depth, so equal content always gives
 * equal bytes. Non-finite numbers, and values JSON cannot hold (undefined in an
 * array or at the top, functions, symbols, bigints, class instances), throw rather than being
 * silently changed. An object property set to undefined is left out, as
 * JSON.stringify does, so a value and its JSON round trip hash the same.
 */
export function canonicalJson(value) {
  return encodeCanonical(value, "$");
}

function encodeCanonical(value, path) {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) throw new TypeError(`canonicalJson: non-finite number at ${path}`);
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) return `[${value.map((v, i) => encodeCanonical(v, `${path}[${i}]`)).join(",")}]`;
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) {
        // A Date, Map or Buffer would otherwise encode as {} and hash as nothing.
        throw new TypeError(`canonicalJson: not a plain object at ${path}`);
      }
      const parts = [];
      for (const key of Object.keys(value).sort()) {
        const v = value[key];
        if (v === undefined) continue;
        parts.push(`${JSON.stringify(key)}:${encodeCanonical(v, `${path}.${key}`)}`);
      }
      return `{${parts.join(",")}}`;
    }
    default:
      throw new TypeError(`canonicalJson: cannot encode ${typeof value} at ${path}`);
  }
}

/** The text an entry's hash covers. */
export function entryText(e) {
  return canonicalJson({ seq: e.seq, at: e.at, kind: e.kind, payload: e.payload, prev: e.prev });
}

/** Parses receipt.jsonl text. A line that is not JSON throws with its line number. */
export function parseReceipt(text) {
  const lines = String(text).split("\n").filter((line) => line.trim() !== "");
  return lines.map((line, i) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new Error(`receipt line ${i + 1} is not JSON`);
    }
  });
}

/** For each entry, the text its hash covers, or { error } when it has none. */
export function chainTexts(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.map((e) => {
    if (typeof e !== "object" || e === null) return { error: "entry is not an object" };
    try {
      return entryText(e);
    } catch (err) {
      return { error: `cannot hash entry: ${err.message}` };
    }
  });
}

/**
 * Checks the chain is non-empty, seq runs 0..n-1, each prev links, and every
 * hash recomputes. digests[i] is the lowercase hex sha256 of chainTexts(entries)[i],
 * or that item's { error } when it had no text.
 */
export function checkChain(entries, digests) {
  if (!Array.isArray(entries) || entries.length === 0) return { ok: false, index: 0, reason: "empty receipt" };
  let prev = GENESIS;
  for (let index = 0; index < entries.length; index++) {
    const e = entries[index];
    if (typeof e !== "object" || e === null) return { ok: false, index, reason: "entry is not an object" };
    if (e.seq !== index) return { ok: false, index, reason: `seq is ${String(e.seq)}, expected ${index}` };
    if (e.prev !== prev) return { ok: false, index, reason: "prev does not match the previous hash" };
    const d = digests[index];
    if (typeof d !== "string") return { ok: false, index, reason: d && typeof d.error === "string" ? d.error : "no digest for this entry" };
    if (e.hash !== d) return { ok: false, index, reason: "hash does not match the entry" };
    prev = e.hash;
  }
  return { ok: true, head: prev, length: entries.length };
}

function payloadField(e, key) {
  return typeof e.payload === "object" && e.payload !== null ? e.payload[key] : undefined;
}

/** The image check of SPEC §9, given the record's chain check. A record that does not verify vouches for nothing. */
export function checkImageWith(entries, chain, imageSha256) {
  const no = (reason) => ({ status: "TAMPERED", render_id: null, decision: null, reason });

  if (!chain || chain.ok !== true) return no(`the record does not verify: entry ${chain ? chain.index : 0}, ${chain ? chain.reason : "not checked"}`);
  // Hex case carries no meaning, so it is folded; anything else is not a sha256.
  const sha = typeof imageSha256 === "string" ? imageSha256.trim().toLowerCase() : "";
  if (!HEX64.test(sha)) return no("the image hash is not 64 hex characters");

  const release = entries.find((e) => e.kind === "release" && payloadField(e, "image_sha256") === sha);
  if (release) {
    const id = payloadField(release, "render_id");
    return { status: "VALID", render_id: typeof id === "string" ? id : null, decision: "RELEASE", reason: "this image was released by this record" };
  }

  const render = entries.find((e) => e.kind === "render" && payloadField(e, "sha256") === sha);
  if (render) {
    const id = payloadField(render, "render_id");
    const render_id = typeof id === "string" ? id : null;
    const gate = entries.find((e) => e.kind === "gate" && render_id !== null && payloadField(e, "render_id") === render_id);
    const d = gate ? payloadField(gate, "decision") : undefined;
    const decision = d === "RELEASE" || d === "REVIEW" || d === "REFUSE" ? d : null;
    return {
      status: "NOT RELEASED",
      render_id,
      decision,
      reason: decision ? `this image was rendered but not released: the gate decided ${decision}` : "this image was rendered but never reached the gate",
    };
  }

  return no("this image is in no entry of this record");
}

/**
 * The verify page's whole check, hashing with WebCrypto. With no usable
 * crypto.subtle it verifies nothing and says so; it never answers VALID.
 * image: { bytes } (the file) or { sha256 } (a pasted hash) or null.
 */
export async function verifyRecord(receiptText, image, subtle) {
  if (!subtle || typeof subtle.digest !== "function") return { supported: false, message: "cannot verify in this browser" };
  const hash = async (data) => {
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
    const digest = new Uint8Array(await subtle.digest("SHA-256", bytes));
    return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
  };

  let entries = [];
  let chain;
  try {
    entries = parseReceipt(receiptText);
  } catch (err) {
    chain = { ok: false, index: 0, reason: err.message };
  }
  if (!chain) {
    const digests = await Promise.all(chainTexts(entries).map((t) => (typeof t === "string" ? hash(t) : t)));
    chain = checkChain(entries, digests);
  }

  let image_sha256 = null;
  if (image && image.bytes) image_sha256 = await hash(image.bytes);
  else if (image && typeof image.sha256 === "string") image_sha256 = image.sha256;
  return { supported: true, chain, image_sha256, image: image_sha256 === null ? null : checkImageWith(entries, chain, image_sha256) };
}
