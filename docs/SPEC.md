# SPEC: attributes, gate rules, receipt format

Version 0.1.0. This document is the authority; `src/` is the implementation of
it. Where they disagree, that is a bug in the code.

**Where this file comes from.** It is the written specification of ProofShot's
pre-existing core, carried over from the private `proofshot` repository
(`docs/SPEC.md`, first written 24 Oct 2026, before the event; brought up to date
27 Oct). The code in this repository is rewritten from it. Changes made here
during the event are marked *(event)*.

Status in this repo: §1–§4 and §10 are implemented (`src/types.ts`,
`src/gate.ts`, `src/receipt.ts`, `src/prior.ts`, `src/schema.ts`, `src/png.ts`,
`src/fidelity.ts`), the job pipeline with a fixture provider and a `fidelity`
entry per render (`src/pipeline.ts`), and the image check and verify page of §9
(`src/core.js`, `src/check.ts`, `web/verify.html`), the render provider
guard of §8 (`src/render.ts`), the shopper preview of §11 (`src/shop.ts`,
`scripts/shop-build.ts`, `web/shop.html`), and replay and record of §7
(`src/replay.ts`, `scripts/replay.ts`, `scripts/record.ts`,
`demo/recordings/`). The provider HTTP requests of §8 describe a pre-existing
feature not yet rebuilt here.

## 1. Attributes

Each attribute is one thing a render can get wrong *about the garment*. Nothing
here judges the model, the pose, the background or the lighting.

| Attribute | Severity | Confidence floor | The sentence it exists for |
|---|---|---|---|
| `color` | hard | 0.70 | "the indigo came out purple" |
| `print_pattern` | hard | 0.70 | "the paisley became a floral" |
| `logo_text` | hard | 0.85 | "it invented a label" |
| `collar` | hard | 0.80 | "a button-down became a spread collar" |
| `sleeve_length` | soft | 0.60 | "three-quarter became full" |
| `hem` | soft | 0.60 | "the side slits disappeared" |
| `pocket_count` | soft | 0.60 | "one pocket became two" |
| `buttons` | soft | 0.70 | "six buttons became four, and the placket moved" |
| `fabric_texture` | soft | 0.65 | "cotton started looking like satin" |

**hard**: getting it wrong ships a false product claim to a buyer.
**soft**: getting it wrong is a cosmetic disappointment, still not shippable
unattended.

The floor is the confidence below which a *match* is not trusted either. A
low-confidence match is a `REVIEW`, never a `RELEASE`.

## 2. The gate

Input: `DecisionInput[]`: `attribute`, `verdict`, `confidence`. No other field
exists, so no prompt text, note, or model prose can reach the decision.

Rules, highest priority first:

| # | Rule | Fires when | Decision |
|---|---|---|---|
| 6 | `duplicate_attribute` | two findings for one attribute | `REFUSE` |
| 5 | `unknown_attribute` | an attribute with no policy in this build | `REFUSE` |
| 4 | `hard_mismatch` | mismatch on a hard attribute, at/above floor | `REFUSE` |
| 3 | `not_verified` | an attribute in the policy has no finding | `REFUSE` |
| 2 | `low_confidence` | confidence below the floor, any verdict | `REVIEW` |
| 1 | `soft_mismatch` | mismatch on a soft attribute, at/above floor | `REVIEW` |
| 1 | `uncertain` | verifier answered `uncertain`, at/above floor | `REVIEW` |

No rule fires → `RELEASE`. The cited reason is the highest-priority rule; every
firing rule is listed in `reasons`.

A finding fires at most one of rules 4, 2, 1. Below the floor only
`low_confidence` fires, whatever the verdict: a hard mismatch below its floor is
`REVIEW`, not `REFUSE` (pinned by a test, *(event)*).

Fail-closed properties, each with a test in `test/gate.test.ts`:

- a missing attribute is not a pass
- an unknown attribute is not a pass
- `NaN` confidence is treated as 0, not as certainty
- a persuasive `note` cannot change a decision

Fidelity as a gate input *(event, Grok 27 Oct)*: the gate can also take the
fidelity result of §10 (`decision`, `reasons`). The decision is the worse of
the findings-based decision and the fidelity decision; fidelity can never make
it better. When fidelity is what made it worse, `cited` is
`{attribute: null, verdict: null, confidence: null, rule: "fidelity", reason:
"fidelity <DECISION>: <reasons joined by '; '>"}` and comes first in `reasons`;
otherwise a fidelity REVIEW or REFUSE is listed last in `reasons` and a
fidelity RELEASE adds nothing. A fidelity decision outside the three is
`REFUSE`.

Choices this rewrite made where the table is silent *(event, confirmed by Grok
27 Oct)*: a verdict outside the vocabulary is `uncertain`; input that is not an
array is no findings (all nine `not_verified`); a finding that is not an object
is `unknown_attribute`.

## 3. The receipt

One JSON object per line, append-only, `receipt.jsonl`.

