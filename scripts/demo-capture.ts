// npm run demo:capture [-- --out out/demo]
//
// DEMO1 (Grok 29 Oct 00:30), DEMO1b (00:45): records every docs/DEMO.md shot as
// numbered PNG frames at 360 and 1280 px under the gitignored out/demo/. App
// shots come from the local server it starts on a free port (committed
// data/jobs, plus replays of committed recordings); title cards, the replay's
// terminal lines and the tampered byte are pages it writes to out/demo/pages/
// from committed files. No upload, no publish, no live or paid call, no key
// read. out/demo/shots.json gives each shot's seconds (the total stays under
// MAX_TOTAL_SECONDS) and out/demo/frames.txt is an ffmpeg concat list of the
// 1280 px frames with those durations; the video is assembled elsewhere, so
// nothing here runs ffmpeg.
//
// The browser is Edge or Chrome (PROOFSHOT_BROWSER names another), driven
// over the DevTools protocol with Node's own WebSocket: no new dependency.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  DEMO_SHOTS,
  REPLAYED_RECORDINGS,
  VIEWPORTS,
  browserCandidates,
  bytesHtml,
  cardHtml,
  concatList,
  replayLogLines,
  tamperOneByte,
  terminalHtml,
  type CapturedFrame,
  type ShotAction,
} from "../src/demo-capture.ts";
import type { JobResult } from "../src/pipeline.ts";
import { loadRecording, replayJob, type Recording } from "../src/replay.ts";
import { UploadServer, providersFromEnv } from "../src/serve.ts";

const args = process.argv.slice(2);
const option = (name: string, fallback: string): string => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1]! : fallback;
};
const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = join(root, option("--out", "out/demo"));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const browser = browserCandidates(process.env, process.platform).find((p) => existsSync(p));
if (!browser) {
  console.error("no Edge or Chrome found; set PROOFSHOT_BROWSER to a Chromium-family browser");
  process.exit(2);
}

rmSync(outDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
mkdirSync(outDir, { recursive: true });

// The replayed recordings get their own scratch jobs root, so data/jobs is only read.
const replayRoot = join(outDir, "replay-jobs");
const replays = new Map<string, { rec: Recording; result: JobResult; id: string }>();
for (const name of REPLAYED_RECORDINGS) {
  const rec = loadRecording(join(root, "demo/recordings", name));
  const result = await replayJob(rec, { outRoot: replayRoot });
  replays.set(name, { rec, result, id: result.dir.split(/[\\/]/).pop()! });
}

// The pages the capture writes itself, from committed files only.
const pagesDir = join(outDir, "pages");
mkdirSync(pagesDir, { recursive: true });
const pageHtml = (f: CapturedFrame): string => {
  const page = f.page!;
  if (page.kind === "card") return cardHtml(page);
  if (page.kind === "bytes") return bytesHtml(f.path, readFileSync(join(root, f.path), "utf8"), page.show);
  const r = replays.get(page.recording);
  if (!r) throw new Error(`recording ${page.recording} was not replayed`);
  const lines = replayLogLines({
    recording: r.rec.manifest.name,
    recordedJob: r.rec.manifest.recorded_from.job_id,
    recordedHead: r.rec.manifest.recorded_from.head,
    dir: relative(root, r.result.dir).split("\\").join("/"),
    head: r.result.head,
    refused: r.result.refused,
    renders: r.result.renders,
    receipt: readFileSync(join(r.result.dir, "receipt.jsonl"), "utf8"),
  });
  return terminalHtml("Replay of a recorded run", lines);
};

// Fixture providers only: the capture never runs a job, and must not read a key.
const providers = providersFromEnv({});
const listen = (jobsRoot: string): Promise<{ server: Server; base: string }> =>
  new Promise((resolve) => {
    const app = new UploadServer({ webDir: join(root, "web"), jobsRoot, shopDir: join(root, "web/shop"), garmentsDir: join(root, "data/garments"), providers });
    const server = createServer((req, res) => {
      // Read-only: the capture clicks nothing that writes.
      if (req.method !== "GET" && req.method !== "HEAD" && !/\/(verify|tamper)$/.test(req.url ?? "")) {
        res.writeHead(405).end();
        return;
      }
      void app.handler(req, res);
    });
    server.listen(0, "127.0.0.1", () => {
      const a = server.address();
      resolve({ server, base: `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}` });
    });
  });
const servers = { jobs: await listen(join(root, "data/jobs")), replay: await listen(replayRoot) };

// Browser, with a throwaway profile under out/demo.
const profile = join(outDir, "browser-profile");
const proc = spawn(browser, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
let port = 0;
for (let i = 0; i < 100 && !port; i++) {
  await sleep(100);
  try {
    port = Number(readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]);
  } catch {}
}
if (!port) throw new Error("the browser did not open a DevTools port");
const version = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()) as { webSocketDebuggerUrl: string };

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
await cdp("DOM.enable");

