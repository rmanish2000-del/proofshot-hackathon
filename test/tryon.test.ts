import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { fixtureProviders, runJob } from "../src/pipeline.ts";
import type { Renderer, SourceImage } from "../src/pipeline.ts";
import { SelfComparisonError, assertNotSelfComparison, guardRenderer } from "../src/tryon.ts";
import { sha256Hex } from "../src/util.ts";

const photo1 = Uint8Array.from([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
const photo2 = Uint8Array.from([0xff, 0xd8, 4, 5, 6, 0xff, 0xd9]);
const sources: SourceImage[] = [
  { name: "front.jpg", bytes: photo1 },
  { name: "back.jpg", bytes: photo2 },
];
const echo = (pick: (s: readonly SourceImage[]) => Uint8Array): Renderer => ({
  provider: "stand-in",
  model: "owner-photo",
  render: async ({ sources: s }) => ({ bytes: pick(s), ext: "jpg" }),
});

test("TRYON 1: a render with any source photo's hash is refused, by photo number", () => {
  const shas = [sha256Hex(photo1), sha256Hex(photo2)];
  assert.throws(() => assertNotSelfComparison(shas[0]!, shas), (e) => e instanceof SelfComparisonError && /source photo 1/.test(e.message));
  assert.throws(() => assertNotSelfComparison(shas[1]!, shas), /source photo 2/);
  assert.doesNotThrow(() => assertNotSelfComparison(sha256Hex(Uint8Array.from([9])), shas));
});

test("TRYON 2: the guarded renderer refuses photo 1 and photo 2, passes a new image, keeps its identity", async () => {
  await assert.rejects(guardRenderer(echo((s) => s[0]!.bytes)).render({ scene: "studio", prompt: "", sources }), SelfComparisonError);
  await assert.rejects(guardRenderer(echo((s) => s[1]!.bytes)).render({ scene: "studio", prompt: "", sources }), SelfComparisonError);
  const fresh = guardRenderer(echo(() => Uint8Array.from([0xff, 0xd8, 7, 0xff, 0xd9])));
  assert.deepEqual((await fresh.render({ scene: "studio", prompt: "", sources })).bytes, Uint8Array.from([0xff, 0xd8, 7, 0xff, 0xd9]));
  assert.equal(fresh.provider, "stand-in");
  assert.equal(fresh.model, "owner-photo");
});

test("TRYON 3: in a job, the stand-in under the guard is render_failed and REFUSE, and the verifier is never called", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tryon-"));
  try {
    let verifierCalls = 0;
    const base = fixtureProviders({ renders: () => new Uint8Array(0), findings: () => ({ findings: [] }) });
    const providers = {
      ...base,
      renderer: guardRenderer(echo((s) => s[0]!.bytes)),
      verifier: { ...base.verifier, verify: async (req: Parameters<typeof base.verifier.verify>[0]) => (verifierCalls++, base.verifier.verify(req)) },
    };
    const result = await runJob({ jobId: "t", garmentNote: "test: Type: shirt", scenes: ["studio"], sources }, { outRoot: dir, providers, provenance: "fixture" });
    assert.equal(result.renders[0]?.decision, "REFUSE");
    assert.equal(verifierCalls, 0);
    const receipt = readFileSync(join(result.dir, "receipt.jsonl"), "utf8");
    assert.match(receipt, /SelfComparisonError/);
    assert.doesNotMatch(receipt, /"kind":"fidelity"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
