# Evidence-checking agent: plan (round 5, written before the code)

**Rule.** The deterministic gate (`src/gate.ts` `decide()`, called only inside `src/pipeline.ts` `runJob`) alone
decides RELEASE / REVIEW / REFUSE. The agent can only read a receipt, check photos locally, find a missing
photo view, ask the seller for it, and re-run the same pipeline and gate through one injected `rerun_gate`
function. It never sets or argues a verdict, changes a threshold, publishes, or edits or generates an image.

**What the receipt gives the agent** (`receipt.jsonl`, SPEC §3): every `gate` entry has `decision`, `cited`
`{attribute, verdict, confidence, rule, reason}` and all `reasons`; `fidelity` has `decision`, `metrics` (null when
unmeasured) and `reasons`; `job` lists the source photos. That is enough to drive recovery. The receipt kinds are
not changed: the agent section is a separate hash-chained `agent.jsonl` beside the gate receipt, so the gate
receipt is byte-identical with or without the agent.

**Reason codes and what they mean for recovery** (46 committed decisions in `data/jobs`, surveyed 30 Oct):

| Code | Seen | Class | Recovery |
|---|---|---|---|
| RELEASE | 15 | done | none (publish still needs the seller's approval) |
| `hard_mismatch`, `duplicate_attribute`, `unknown_attribute` | 4 | real violation | **none**; explain only |
| `fidelity` with measured metrics (REFUSE or REVIEW) | 8 + 2 | real violation (the garment changed: e.g. "area 0.301 below 0.400: the garment shrank in frame") | **none** |
| `soft_mismatch` (at or above the floor) | 4 | real violation (verifier saw it) | **none** |
| `fidelity` unmeasured ("source mask is missing", "not a PNG") | 3 | missing evidence | ask for a clear full-length front photo on a plain background; a re-run needs a segmenter call (paid, approval) |
| `low_confidence`, `uncertain` on an attribute | 1 (`logo_text` 0.80 < 0.85) | missing evidence | ask for the view that shows that attribute (label close-up here); re-run needs a verifier call (paid, approval) |
| `render_quality` ("over- or under-exposed photo") | 1 | missing evidence (photo quality) | local quality check, ask for a re-shot photo |
| `not_verified`, `verifier_truncated` | 6 | missing evidence (no verifier answer) | re-run needs a verifier call (paid, approval); no new photo asked for |
| `render_failed`, `segment_failed`, `prior_records_unreadable` | 0 | step failure | explain only |

Attribute → view needed: `sleeve_length`, `hem`, `buttons`, `pocket_count`, `color` → full-length front;
`collar` → collar close-up; `logo_text` → label close-up; `print_pattern`, `fabric_texture` → print close-up.

**Known verifier misses on length.** `evidence/ms4-summary.json`, `changed` pairs: the verifier alone passed 4 of
21 checks of try-ons that shortened the garment (`kurta-01~291a0026c18e` RELEASE three times; `kurta-02~bd26aab8f680`
once). In the pipeline the measured fidelity check flagged both (`live-kurta-01-tryon-m`: REVIEW, area 0.301). The
agent must not touch these: they are real violations, and the gate already holds them.

**Existing photo checks.** Intake (`src/intake.ts`): JPEG only, metadata stripped, both hashes kept. Composite v2
pre-check (`render_quality`): exposure and correction limits. Built since: the agent's local `check_photo_quality`
(`src/agent/quality.ts`, called from `src/agent/policy.ts` and `src/agent/runner.ts`) measures resolution (short
side), exposure (mean luma, too dark / too bright) and blur (variance of a 3x3 Laplacian); its thresholds are starting
values set on the committed garment photos, not calibrated. Still plan: crop, which needs a garment mask; the check
reports it as "not checked (no garment mask)".

**Live calls and cost.** Verifier (Muse Spark 1.3) and SAM calls go through the metered fetch and spend ledgers
(`src/spend-meta.ts`, per-account caps). The agent defaults to offline; any re-run that would call a model needs
the seller's approval first, shown with an estimated cost, and is counted against per-job and per-seller caps.

**Keyless demo.** No committed case can be resolved without a new photo and a live call, so the keyless demo uses
a labelled canned verifier (fixture provenance, "no model judged the image") to show the mechanics: length
attributes come back uncertain when no full-length view is supplied → REVIEW → agent asks for it → the seller adds
it → same gate → result. The eval reports real numbers on the committed receipts only.

**Conclusion of step 0:** the receipt can drive recovery; no blocker.