const evaluate = async (expression: string): Promise<unknown> => {
  const r = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
const waitFor = async (expression: string, what: string, ms = 10000): Promise<void> => {
  for (let t = 0; t < ms; t += 100) {
    if (await evaluate(expression)) return;
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${what}`);
};
const filled = (sel: string) => `!!document.querySelector(${JSON.stringify(sel)}) && document.querySelector(${JSON.stringify(sel)}).textContent.trim().length > 0`;

const urlOf = (f: CapturedFrame): string => {
  if (f.from === "disk") return pathToFileURL(join(root, f.path)).href;
  if (f.from === "page") {
    const file = join(pagesDir, `${f.name}.html`);
    writeFileSync(file, pageHtml(f));
    return pathToFileURL(file).href;
  }
  const path = f.path.replace(/@([A-Za-z0-9._-]+)/, (_, name: string) => encodeURIComponent(replays.get(name)?.id ?? name));
  return servers[f.from].base + path;
};

const runAction = async (a: ShotAction): Promise<void> => {
  if ("wait" in a) return waitFor(filled(a.wait), a.wait);
  if ("scrollTo" in a) {
    await evaluate(`document.querySelector(${JSON.stringify(a.scrollTo)})?.scrollIntoView({ block: "start" })`);
    return sleep(200);
  }
  if ("select" in a) {
    await evaluate(`(() => { const s = document.querySelector(${JSON.stringify(a.select)}); s.value = ${JSON.stringify(a.value)}; s.dispatchEvent(new Event("change")); })()`);
    return sleep(500);
  }
  if ("click" in a) {
    await evaluate(`document.querySelector(${JSON.stringify(a.click)}).click()`);
    return a.waitText ? waitFor(filled(a.waitText.selector), a.waitText.selector) : sleep(500);
  }
  const text = readFileSync(join(root, a.verify.receipt), "utf8");
  const receipt = a.verify.tamper ? tamperOneByte(text) : text;
  if (receipt === null) throw new Error(`no byte to change in ${a.verify.receipt}`);
  await evaluate(`document.getElementById("receipt-text").value = ${JSON.stringify(receipt)}`);
  const { root: doc } = await cdp("DOM.getDocument");
  const { nodeId } = await cdp("DOM.querySelector", { nodeId: doc.nodeId, selector: "#image-file" });
  await cdp("DOM.setFileInputFiles", { nodeId, files: [join(root, a.verify.image)] });
  await evaluate(`document.getElementById("result").textContent = ""; document.getElementById("check").click()`);
  return waitFor(filled("#result"), "the verify result");
};

const report: { id: string; beat: number; seconds: number; frames: string[]; skip?: string; error?: string }[] = [];
const pngs: { file: string; seconds: number }[] = [];
for (const shot of DEMO_SHOTS) {
  const row: (typeof report)[number] = { id: shot.id, beat: shot.beat, seconds: shot.seconds, frames: [] };
  report.push(row);
  if (shot.skip) row.skip = shot.skip;
  for (const frame of shot.frames) {
    for (const vp of VIEWPORTS) {
      const file = `${frame.name}-${vp.label}.png`;
      try {
        await cdp("Emulation.setDeviceMetricsOverride", { width: vp.width, height: vp.height, deviceScaleFactor: vp.scale, mobile: vp.width < 600 });
        await cdp("Page.navigate", { url: urlOf(frame) });
        await waitFor(`document.readyState === "complete"`, "page load");
        for (const a of frame.actions) await runAction(a);
        await sleep(300);
        const shotPng = await cdp("Page.captureScreenshot", { format: "png" });
        writeFileSync(join(outDir, file), Buffer.from(shotPng.data, "base64"));
        row.frames.push(file);
        if (vp.label === "1280") pngs.push({ file, seconds: shot.seconds / shot.frames.length });
      } catch (err) {
        row.error = `${file}: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
  }
}

// Close the browser and wait for it to exit, so its profile files are no longer locked.
const exited = new Promise<void>((r) => proc.once("exit", () => r()));
await send("Browser.close").catch(() => proc.kill());
await Promise.race([exited, sleep(5000).then(() => proc.kill())]);
ws.close();
for (const s of Object.values(servers)) s.server.close();

// The video is assembled elsewhere from this list: the 1280 px frames in shot order with their seconds.
writeFileSync(join(outDir, "frames.txt"), concatList(pngs));
const total = report.reduce((n, r) => n + r.seconds, 0);
const video = "not made here: assemble out/demo/frames.txt (ffmpeg -f concat)";
writeFileSync(join(outDir, "shots.json"), JSON.stringify({ browser: browser.split(/[\\/]/).pop(), video, total_seconds: total, shots: report }, null, 2) + "\n");
rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });

for (const r of report) {
  const what = r.error ? `ERROR ${r.error}` : r.frames.length ? r.frames.join(", ") : `skipped: ${r.skip}`;
  console.log(`${r.id} (beat ${r.beat}, ${r.seconds} s): ${what}`);
}
console.log(`total: ${total} s; video: ${video}`);
process.exit(report.some((r) => r.error) ? 1 : 0);
