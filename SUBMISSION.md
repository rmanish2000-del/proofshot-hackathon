# ProofShot: Devpost submission fields

**Track:** Indie Developer. **Team:** solo, Manish Patel.

Every field below is written from committed evidence in this repository
(receipts in `data/jobs`, call logs and reports in `evidence/`, the README).
The source is named under each section. Updated 29 Oct 2026 from the Codex
review, on master after d0499ca. Earlier Challenges and Calibration drafts were
reviewed by Grok on #23 (proofshot coordination); the figures in them are
refreshed here to the current receipts.

## Problem

An Indian boutique seller lists garments online from their own phone photos.
Any image that goes on the listing, whether a cleaned-up product shot or an AI
try-on, can quietly change the garment: its colour, its print, its length. A
buyer then gets something other than what the photo showed.

In our live try-on calls, long kurtas came back hip-length, and the gate caught
every one: <!--f:tryon_total-->7<!--/f--> of <!--f:tryon_total-->7<!--/f--> try-on images were held (<!--f:tryon_refuse-->5<!--/f--> REFUSE, <!--f:tryon_review-->2<!--/f--> REVIEW), none released.
ProofShot checks each candidate image against the seller's own photos before it
can be listed, and a deterministic gate, not a model, decides.

Checked against:
- Try-on results: the 7 receipts with a `replicate-pruna-tryon` render entry in
  `data/jobs/live-kurta-0*-tryon*` (<!--f:tryon_refuse-->5<!--/f--> REFUSE, <!--f:tryon_review-->2<!--/f--> REVIEW, <!--f:tryon_release-->0<!--/f--> RELEASE), and
  `data/calibration/labels.json` (the 7 try-on renders, length changed).
- The gate: `src/gate.ts`, README "How the gate decides".
- No claim is made about returns or sales.

## Challenges we ran into

- Early live checks occasionally returned no findings; my gate treats that as
  not verified and refuses to release instead of passing it silently.
- One recording had no stored mask, so the fidelity check couldn't run. The
  job view now says that explicitly instead of showing a misleading REVIEW.
- Generated listing copy sometimes truncated or described the software rather
  than the garment, so I added a copy audit and fix pass.
- Partner credits run under hard per-provider caps, and the reserve only opens
  with an explicit opt-in.
- A verifier call with large photos failed before any answer came back, a
  suspected network failure. It is now retried once, and the two failed runs
  stay on record as refusals.
- With only four garments so far, calibration is a self-check rather than a
  true error rate.

Checked against:
- No findings, refused: `data/jobs/live-kurta-01` (gate REFUSE not_verified).
- No stored mask: `data/jobs/live-kurta-01-mismatch` has no segment with mask
  bytes; the judge view line is from a13273f.
- Copy audit and fix: 86cffe1, 3f891ec (`data/copy`: <!--f:copy_texts-->168<!--/f--> texts,
  <!--f:copy_model-->164<!--/f--> by the model, <!--f:copy_template-->4<!--/f--> template, from `evidence/pack/summary.json`).
- Caps and reserve: README spend section (Fireworks 60 USD batch + 40 reserve,
  Meta Model API 80 USD batch + 70 reserve).
- Network retry: `live-shirt-plaid-composite-v2` and `-r2` (REFUSE
  not_verified, "fetch failed"), the retry in fa4f126 (test MS2 7).
- Four garments: `data/garments` has kurta-01, kurta-02, shirt-plaid and
  shirt-zebra with photos.

## Calibration

`npm run calibrate:jobs` re-judges <!--f:cal_cases-->37<!--/f--> labelled renders from committed receipts
(<!--f:cal_same-->18<!--/f--> same garment, <!--f:cal_different-->19<!--/f--> different) at threshold factors 0.5x to 2x. At 1x it
reproduces the recorded gate decision on <!--f:cal_reproduced-->37 of 37<!--/f-->. The gate reports <!--f:cal_false_match-->0<!--/f--> false
matches at 1x (0 at every factor in the report). At 1x there are <!--f:cal_false_refuse-->4<!--/f--> false refusals, all of them renders
where the verifier gave no answer (not_verified), so they are not a threshold
effect; <!--f:cal_unmeasured-->6<!--/f--> renders are unmeasured. <!--f:cal_skipped-->6<!--/f--> fixture renders are skipped because
their fidelity values were written, not measured. No threshold changed. Four
garments and many repeated images: this is not a calibrated error rate.

Checked against `evidence/calibration-jobs-2026-10-29.json` (gate table: same
18, different 19, false_match 0 at every factor, false_refuse 10, 5, 4, 4, 4
at x0.5 to x2) and the run on d0499ca, which printed "x1 against the gate
decision each receipt recorded: 37 of 37 the same".

## Built with / How we built it

ProofShot is TypeScript on Node 22 (`node:test`, no framework; dependencies
`@meta-sam/parser` and `jpeg-js`). The pipeline for one candidate image is:
segment the seller's photos, make or take the candidate, verify it against the
photos, measure fidelity, and let a deterministic gate decide. Each step is
appended to a SHA-256 hash-chained receipt, and `web/verify.html` re-checks the
chain in the browser with WebCrypto.

