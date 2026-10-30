// npm run demo:static [-- --out out/static-demo] [-- --serve [--port 8791]]
//
// Builds the keyless static judge demo (src/static-demo.ts) into a folder any static host can serve (it is not
// published by this script). --serve then serves that folder on 127.0.0.1 so it can be opened in a browser; the
// pages fetch JSON files, so they need http://, not file://. No key is read and no model is called.

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { buildStaticDemo } from "../src/static-demo.ts";

const args = process.argv.slice(2);
const option = (name: string, fallback: string): string => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1]! : fallback;
};
const root = fileURLToPath(new URL("..", import.meta.url));
const out = resolve(root, option("--out", "out/static-demo"));

const result = buildStaticDemo({ webDir: join(root, "web"), jobsRoot: join(root, "data", "jobs"), garmentsDir: join(root, "data", "garments"), outDir: out });
console.log(`static demo: ${result.jobs.length} committed jobs, ${result.files} files -> ${out}`);

if (args.includes("--serve")) {
  const port = Number(option("--port", "8791"));
  const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".json": "application/json", ".jsonl": "application/x-ndjson", ".jpg": "image/jpeg", ".png": "image/png", ".css": "text/css", ".js": "text/javascript" };
  const http = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    const file = resolve(out, `.${path === "/" ? "/index.html" : path}`);
    if ((file !== out && !file.startsWith(out + sep)) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { "content-type": "text/plain" }).end("not found");
      return;
    }
    res.writeHead(200, { "content-type": types[extname(file).toLowerCase()] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  http.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code !== "EADDRINUSE") throw err;
    console.error(`port ${port} is already in use. Pick another: npm run demo:static -- --serve --port 8792`);
    process.exit(2);
  });
  http.listen(port, "127.0.0.1", () => console.log(`open http://127.0.0.1:${port}/  (Ctrl+C to stop)`));
}
