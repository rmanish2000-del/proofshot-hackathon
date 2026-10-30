# SPEC — attributes, gate rules, receipt format

Version 0.1.0. This document is the authority; `src/` is the reference
implementation of it. Where they disagree, that is a bug in the code.

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

**hard** — getting it wrong ships a false product claim to a buyer.
**soft** — getting it wrong is a cosmetic disappointment, still not shippable
unattended.

The floor is the confidence below which a *match* is not trusted either. A
low-confidence match is a `REVIEW`, never a `RELEASE`.

## 2. The gate

Input: `DecisionInput[]` — `attribute`, `verdict`, `confidence`. No other field
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

Fail-closed properties, each with a test in `test/gate.test.ts`:

- a missing attribute is not a pass
- an unknown attribute is not a pass
- `NaN` confidence is treated as 0, not as certainty
- a persuasive `note` cannot change a decision

## 3. The receipt

One JSON object per line, append-only, `receipt.jsonl`.

```json
{ "seq": 0, "at": "2026-10-26T09:00:00.000Z", "kind": "job",
  "payload": { }, "prev": "000…0", "hash": "…" }
```

`hash = sha256(canonicalJson({ seq, at, kind, payload, prev }))`

- `canonicalJson` sorts object keys recursively and rejects non-finite numbers,
  so the same content always hashes to the same value.
- `prev` is the previous entry's `hash`; entry 0 points at 64 zeros (`GENESIS`).
- `seq` is the entry index, checked on verification.

Entry kinds, in the order a job writes them:

| Kind | Carries |
|---|---|
| `job` | job id, garment note, provenance (`live`/`fixture`), source image hashes, scenes |
| `segments` | SAM segments: label, box, score, mask hash |
| `render` | render id, image hash, model id, prompt |
| `verifier` | render id + the raw findings array |
| `gate` | decision, cited reason, all reasons |
| `release` | only for `RELEASE`: image hash, approver, whether a human approved |

Verification (`verifyChain`) checks: non-empty, sequential `seq`, `prev` linkage,
and hash recomputation. It reports the first broken index.

**Added after review (26 Oct):** a job also records `garment_id` (the hash of its
source photos) and `prior_records` — every earlier job on that garment, with
refusal counts. A re-run appends a record; it does not clear the chain.

**Threat model.** Detectable: editing a payload, reordering, deleting a line,
forging an entry without rewriting every later hash. Not prevented: rewriting the
entire file from genesis, because the file has no signature, no append-only
storage guarantee, and no external witness. Do not describe this record as
"signed" or "non-repudiable" — it is neither.

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
missing attribute string, an unknown verdict, or a non-numeric confidence throws
`VerifierProtocolError`, and a thrown verifier is a refusal — never a pass.

## 5. What this format deliberately cannot express

Named here rather than approximated, because a rule that silently compiles to
nothing reads as protection the brand does not have:

- **Fit and drape.** Needs a body model and physics; the render can be honest
  pixel-for-pixel and still misrepresent how the garment falls.
- **Fabric feel.** Weight, stretch, itch. Not visible.
- **True colour under another light.** The render is judged against the source
  photo, not against the physical garment under the buyer's bulb.
- **"Good enough for Instagram."** A judgement about a brand's tolerance, not a
  fact about an image — the human queue is where that lives.
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
