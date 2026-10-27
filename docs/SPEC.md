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
entry per render (`src/pipeline.ts`), and the image check of §9 (`src/check.ts`, not yet the
page). §7–§8 describe pre-existing features not yet rebuilt here.

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
| `segments` | `count`, `segments` (`[{label, box, score, mask_sha256 \| null}]`) |
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

## 7. Replay and record (not yet rebuilt here)

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

## 8. Render providers and the Muse Image refusal (not yet rebuilt here)

`RENDER_PROVIDER` picks the renderer: `openai-images` (default), `fal`, or
`meta`. Muse Image is not available in India (Meta Geographic Use Policy §2.2),
so any model id matching `/muse[\s._\/-]*image/i` is refused before a request
leaves, on every provider. `meta` with an empty `MODEL_RENDER` throws before any
request. The receipt names the provider and model of every render (§3).

## 9. The verify page's image check (check rebuilt, page not yet)

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
  an input (§2). The pipeline calls an injected checker; a checker that decodes
  the SAM mask PNGs and calls `checkFidelity` is not wired in yet.
