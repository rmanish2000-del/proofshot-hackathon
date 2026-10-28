// Types for scripts/asset-guard.mjs (PS-2). The guard is plain ESM so it can run
// without a build step; this declaration keeps the test suite typechecked.

export interface GuardReport {
  flags: string[];
  found: string[];
}

export interface FileReport extends GuardReport {
  path: string;
  kind: "jpeg" | "png" | "other";
}

export function auditJpeg(bytes: Buffer): GuardReport;
export function auditTiff(tiff: Buffer): GuardReport;
export function auditPng(bytes: Buffer): GuardReport;
export function stripJpeg(bytes: Buffer): Buffer;
export function auditFile(path: string): FileReport;

/** Folders whose images the repository publishes (PS-2). */
export const SOURCE_FOLDERS: string[];
export const DERIVED_FOLDERS: string[];
export const ALLOWED_FOLDERS: string[];
/** True when the image sits in a folder the repository publishes. */
export function pathAllowed(path: string): boolean;
