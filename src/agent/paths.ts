// Evidence Recovery Agent: file access scoped to one seller's one job. Ids and file names are checked against a
// strict pattern (no separators, no "..", no drive letters), and every resolved path must stay inside its base.

import { resolve, sep } from "node:path";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const SAFE_FILE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}\.(jpg|jpeg|png)$/i;

export class ScopeError extends Error {
  override name = "ScopeError";
}

export function checkId(kind: "seller" | "job", id: unknown): string {
  if (typeof id !== "string" || !SAFE_ID.test(id)) throw new ScopeError(`${kind} id is not a plain id: ${JSON.stringify(String(id)).slice(0, 40)}`);
  return id;
}

export function checkFileName(name: unknown): string {
  if (typeof name !== "string" || !SAFE_FILE.test(name)) throw new ScopeError(`photo name is not a plain .jpg/.png file name: ${JSON.stringify(String(name)).slice(0, 40)}`);
  return name;
}

/** base/parts..., refused when any part is unsafe or the result escapes base. */
export function scopedPath(base: string, ...parts: string[]): string {
  const root = resolve(base);
  const full = resolve(root, ...parts);
  if (full !== root && !full.startsWith(root + sep)) throw new ScopeError("path escapes its job directory");
  return full;
}
