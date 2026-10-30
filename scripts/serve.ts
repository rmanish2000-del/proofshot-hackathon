// npm run serve [-- --port 8787 --jobs <dir> --shop <dir> --web <dir>]
//
// The seller upload UI (P7): serves web/ and runs the real pipeline on the
// photos dropped at http://localhost:<port>/ (web/upload.html). Providers come
// from the environment (src/serve.ts providersFromEnv); with no model key the
// run is labelled fixture mode on the page and `fixture` on the receipt; with
// BASETEN_API_KEY the verifier is Muse Spark Open on Baseten (P6) and every
// call's redacted log goes to evidence/verifier-<started_at>.json (each SAM
// call's to evidence/sam-<started_at>.json). Jobs are
// written under --jobs (default data/jobs, the folder npm run shop reads; the
// upload-* job folders are gitignored), and "Publish to shop" rebuilds --shop
// (default web/shop) from it.

import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

import { UploadServer, providersFromEnv } from "../src/serve.ts";
import { accountLedger, meteredFetch } from "../src/spend-meta.ts";
import { writeSamLog, writeVerifierLog } from "./verifier-log.ts";

const args = process.argv.slice(2);
const option = (name: string, fallback: string): string => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1]! : fallback;
};
const root = fileURLToPath(new URL("..", import.meta.url));
const port = Number(option("--port", process.env.PORT ?? "8787"));
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`--port ${option("--port", "")} is not a port`);
  process.exit(2);
}

// CAP1b: SAM 3.1 on the Meta Model API books to the Meta ledger, the verifier on Baseten to its own.
const metaLedger = accountLedger("meta", process.env);
const basetenLedger = accountLedger("baseten", process.env);
const providers = providersFromEnv(process.env, {
  sam: { fetch: meteredFetch((url, init) => fetch(url, init), { kind: "sam", account: "meta", ledger: metaLedger, env: process.env }), onCall: (log) => console.log(`  SAM call logged: ${writeSamLog(`${root}evidence`, log)}`) },
  verifierFetch: meteredFetch((url, init) => fetch(url, init), { kind: "verifier", account: "baseten", ledger: basetenLedger, env: process.env }),
  onVerifierCall: (log) => console.log(`  verifier call logged: ${writeVerifierLog(`${root}evidence`, log)}`),
});
const server = new UploadServer({
  webDir: option("--web", `${root}web`),
  jobsRoot: option("--jobs", `${root}data/jobs`),
  shopDir: option("--shop", `${root}web/shop`),
  garmentsDir: option("--garments", `${root}data/garments`),
  providers,
});

const http = createServer((req, res) => void server.handler(req, res));
// A port already taken (often an older npm run serve) gets one line, not a stack trace.
http.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code !== "EADDRINUSE") throw err;
  console.error(`port ${port} is already in use (an older npm run serve?). Stop it, or pick another port: npm run serve -- --port 8790`);
  process.exit(2);
});
http.listen(port, "127.0.0.1", () => {
  console.log(`ProofShot seller upload: http://127.0.0.1:${port}/`);
  console.log(`mode: ${providers.mode.fixture ? "FIXTURE (no verifier key read; the page says so)" : "live"}`);
  for (const [step, label] of Object.entries(providers.mode.labels)) console.log(`  ${step}: ${label}`);
});
