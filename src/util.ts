// Canonical JSON and hashing, the two things every receipt hash depends on (SPEC §3).

import { createHash } from "node:crypto";

/** sha256 of a string (as UTF-8) or of raw bytes, lowercase hex. */
export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * JSON with object keys sorted at every depth, so equal content always gives
 * equal bytes. Non-finite numbers, and values JSON cannot hold (undefined in an
 * array or at the top, functions, symbols, bigints, class instances), throw rather than being
 * silently changed. An object property set to undefined is left out, as
 * JSON.stringify does, so a value and its JSON round trip hash the same.
 */
export function canonicalJson(value: unknown): string {
  return encode(value, "$");
}

function encode(value: unknown, path: string): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) throw new TypeError(`canonicalJson: non-finite number at ${path}`);
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) return `[${value.map((v, i) => encode(v, `${path}[${i}]`)).join(",")}]`;
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) {
        // A Date, Map or Buffer would otherwise encode as {} and hash as nothing.
        throw new TypeError(`canonicalJson: not a plain object at ${path}`);
      }
      const keys = Object.keys(value).sort();
      const parts: string[] = [];
      for (const key of keys) {
        const v = (value as Record<string, unknown>)[key];
        if (v === undefined) continue;
        parts.push(`${JSON.stringify(key)}:${encode(v, `${path}.${key}`)}`);
      }
      return `{${parts.join(",")}}`;
    }
    default:
      throw new TypeError(`canonicalJson: cannot encode ${typeof value} at ${path}`);
  }
}