```json
{ "seq": 0, "at": "2026-10-26T09:00:00.000Z", "kind": "job",
  "payload": { }, "prev": "000…0", "hash": "…" }
```

`hash = sha256(canonicalJson({ seq, at, kind, payload, prev }))`

- `canonicalJson` sorts object keys recursively and rejects non-finite numbers,
  so the same content always hashes to the same value. An object property set
  to `undefined` is left out, as `JSON.stringify` does *(event)*.
- `prev` is the previous entry's `hash`; entry 0 points at 64 zeros (`GENESIS`).
- `seq` is the entry index, checked on verification.
- The writer continues an existing file only if it verifies, and refuses a
  broken one without touching it *(event)*.

Entry kinds, in the order a job writes them (`render` → `verifier` →
`fidelity` → `gate` → `release` repeat per render):

| Kind | Payload fields |
|---|---|
| `job` | `job_id`, `garment_note`, `provenance` (`live` / `fixture` / `replay`), on a replay also `mode: "replay"` and `recorded_from`, `scenes`, `source_images` (`[{name, sha256}]`), `garment_id`, `prior_records` |
| `segments` | `count`, `segments` (`[{label, box, score, mask_sha256 \| null}]`), and `segmenter` (`{provider, model}`) when the segmenter made a model claim *(event, #18)*: a fixture segmenter makes none and the field is absent, so a fixture receipt claims no model |
| `render` | `render_id`, `sha256` (the image), `model`, `provider` (`meta` / `openai-images` / `fal` / `fixture`), `prompt` |
| `verifier` | `render_id`, `findings` (the parsed array, notes included), `verifier: {provider, model, base}`, and `usage` when the provider reported it (`prompt_tokens`, `completion_tokens`, `cached_tokens`, `images[{bytes, width, height}]`) |
| `fidelity` *(event)* | `render_id`, `decision`, `metrics` (`{delta_e, hist, texture, area}`, a non-finite value as `null`; or `null` when nothing was measured), `reasons`, and `error` (`<name>: <message>`) when the check threw or answered outside the three decisions, in which case `decision` is `REFUSE` |
| `gate` | `render_id`, `decision`, `cited` (`{attribute, verdict, confidence, rule, reason}` or null), `reasons`; the decision already includes fidelity (§2) |
| `release` | only for `RELEASE`: `render_id`, `image_sha256`, `approver`, `approved_by_human` (`approver !== "unattended"`) |

The kind type also names `approval`; no current code writes it.

- `garment_id` = `sha256(canonicalJson(sorted source image hashes))`, or `null`
  when no source file could be hashed. Same photos in any order, same id.
- `prior_records` = every earlier job on the same `garment_id` in sibling output
  directories: `[{job_id, head, refusals, releases, at}]`. A re-run appends a
  record; it does not clear the chain, and earlier refusals stay visible.
  In this rewrite *(event)*: a sibling is a subdirectory of the output root
  holding `receipt.jsonl`; it matches when its entry 0 is a `job` naming the same
  `garment_id`; `refusals` counts `gate` entries with `decision: "REFUSE"`,
  `releases` counts `release` entries, `head` is its chain head and `at` its job
  entry's time; the list is oldest first, ties by directory name; the job's own
  directory is skipped; a `null` garment id has no history. A sibling receipt
  that does not parse or verify **throws**: its refusals cannot be counted, so
  the new job does not start as if there were none.
- The pipeline *(event)*: a job writes to `<out>/<job_id>/receipt.jsonl` and
  the render images beside it as `<render_id>.<ext>`, `render_id` being
  `<job_id>-r<scene index>`. A job id must be a plain directory name, and a job
  id that already has a receipt is refused, so one chain is one job.
  - If `prior_records` throws, the job entry carries `prior_records: null` and
    is followed by one `gate` entry with `render_id: null`, `decision:
    "REFUSE"` and `cited.rule: "prior_records_unreadable"` (the reason names the
    file); nothing is rendered (confirmed by Grok 27 Oct). That entry counts as
    a refusal in later prior records.
  - If the verifier throws or its output fails §4, the `verifier` entry has
    `findings: []` and an `error` (`<name>: <message>`), and the gate refuses
    the render as `not_verified`. No new rule is needed for that.
  - If the segmenter throws *(event, Grok 27 Oct)*, the job is refused like
    unreadable prior records: no `segments` entry, one `gate` entry with
    `render_id: null`, `decision: "REFUSE"`, `cited.rule: "segment_failed"`
    and the reason `<name>: <message>`; nothing is rendered. The job entry
    keeps the prior records it read.
  - If the renderer throws on a scene *(event, Grok 27 Oct)*, that scene gets
    one `gate` entry with its `render_id`, `decision: "REFUSE"`,
    `cited.rule: "render_failed"` and the reason `<name>: <message>` (no
    `render`, `verifier` or `fidelity` entry, no image), and the job goes on to
    the next scene.
  - Every scene a job attempts ends with a `gate` entry. Each of these
    pipeline refusals has `attribute`, `verdict` and `confidence` null, is
    listed alone in `reasons`, and counts as a refusal in later prior records.
  - The fidelity check (§10) is an injected provider like the others. If it
    throws or answers a decision outside the three, the `fidelity` entry is
    `REFUSE` with `error` set, never a pass. The fixture provider's default
    answers `RELEASE` with `metrics: null`: a fixture job measures nothing,
    and its job entry says `provenance: "fixture"`.
  - The `segments` entry is written even when the segmenter finds nothing
    (`count: 0`). Masks are recorded only as `mask_sha256`.
- Timestamps (`at`) come from an injectable clock, default the wall clock. A
  replay feeds the recorded timestamps in order and throws if it runs out,
  rather than falling back to the clock.

Verification (`verifyChain`) checks: non-empty, sequential `seq`, `prev` linkage,
and hash recomputation. It reports the first broken index.

**Threat model.** Detectable: editing a payload, reordering, deleting a line,
forging an entry without rewriting every later hash. Not prevented: rewriting the
entire file from genesis, because the file has no signature, no append-only
storage guarantee, and no external witness. Do not describe this record as
"signed" or "non-repudiable"; it is neither.

## 4. Verifier output schema

`src/schema.ts` holds the schema sent as a strict structured-output contract.
One finding per attribute, `minItems: 9`:

```
{ findings: [ { attribute, verdict: "match"|"mismatch"|"uncertain",
                confidence: 0..1, note: string,
                evidence: { source_bbox: [x,y,w,h]|null,
                            render_bbox: [x,y,w,h]|null } } ] }
```

Validation is strict and fails closed: a response with no findings array, a
finding that is not an object, a missing attribute string, an unknown verdict, a
non-numeric or non-finite confidence, output that is not JSON, or no message
content throws `VerifierProtocolError`, and a thrown verifier is a refusal,
never a pass.

The parser accepts three wrappings of the same object: the object itself, a JSON
string, or a `content` field holding either. It is lenient where the gate already
fails closed: it does not enforce `minItems`, the attribute list or the 0..1
range (a missing or unknown attribute is refused by the gate, §2). A missing
`note` becomes `"(no note)"`; a bbox that is not four finite numbers becomes
`null`, and bbox values are clamped to 0..1.

In this rewrite *(event)*: "no message content" is `null`, `undefined`, a blank
string, or a `content` field holding one of those; a `content` field is only
unwrapped when the object has no `findings` key; a note that is not a string is
`"(no note)"`; an `evidence` that is not an object gives two `null` bboxes.

The live verifier *(event, P6)* is in §12: Muse Spark Open on Baseten, no JSON
mode, so the schema goes in the system message and the answer's text is parsed
here as strictly as any other; the only leniency added is that code fences and
prose around the JSON object are dropped before parsing.

Duplicate attributes *(event, pinned 27 Oct)*: the parser keeps every finding,
so two findings for one attribute (say `color` match 0.9 and `color` mismatch
0.8) reach the gate, which refuses them as `duplicate_attribute` (§2, rule 6)
in either order. Neither the last nor the best finding wins; the operator sees
the conflict on the receipt.

## 5. What this format deliberately cannot express

Named here rather than approximated, because a rule that silently compiles to
nothing reads as protection the brand does not have:

- **Fit and drape.** Needs a body model and physics; the render can be honest
  pixel-for-pixel and still misrepresent how the garment falls.
- **Fabric feel.** Weight, stretch, itch. Not visible.
- **True colour under another light.** The render is judged against the source
  photo, not against the physical garment under the buyer's bulb.
- **"Good enough for Instagram."** A judgement about a brand's tolerance, not a
  fact about an image; the human queue is where that lives.
- **Anything about the model's identity or likeness.** Consent is a separate
  record, out of scope for v0.1.

## 6. What the record does not establish

Beyond the rewrite risk in §3, five gaps a customer should be told about:

1. The hashed image is not provably the delivered image.
2. The model ID is the provider's claim, not an attestation of which weights ran.
3. Timestamps are local: they order events, they do not date them credibly.
4. The approver is a name, not an authenticated identity.
5. The source photos may not depict the garment actually being sold.

And the bound on the product claim: a render the verifier marks `match` on every
attribute ships. The failure mode is a false match; its rate belongs in the golden
set report, not in an adjective.

## 7. Replay and record

A recording (`demo/recordings/<name>/`) holds a finished job's inputs, renders,
findings, verifier identity, usage and timestamps, each file with its sha256.

- Loading refuses a recording if any file's hash changed, or if a render names a
  Muse Image model (§8).
- Replay runs the same pipeline and receipt writer with no network call, even
  with a key set, and labels the job `provenance: "replay"`, `mode: "replay"`.
  The verifier identity is the recorded run's, so attribution follows what ran.
- Replaying twice gives byte-identical receipts; recording a job and replaying
  it reproduces its receipt byte for byte.
- Recording refuses a chain that does not verify and a job that is itself a
  replay, and strips credential fields and URL query strings (token counts stay).

In this rewrite *(event, Grok 27 Oct: proposals 1 and 2, recorded fidelity
results)*, `src/replay.ts`:

- **Layout.** `manifest.json` (`name`, `recorded_from: {job_id, head}`, and
  `files`: every other file's path to its sha256), `sources/<name>` (the input
  photos, by the job entry's names), `renders/<render_id>.<ext>` (the images
  the job wrote), and `steps.json` (the job's id, note, scenes, approver and
  source hashes; every entry's `at` in order; the `segments` as the receipt
  recorded them; the renderer's provider and model; the verifier identity; and
  per scene either the render file and hash, the verifier's findings, usage
  and error, and the fidelity result, or the `render_failed` reason). A job
  refused on `segment_failed` records its reason and replays to the same
  refusal; one refused on `prior_records_unreadable` is not recorded, since
  prior records belong to the replay's own output directory.
- **"Byte for byte" means this.** Every entry after the job entry has the
  recorded `seq`, `at`, `kind` and `payload`. The job entry itself says
  `provenance: "replay"`, `mode: "replay"` and
  `recorded_from: {recording, job_id, head}`, so its hash, and through `prev`
  every hash after it, differ from the recorded chain. Two replays of one
  recording are byte-identical, whole file. Each replay must go to an output
  directory with no receipt for that job id (§3: one chain is one job).
- **Recorded answers, not re-measured ones.** Replay providers answer from
  `steps.json`: the segmenter returns the recorded segments with each mask
  known only by its `mask_sha256` (the receipt never held the bytes), the
  renderer hands out the recorded images in scene order, the verifier returns
  the recorded findings as its raw output (the §4 parser is a fixed point on
  its own output) and the recorded usage, and the fidelity check returns the
  recorded `decision`, `metrics`, `reasons`. A recorded error (`<name>:
  <message>` on a render, verifier or fidelity step) is thrown again with that
  name and message, so the pipeline writes the same refusal. Nothing in a
  replay reads a key or can reach the network; a test fails if `fetch` is
  called.
- **Refusals on record.** The receipt does not verify; the job is a replay;
  the sources given are not the job's own (name and sha256, in order); a
  render image on disk does not hash to its `render` entry; a scene has no
  gate entry (the job did not finish); a render's prompt is not what this
  build's template gives for that note and scene; a recording of that name
  already exists.
- **Stripping.** Over the whole of `steps.json`: any key matching
  `api_key`, `secret`, `password`, `authorization`, `bearer`, `credential`,
  `cookie`, `key`, or ending in `token` is dropped (`*_tokens` counts stay),
  and any URL loses its query string. A verifier `base` with a query string
  therefore replays without it, and that one field then differs from the
  recorded receipt.
- **One gap.** A verifier that returned usage and then failed the §4 schema
  has both `usage` and `error` on its entry; the replay verifier throws the
  recorded error, so its entry has no `usage`. No other difference is known.
- The verify page (§9) prints "Replay of a recorded run" with the recording
  name, recorded job id and recorded head when the job entry carries
  `mode: "replay"`.
- `npm run demo:record -- <job dir> <sources dir> <recording dir> [name]`,
  `npm run demo:replay -- <recording dir> <out root>`, and `npm run demo:canned`
  writes the three canned fixture recordings (`release`, `review`, `refuse`)
  into `demo/recordings/`, synthetic images and table-driven findings, no
  model and no garment.

## 8. Render providers and the Muse Image refusal (guard rebuilt, HTTP not yet)

`RENDER_PROVIDER` picks the renderer: `openai-images` (default), `fal`, or
`meta`. Muse Image is not available in India (Meta Geographic Use Policy §2.2),
so any model id matching `/muse[\s._\/-]*image/i` is refused before a request
leaves, on every provider. `meta` with an empty `MODEL_RENDER` throws before any
request. The receipt names the provider and model of every render (§3).

In this rewrite *(event)*, `src/render.ts`: `rendererFromEnv` reads only
`RENDER_PROVIDER` and `MODEL_RENDER` (trimmed; blank is unset) and takes the
HTTP transport as a parameter, so it reads no key. An unknown provider (the
match is exact and case-sensitive) throws `RenderConfigError`.
`openai-images` defaults to `gpt-image-1`; `fal`, like `meta`, throws without
`MODEL_RENDER` (no default is specified for it). A Muse Image model throws
`MuseImageRefused` when the renderer is built and again before each request.
The pipeline also checks every renderer's model before calling it, so an
injected renderer naming Muse Image is refused per scene as `render_failed`
(§3) and never called. The HTTP request for each provider is not rebuilt yet.

The `stand-in` provider *(event, 28 Oct)*, `standInRenderer()` in
`src/render.ts`: a `Renderer` that generates nothing. It returns the job's
first source image byte for byte as the "render" of every scene, with the
file extension read from the bytes (`jpg` or `png`), and the receipt's render
entry says `provider: "stand-in", model: "owner-photo"`, so a reader of the
record can tell the image was never rendered. A job with no source, or a first
source that is not a JPEG or PNG, throws `StandInError`, recorded as
`render_failed` (§3). `RENDER_PROVIDER=stand-in` selects it from the
environment with no transport call; a `MODEL_RENDER` other than `owner-photo`
is refused (`RenderConfigError`), since the receipt would otherwise claim a
model that generated nothing. It exists so a real pipeline job (live verifier,
real receipt) can run while no render transport exists, with the stand-in
named on the record and on every card that shows its image (§11).

## 9. The verify page's image check

Given a record and an image's sha256, in this order:

| Status | When |
|---|---|
| `TAMPERED` | the chain does not verify, or the hash is not 64 hex characters |
| `VALID` | the hash equals a `release` entry's `image_sha256` |
| `NOT RELEASED` | the hash equals a `render` entry's `sha256` with no release; the page cites that render's gate decision |
| `TAMPERED` | the hash is in no entry |

In this rewrite *(event)*, `checkImage` in `src/check.ts`: the hash is trimmed
and lower-cased before the hex check, since hex case carries no meaning. VALID
reports the release's `render_id`. NOT RELEASED cites the `gate` entry with the
same `render_id`, or no decision when the render never reached a gate (a job
that aborted). A record that does not verify vouches for no image, including one
it released.

The page is one self-contained HTML file (no external resource, no network
call); the browser and the server must agree on canonical bytes, verdict and head.

In this rewrite *(event, Grok 27 Oct)*:

- The page is `web/verify.html`. It opens from `file://`, and a
  Content-Security-Policy of `default-src 'none'` (inline script and style only)
  blocks any request. It takes a `receipt.jsonl` (file or paste) and an image
  (file or pasted sha256).
- One source for both sides: `src/core.js` is plain JavaScript with no imports
  (`canonicalJson`, `parseReceipt`, the chain check, `checkImageWith`). Node
  hashes with `node:crypto` and the page with `crypto.subtle.digest('SHA-256')`;
  the chain check takes the digests, so only the hash function differs. The page
  inlines `core.js` between two marker lines (`export` dropped); a test fails if
  that copy is stale, and `npm run page` rewrites it.
- With no usable `crypto.subtle` (missing, or throwing) the page shows "cannot
  verify in this browser" and no status, never `VALID`.
- Text that is not a receipt fails the chain check at entry 0, so every image
  against it is `TAMPERED`.
- A test checks that the browser path and `node:crypto` give the same chain
  result (head included) and the same image check on the fixture receipt, and
  on one edited entry.

## 10. Garment fidelity

A deterministic second check, beside the verifier: SAM masks say where the
garment is in the source and the render; code measures the masked regions and
decides from thresholds in `config/fidelity.json` (starting values,
UNCALIBRATED). No model judges anything.

| Metric | Meaning | REVIEW | REFUSE |
|---|---|---|---|
| `delta_e` | CIE76 distance between the mean Lab colours | above 10 | above 20 |
| `hist` | Hellinger distance between 64-bin Lab histograms (0 same, 1 disjoint) | above 0.35 | above 0.6 |
| `texture` | share of matching bits in a 64-bit dHash of the masked crops | below 0.8 | below 0.65 |
| `area` | render's masked share of its frame over the source's *(event)* | below 0.4 or above 2.5 | — |

- The worst outcome wins; every breach is listed in `reasons`.
- A missing, empty or wrong-size mask, or an image that is not 8-bit RGB, is
  `REVIEW` with `metrics: null`. A non-finite metric is `REVIEW`.
- A broken thresholds config throws; it never falls back to defaults. The two
  `area` bounds must sit either side of 1.
- Masks from PNG: 8-bit, non-interlaced greyscale, grey+alpha, RGB or RGBA; a
  pixel is garment when its brightness and alpha are both at least 128. Any
  other PNG throws with the reason.
- `area` is directional *(event, approved by Grok 27 Oct)*: the earlier wording,
  the smaller share over the larger, never exceeds 1, so it could not carry an
  upper bound. Render share over source share flags a garment that shrank
  (`area.review_below`, 0.4) and one that grew (`area.review_above`, 2.5) with
  separate knobs.
- Measurement choices *(event, accepted by Grok 27 Oct)*:
  - mask brightness is the Rec. 601 luma (0.299 R + 0.587 G + 0.114 B);
  - Lab is CIE Lab, D65, from sRGB;
  - the histogram has 4×4×4 bins over L 0–100 and a, b −128–128;
  - dHash runs on the mask's bounding box: a 9×8 grid of the mean masked grey,
    one bit per horizontal neighbour pair, and a cell with no garment pixel
    takes the crop's mean grey.
- On the receipt *(event, Grok 27 Oct)*: each render's fidelity result is a
  `fidelity` entry between `verifier` and `gate` (§3), and the gate takes it as
  an input (§2). The pipeline calls an injected checker.
- The checker *(event, P6)*, `maskedFidelityChecker({thresholds?, segmenter?})`
  in `src/fidelity.ts`: the source mask is the first segment with mask bytes
  whose label starts `<first source name>/`; the render mask comes from the
  given segmenter, asked once with the render as an image named `render`.
  No source mask, no segmenter, a segmenter that finds nothing in the render,
  an image that is not a PNG (this build decodes only PNG: there is no JPEG
  decoder, so a JPEG render or source is unmeasured), or a mask or image that
  does not decode is `REVIEW` with `metrics: null` and the reason, never a
  pass; otherwise the result is `checkFidelity`'s. A replay's hash-only mask
  is not mask bytes, so a replay is unmeasured too.
- The segmenter *(event, #18)*, `src/sam.ts`: `samSegmenter({model, transport,
  prompt?})` is the pipeline's `Segmenter` behind an injected transport that
  does the HTTP request, so the adapter reads no key. It asks once per source
  image, in order, with the model id and the prompt (default "the garment"),
  and accepts per image `{segments: [{label, box: [x, y, w, h] 0..1, score
  0..1, mask: base64 PNG | null}]}`, a JSON string of it included. Box and
  score are clamped to 0..1; any other departure from that shape throws
  `SegmentProtocolError`, which the pipeline records as `segment_failed` (§3),
  never as "no garment found". Each segment's label is `<image name>/<label>`
  so the receipt says which photo a mask belongs to. The segments entry then
  carries `segmenter: {provider: "meta", model}` (§3). A blank model id, or
  one naming Muse Image, is refused before any request; `segmenterFromEnv`
  reads `MODEL_SEGMENT` (no default: the id on a receipt is a claim, not a
  guess) and `SEGMENT_PROMPT`. Nothing in the README claims a SAM run until
  one is logged.
- The Meta Model API transport *(event, #18, Grok 28 Oct 08:15)*,
  `src/sam-meta.ts`: `metaSamTransport({fetch, apiKey, parse})` is the
  `SamTransport` for Meta's hosted SAM 3.1. One request per image: `POST
  https://api.meta.ai/v1/responses`, Responses-API body with `model:
  "sam-3.1"`, `stream: true`, one `input_text` (the noun phrase) and one
  `input_image` data URL (`image/jpeg` or `image/png` from the bytes; anything
  else is refused before the request), `metadata: {mask_encoding: "one_bit",
  include_confidence: "true"}`; the key from `MODEL_API_KEY` goes into the
  Authorization header and nowhere else. The answer is a server-sent event
  stream; the `delta` of every `response.output_text.delta` event is joined in
  order (a plain JSON body's `output_text`, or its `output_text` content parts,
  is accepted too). A `response.failed` or `error` event, a non-JSON event, an
  empty body or a non-2xx status throws (the status only, never the body or
  the key) and the pipeline records `segment_failed`. Joined text with no
  `<|mask` token is **no match**: `{segments: []}`, not an error. Text with a
  mask token goes to the injected `parse` (the glue around `@meta-sam/parser`
  >= 0.0.13, which is not installed in this tree yet), whose answer
  `parseSegments` checks as above. `MODEL_SEGMENT` must be exactly
  `meta/sam-3.1 (api.meta.ai)` for this transport; any other id is refused
  before a request, so the receipt's claim and the request never drift. The
  fal fallback (`fal-ai/sam-3-1/image`) sits behind the same `SamTransport`
  type and is not written.

## 11. Shopper preview *(event)*

What a buyer sees: a static product page that is **only a reader of
receipts**. It never calls a model, never runs the gate, and decides nothing;
it shows what the record already says, after checking the record itself.

- `npm run shop` (`scripts/shop-build.ts`, logic in `src/shop.ts`) walks
  `data/jobs/*/receipt.jsonl`. For each job it parses the receipt
  (`parseReceipt`), checks the chain (§3) and, for every `release` entry, finds
  the image file `<render_id>.<ext>` beside the receipt, hashes it, and runs
  the image check of §9 (`checkImageWith`): the row exists only if that answers
  `VALID` for the release's `image_sha256`.
- A catalog row exists **only for a `release` entry of a receipt whose chain
  verifies**. `REVIEW` and `REFUSE` never produce a row; a job with no release
  is simply absent. Each row carries `job_id`, `render_id`, `scene`,
  `image_sha256`, the chain `head`, the receipt path, the image path,
  `garment_note`, `provenance` (`fixture` or `live`), `render_provider` and
  `render_model` (the render entry's, as the record says them; a release whose
  render entry is missing or unnamed gets no row), `approved_by_human` and the
  gate's reason text for that render.
- Fail closed: a receipt that does not parse or verify, a release whose image
  is missing or whose bytes hash to something else, or a job entry missing its
  fields, yields **no row for that job** and the build exits non-zero. The
  released image and the `receipt.jsonl` of every verified job are copied to
  `web/shop/<job_id>/`, and the rows to `web/shop/catalog.json`, with no
  timestamp, so the same jobs give the same bytes.
- The fixture job the tests use (studio released, street refused on colour,
  `provenance: "fixture"`) is written to `data/jobs/fixture-shirt-01/` by the
  same script with a recorded clock, so it is byte-identical on every run. With
  no live render transport (§8) it is one of the jobs the shop shows, and the
  page says so.
- Garment preview jobs *(event, 27 Oct)*: for every folder under
  `data/garments/` that has an `intake.json` and a `note.txt`, the same script
  writes a fixture job `data/jobs/<garment>/` with a recorded clock. Its
  `source_images` are every intake photo with the hashes `intake.json`
  records (a photo whose bytes no longer match is refused, no job is written);
  its one scene `studio` is "rendered" by the `stand-in` provider (§8), which
  returns the garment's own front photo unchanged, as a `.jpg`, and puts
  `stand-in` / `owner-photo` on the render entry; the recorded findings all
  match, so the gate releases. No image is generated and no person is in any
  photo. `provenance` is `fixture` and the `garment_note` says the owner's
  photo stands in for the render. These rows exist so judges can see real
  garments go through the receipt, the verification and the badge; they are
  not renders and are never labelled as such.
- The card label *(event, 28 Oct)*: every card and product view whose row has
  `render_provider: "stand-in"` carries the tag **owner's photo, stands in for
  render**, and its panel's `render` line says "owner's photo, stands in for
  render: nothing was generated". The page decides this from the catalog row,
  which the build read from the receipt's render entry, never from the note's
  wording. Any other row's panel names the render entry's provider and model.
- `web/shop.html` is plain HTML, CSS and JavaScript with no framework and no
  external resource; it fetches only its own `shop/` files. It inlines
  `src/core.js` between the same marker lines as the verify page (`npm run
  page` rewrites both; the stale-copy test covers both). An image gets the
  badge **Verified by ProofShot** only after the page, in the browser,
  re-verifies the copied receipt's chain and hashes the bytes it just fetched
  and finds them equal to the release's `image_sha256` (`verifyRecord` →
  `VALID`, same `render_id`). Otherwise there is no badge and the text
  **not verified**. Without WebCrypto nothing is verified.
- Tapping the badge opens a panel: chain head, `render_id`, gate reason,
  provenance ("fixture job, not a live render" for a fixture), a link
  "Verify it yourself offline" to `verify.html#sha=<hex>`, and download links
  for the `receipt.jsonl` and the image.
- `web/verify.html` reads `#sha=<64 hex>` from its URL fragment
  (`shaFromFragment` in `core.js`: trimmed of `#`, lower-cased, anything else
  is ignored) to prefill the pasted-sha field. No request is made; the CSP is
  unchanged.

## 12. Seller upload *(event, 28 Oct)*

What a seller does: one page, no login, phone first, Hindi or English. They
drop up to three JPEGs of one garment and say what it is; the real pipeline of
§3 runs on their machine; they see each step as it happens, then one result
card; "Publish to shop" exists only when the gate said RELEASE. The page
decides nothing: every decision, reason and hash on it was read from the
server, which read it from the receipt.

- `npm run serve` (`scripts/serve.ts`, logic in `src/serve.ts`) starts one
  local HTTP server on 127.0.0.1 (`--port`, default 8787) that serves `web/`
  (so `upload.html`, `shop.html` and `verify.html` all work from it) and a JSON
  API: `GET /api/mode`, `POST /api/jobs`, `GET /api/jobs/<id>`,
  `POST /api/jobs/<id>/publish`, and `GET /jobs/<id>/<file>` for a job's
  receipt and render images. A path that escapes `web/` or the job, or names
  the job's `sources/` folder, is 404.
- Providers come from the environment (`providersFromEnv`): the renderer from
  `RENDER_PROVIDER`, defaulting to `stand-in` (§8) since no render transport
  exists; the segmenter is SAM 3.1 (§10) only when `MODEL_SEGMENT`,
  `MODEL_API_KEY` and a mask parser are all present, else a fixture that finds
  nothing and claims no model; the verifier is Muse Spark Open on Baseten (§4,
  *P6*) when `BASETEN_API_KEY` is set and the caller gave a fetch, and then
  the fidelity check is the masked one of §10 (`maskedFidelityChecker`),
  which is REVIEW with no metrics while no mask exists. Each step is labelled
  with what stood behind it. The run is **live** (`provenance: "live"`) when
  the verifier is live: a segmenter that did not run claims nothing (zero
  segments, no model on the entry) and the fidelity entry says why it could
  not measure, so nothing on such a receipt is invented. Without the key the
  verifier and the fidelity check are fixtures and the run is **fixture
  mode**: the receipt's `provenance` is `fixture`, `GET /api/mode` says
  `fixture: true`, and the page shows the notice and a "fixture job" tag on the
  card. Fixture mode's verifier records every attribute as `match` with the note
  "recorded in fixture mode: no model judged this image"; it is the same device
  as the garment preview jobs of §11 and is labelled the same way.
- The live verifier *(event, P6, Grok 28 Oct 09:00)*, `src/verifier.ts`
  `basetenVerifier({env, fetch, onCall?})`: one `POST
  https://inference.baseten.co/v1/chat/completions` per render, model
  `meta-models/muse-spark-open-1026` (`MODEL_VERIFIER` overrides; Muse Image
  is refused), the key from `BASETEN_API_KEY` as the bearer token. Messages: a
  `system` message that is the instructions plus the §4 schema verbatim plus
  "Return only JSON matching this schema, no prose"; one `user` message whose
  content parts are, in order, a text part naming each image ("source 1:
  <name>" … "render") followed by its `image_url` data URL (`detail: auto`),
  then the instruction text last. `temperature: 0`, `max_tokens: 4096` (the
  model reasons before it answers; 1500 cut the first live answer off), no
  `response_format` (no JSON mode on Baseten). The message content is the
  raw value, after code fences and prose around the first JSON object are
  dropped; `parseFindings` (§4) still checks it strictly, so prose, a cut-off
  answer, null content, a non-JSON body, a network error or a non-2xx status
  (reported by number only) is a thrown verifier and a `not_verified` REFUSE.
  The receipt's `verifier` entry carries the identity and `usage` (prompt,
  completion and cached tokens, each image's bytes and pixel size read from
  the JPEG frame header or PNG IHDR). `onCall` receives the call log with the
  auth header replaced by a placeholder, every image data URL replaced by its
  byte count and sha256, and the key's value replaced wherever it appears;
  `npm run serve` and `npm run job:live` write it to
  `evidence/verifier-<started_at>.json`. Images are sent as they are: this
  build has no JPEG decoder, so it cannot resize (Baseten's limits are 10 MB
  an image, 8 images, 100 MiB a body; each is refused before the request).
- `npm run job:live [-- <garment dir> <job id> [<jobs root>]]`
  (`scripts/live-job.ts`) runs one real job on a garment's intake photos
  through `providersFromEnv`, refusing to start unless the verifier is live.
  The first two live jobs are `data/jobs/live-kurta-01` (REFUSE: the answer
  was cut off at 1500 tokens, `not_verified`) and `data/jobs/live-kurta-01-2`
  (REVIEW: all nine findings `match`, fidelity unmeasured because no mask
  exists), recorded as `demo/recordings/live-kurta-01-2`.
- A job: the photos are decoded, each goes through intake (metadata stripped,
  both hashes kept; a file that is not a JPEG ends the job before the pipeline,
  with no receipt), the stripped bytes are written to
  `<jobs>/<id>/sources/<name>` so `demo:record` (§7) can record the job later,
  then `runJob` runs with the one scene `studio` and writes
  `<jobs>/<id>/receipt.jsonl` and the render images. The jobs root defaults to
  `data/jobs`, the folder `npm run shop` reads, so prior records (§3) are the
  real ones.
- Progress: the server wraps each provider and keeps a step board, `exif`,
  `segment`, `render`, `verify`, `gate`, each `pending`, `running`, `done`,
  `failed` or `skipped` with one line of detail. A step is `done` only after
  the provider returned, so what the page shows is what ran. A provider that
  throws marks its step `failed` and the error goes on to the pipeline, which
  records it as §3 says (segment_failed, render_failed, not_verified); the
  steps the pipeline then never reached are `skipped`, and `gate` is `done`
  with the decision.
- The result: `decision`, `render_id`, `image_sha256`, the image and receipt
  URLs, the chain `head`, `provenance`, the gate's `reasons` in words (read
  back from the receipt's gate entry; empty on RELEASE) and a
  `verify.html#sha=<hex>` link. The card shows the image (with the tag "your
  own photo, stands in for the render" when the render label is the stand-in),
  the RELEASE / REVIEW / REFUSE badge, the reasons, "View receipt" (the verify
  link) and a receipt download. **Publish to shop** is painted in one place,
  only when `decision === "RELEASE"`, and the server refuses a publish of
  anything else with 409. A publish is a shop build (§11) of the jobs root into
  `web/shop`, so the job is listed only if its receipt verifies and the image
  hashes as released; the page then links to the new card.
- `web/upload.html` is one file: plain HTML, CSS and JavaScript, no framework,
  CSP `default-src 'none'; connect-src 'self'; img-src 'self' blob:` plus
  inline script and style; it fetches only its own origin. The language toggle
  switches every string between English and Hindi (Devanagari) and remembers
  the choice in `localStorage`; nothing else is stored.