| Model | Served by | Role | Logged calls |
|---|---|---|---|
| SAM 3.1 | Meta Model API, `api.meta.ai` | Garment segmentation for the composite and the fidelity masks | <!--f:sam_calls-->122<!--/f--> |
| Muse Spark 1.3 | Meta Model API, `api.meta.ai` | Verifier only: per-attribute findings the gate reads | <!--f:muse13_calls-->225<!--/f--> |
| muse-spark-open | Fireworks | English and Hindi listing copy and receipt summaries | <!--f:fireworks_calls-->291<!--/f--> |
| Muse Spark Open | Baseten | The first verifier (27 to 28 Oct) | <!--f:baseten_calls-->19<!--/f--> |

Candidate images come from a composite v2 renderer (the seller's own garment
pixels on a ghost mannequin, deterministic code, no image model) or an AI
try-on (Pruna on Replicate). No Meta image generator is used; Muse Image is
refused at runtime. The Muse Spark cross-check (MS4) ran <!--f:ms4_runs-->204<!--/f--> checks over <!--f:ms4_pairs-->68<!--/f-->
(garment, image) pairs: <!--f:ms4_wrong_refused-->153 of 153<!--/f--> wrong-garment runs refused, <!--f:ms4_same_released-->24 of 30<!--/f-->
same-garment runs released, <!--f:ms4_consistent-->65 of 68<!--/f--> pairs gave the same decision three times.

Spend from the ledgers: Meta Model API 5.99 USD of the 80 USD cap, Fireworks
4.83 USD of 60, Replicate 0.105 USD, Baseten 0 on its ledger; no reserve used.

Checked against: README "What each Meta model does" and "Limits",
`evidence/pack/summary.json` (call counts), `evidence/ms4-summary.json`,
`package.json`, `npm run ledger` on 29 Oct after d0499ca.

## Demo script (90 s)

Eight beats, ten shots, 90 s, in `docs/DEMO.md` (v5): the seller's phone
photos of a plaid shirt; a pipeline smoke example (`ms2-shirt-plaid`, the
owner's own photo as the candidate, RELEASE: it shows the pipeline runs, not
accuracy); then the real proof, one committed AI try-on that shortened a long
kurta (`live-kurta-01-tryon-m`): the verifier matched every attribute, and the
measured fidelity check held it (REVIEW, the garment shrank in frame); REVIEW
for a composite whose brand label is below its confidence floor
(`live-shirt-plaid-composite-v2-r3`); REFUSE for the wrong garment
(`live-shirt-plaid-mismatch`); then one byte of the receipt changed and the
verify page says TAMPERED. The try-on image shows a synthetic person, so the
video shows its receipt, not the image. Framed for "Build for Your World".

Checked against `docs/DEMO.md` and `test/demo-capture.test.ts` (word caps,
timecodes summing to 90 s, every job committed, the try-on job held on
fidelity with 9 of 9 verifier matches).

## Built during the event and prior work

Work in this repository starts with its first commit, [`4aa99f9`](https://github.com/rmanish2000-del/proofshot-hackathon/commit/4aa99f9ab9989dcc4705a0980f8660c0c9263f95), on
27 Oct 2026 at 11:10 IST, after the hackathon opened on 26 Oct 2026 at 21:30
IST. Every commit in this repository was made during the event. The code was
written here from the specification; no code from before the event was copied
in.

**Prior work used:**

- `docs/SPEC.md`: the written specification of ProofShot's attributes, gate
  rules and receipt format, first written on 24 Oct 2026, before the event, and
  carried over. The code here is rewritten from it, and every change made to it
  during the event is marked *(event)*.
- Config boilerplate (`tsconfig.json`, `.gitignore`) mirrors the earlier
  private repository.

Nothing else from before the event is used. No pre-existing ProofShot service
is called: the demo and every committed receipt use only the code in this
repository and the providers named under Built with (SAM 3.1 and Muse Spark 1.3 on
`api.meta.ai`, Muse Spark Open on Baseten, muse-spark-open on Fireworks, Pruna
on Replicate).

Checked against: `git log --reverse` (first commit and the dates of all
commits), the `provider` fields of every receipt in `data/jobs`, and every
endpoint URL in `src/` and `scripts/`.

## What's next

These are plans, not results:
- Photograph more garments from real sellers, so a rate means more than four
  garments allow.
- Shoot the tricky photos from the seller-pain list (dim room, busy background,
  folded garment and others) and run them through the same gate.
- Check the verify page opened straight from disk in a browser (so far it is
  checked over local HTTP).
- Get Manish's visual sign-off on composite v2 images before any is shown as a
  product shot.

Checked against: README "Limits" and "What is verified and what is not";
Grok's SP1 list on #23 (six of its twelve cases need a real phone photo).
