// npm run check:responsive [-- --out evidence/responsive-2026-11-03]
//
// RV31 (Grok 20:05 IST 3 Nov): a real-browser check of web/upload.html and
// web/verify.html at phone, tablet and desktop widths (src/responsive.ts). It
// serves web/ and the committed data/jobs from the same UploadServer as
// `npm run serve`, with fixture providers (no key read, no model called, GET
// only, nothing uploaded), opens each page in headless Edge or Chrome over the
// DevTools protocol (Node's own WebSocket, no new dependency, as in
// scripts/demo-capture.ts), and writes one full-page PNG per page and width
// plus results.json. The pages hold no photo: the upload page's examples are
// drawn SVGs. Exit 1 if any page has a problem.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { browserCandidates } from "../src/demo-capture.ts";
import { RESPONSIVE_PAGES, RESPONSIVE_VIEWPORTS, layoutProblems, measureExpression, type PageMeasure } from "../src/responsive.ts";
import { UploadServer, providersFromEnv } from "../src/serve.ts";

const args = process.argv.slice(2);
const i = args.indexOf("--out");
const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = join(root, i >= 0 && args[i + 1] ? args[i + 1]! : "evidence/responsive-2026-11-03");
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const browser = browserCandidates(process.env, process.platform).find((p) => existsSync(p));
if (!browser) {
  console.error("no Edge or Chrome found; set PROOFSHOT_BROWSER to a Chromium-family browser");
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

const app = new UploadServer({ webDir: join(root, "web"), jobsRoot: join(root, "data/jobs"), shopDir: join(root, "web/shop"), garmentsDir: join(root, "data/garments"), providers: providersFromEnv({}) });
const server = createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405).end();
    return;
  }
  void app.handler(req, res);
});
const base = await new Promise<string>((resolve) =>
  server.listen(0, "127.0.0.1", () => {
    const a = server.address();
    resolve(`http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`);
  }),
);

// Throwaway profile in the gitignored out/ folder.
const profile = join(root, "out", "responsive-profile");
rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
const proc = spawn(browser, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
let port = 0;
for (let t = 0; t < 100 && !port; t++) {
  await sleep(100);
  try {
    port = Number(readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]);
  } catch {}
}
if (!port) throw new Error("the browser did not open a DevTools port");
const version = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()) as { webSocketDebuggerUrl: string; Browser: string };

const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});
let nextId = 1;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
ws.onmessage = (ev) => {
  const msg = JSON.parse(String(ev.data)) as { id?: number; result?: unknown; error?: { message: string } };
  const p = msg.id !== undefined ? pending.get(msg.id) : undefined;
  if (!p) return;
  pending.delete(msg.id!);
  if (msg.error) p.reject(new Error(msg.error.message));
  else p.resolve(msg.result);
};
const send = (method: string, params: object = {}, sessionId?: string): Promise<any> =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
const cdp = (method: string, params: object = {}) => send(method, params, sessionId);
await cdp("Page.enable");
await cdp("Runtime.enable");
const evaluate = async (expression: string): Promise<any> => {
  const r = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
const waitFor = async (expression: string, what: string): Promise<void> => {
  for (let t = 0; t < 10000; t += 100) {
    if (await evaluate(expression)) return;
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${what}`);
};

const results: { page: string; path: string; viewport: string; kind: string; width: number; height: number; screenshot: string; measure?: PageMeasure; problems: string[] }[] = [];
for (const page of RESPONSIVE_PAGES) {
  for (const vp of RESPONSIVE_VIEWPORTS) {
    const screenshot = `${page.name}-${vp.label}.png`;
    const row: (typeof results)[number] = { page: page.name, path: page.path, viewport: vp.label, kind: vp.kind, width: vp.width, height: vp.height, screenshot, problems: [] };
    results.push(row);
    try {
      await cdp("Emulation.setDeviceMetricsOverride", { width: vp.width, height: vp.height, deviceScaleFactor: vp.scale, mobile: vp.width < 1024 });
      await cdp("Page.navigate", { url: base + page.path });
      await waitFor(`document.readyState === "complete"`, "page load");
      const sel = JSON.stringify(page.ready);
      await waitFor(`!!document.querySelector(${sel}) && document.querySelector(${sel}).textContent.trim().length > 0`, page.ready);
      await sleep(300);
      row.measure = (await evaluate(measureExpression(page.controls))) as PageMeasure;
      row.problems = layoutProblems(row.measure);
      const { cssContentSize } = await cdp("Page.getLayoutMetrics");
      const shot = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: vp.width, height: Math.ceil(cssContentSize.height), scale: 1 } });
      writeFileSync(join(outDir, screenshot), Buffer.from(shot.data, "base64"));
    } catch (err) {
      row.problems.push(`error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

const exited = new Promise<void>((r) => proc.once("exit", () => r()));
await send("Browser.close").catch(() => proc.kill());
await Promise.race([exited, sleep(5000).then(() => proc.kill())]);
ws.close();
server.close();
try {
  rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
} catch {}

const passed = results.every((r) => r.problems.length === 0);
writeFileSync(
  join(outDir, "results.json"),
  JSON.stringify({ check: "RV31 responsive", browser: version.Browser, server: "UploadServer, fixture providers, GET only", passed, results }, null, 2) + "\n",
);
for (const r of results) console.log(`${r.page} ${r.viewport} (${r.kind}): ${r.problems.length ? r.problems.join("; ") : "ok"}`);
console.log(passed ? "passed" : "FAILED");
process.exit(passed ? 0 : 1);
