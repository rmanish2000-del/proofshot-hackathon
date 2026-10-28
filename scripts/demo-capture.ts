// npm run demo:capture [-- --out out/demo --hold 3]
//
// DEMO1 (Grok 29 Oct 00:30): records the docs/DEMO.md shots a headless browser
// can see, as numbered PNG frames at 360 and 1280 px under the gitignored
// out/demo/, plus out/demo/demo.mp4 (each frame held --hold seconds) when
// ffmpeg is on PATH. It starts the local server itself on a free port, reading
// the committed data/jobs and a replay of demo/recordings/review: no upload,
// no publish, no live or paid call, no key read. Shots it cannot capture
// (slides, terminal, OS tray, text editor) are listed with the reason in
// out/demo/shots.json and printed at the end.
//
// The browser is Edge or Chrome (PROOFSHOT_BROWSER names another), driven
// over the DevTools protocol with Node's own WebSocket: no new dependency.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { DEMO_SHOTS, REPLAYED_RECORDINGS, VIEWPORTS, browserCandidates, tamperOneByte, type CapturedFrame, type ShotAction } from "../src/demo-capture.ts";
import { loadRecording, replayJob } from "../src/replay.ts";
import { UploadServer, providersFromEnv } from "../src/serve.ts";

const args = process.argv.slice(2);
const option = (name: string, fallback: string): string => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1]! : fallback;
};
const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = join(root, option("--out", "out/demo"));
const hold = Number(option("--hold", "3"));
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
const replayIds = new Map<string, string>();
for (const name of REPLAYED_RECORDINGS) {
  const r = await replayJob(loadRecording(join(root, "demo/recordings", name)), { outRoot: replayRoot });
  replayIds.set(name, r.dir.split(/[\\/]/).pop()!);
}

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
  const path = f.path.replace(/@([A-Za-z0-9._-]+)/, (_, name: string) => encodeURIComponent(replayIds.get(name) ?? name));
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

const report: { id: string; beat: number; frames: string[]; skip?: string; error?: string }[] = [];
const pngs: string[] = [];
for (const shot of DEMO_SHOTS) {
  const row: (typeof report)[number] = { id: shot.id, beat: shot.beat, frames: [] };
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
        if (vp.label === "1280") pngs.push(file);
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

// The short video: the 1280 px frames in shot order, each held `hold` seconds, if ffmpeg exists.
let video = "not made: ffmpeg is not on PATH";
if (pngs.length && spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0) {
  const list = pngs.map((f) => `file '${f}'\nduration ${hold}`).join("\n") + `\nfile '${pngs[pngs.length - 1]}'\n`;
  writeFileSync(join(outDir, "frames.txt"), list);
  const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", "frames.txt", "-vf", "scale=1280:-2,format=yuv420p", "-r", "25", "demo.mp4"], { cwd: outDir, stdio: "inherit" });
  video = r.status === 0 ? "out/demo/demo.mp4" : `ffmpeg failed (exit ${r.status})`;
}
writeFileSync(join(outDir, "shots.json"), JSON.stringify({ browser: browser.split(/[\\/]/).pop(), video, shots: report }, null, 2) + "\n");
rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });

for (const r of report) {
  const what = r.error ? `ERROR ${r.error}` : r.frames.length ? r.frames.join(", ") : `skipped: ${r.skip}`;
  console.log(`${r.id} (beat ${r.beat}): ${what}`);
}
console.log(`video: ${video}`);
process.exit(report.some((r) => r.error) ? 1 : 0);
