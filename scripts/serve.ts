// npm run serve [-- --port 8787 --jobs <dir> --shop <dir> --web <dir>]
//
// The seller upload UI (P7): serves web/ and runs the real pipeline on the
// photos dropped at http://localhost:<port>/ (web/upload.html). Providers come
// from the environment (src/serve.ts providersFromEnv); with no model key the
// run is labelled fixture mode on the page and `fixture` on the receipt. Jobs
// are written under --jobs (default data/jobs, the folder npm run shop reads),
// and "Publish to shop" rebuilds --shop (default web/shop) from it.

import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

import { UploadServer, providersFromEnv } from "../src/serve.ts";

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

const providers = providersFromEnv(process.env);
const server = new UploadServer({
  webDir: option("--web", `${root}web`),
  jobsRoot: option("--jobs", `${root}data/jobs`),
  shopDir: option("--shop", `${root}web/shop`),
  providers,
});

createServer((req, res) => void server.handler(req, res)).listen(port, "127.0.0.1", () => {
  console.log(`ProofShot seller upload: http://127.0.0.1:${port}/`);
  console.log(`mode: ${providers.mode.fixture ? "FIXTURE (no model key read; the page says so)" : "live"}`);
  for (const [step, label] of Object.entries(providers.mode.labels)) console.log(`  ${step}: ${label}`);
});
