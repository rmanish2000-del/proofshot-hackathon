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
  stay on record as refusals; they are two of the 4 not_verified false
  refusals under Calibration.
- With only four garments so far, calibration is a self-check rather than a
  true error rate.

Checked against:
- No findings, refused: `data/jobs/live-kurta-01` (gate REFUSE not_verified).
- No stored mask: `data/jobs/live-kurta-01-mismatch` has no segment with mask
  bytes; the judge view line is from a13273f.
- Copy audit and fix: 86cffe1, 3f891ec (`data/copy`: <!--f:copy_texts-->168<!--/f--> texts,
  <!--f:copy_model-->164<!--/f--> by the model, <!--f:copy_template-->4<!--/f--> template, from `evidence/pack/summary.json`). These
  are final copy texts, not model calls; the Fireworks call count under Built
  with is higher because retries and rewrites are logged too.
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
effect (two of them, `live-shirt-plaid-composite-v2` and `-r2`, are the two
failed runs under Challenges; the other two are `live-kurta-01` and
`live-kurta-01-composite`, whose verifier answered with output that was not
JSON); <!--f:cal_unmeasured-->6<!--/f--> renders are unmeasured. The 37 includes those 6 unmeasured
renders; the <!--f:cal_skipped-->6<!--/f--> fixture renders are not in the 37: they are skipped because
their fidelity values were written, not measured. No threshold changed: the
0.5x to 2x factor sweep only reports, and the configured thresholds in
`config/fidelity.json` were not edited after it. Four garments and many
repeated images: this is not a calibrated error rate.

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
| SAM 3.1 | Meta Model API, `api.meta.ai` | Garment segmentation for the composite and the fidelity masks | <!--f:sam_calls-->130<!--/f--> |
| Muse Spark 1.3 | Meta Model API, `api.meta.ai` | Verifier only: per-attribute findings the gate reads | <!--f:muse13_calls-->226<!--/f--> |
| muse-spark-open | Fireworks | English and Hindi listing copy and receipt summaries | <!--f:fireworks_calls-->293<!--/f--> |
| Muse Spark Open | Baseten | The first verifier (27 to 28 Oct) | <!--f:baseten_calls-->19<!--/f--> |

Candidate images come from a composite v2 renderer (the seller's own garment
pixels on a ghost mannequin, deterministic code, no image model) or an AI
try-on (Pruna on Replicate). No Meta image generator is used; Muse Image is
refused at runtime. The Muse Spark cross-check (MS4) ran <!--f:ms4_runs-->204<!--/f--> checks over <!--f:ms4_pairs-->68<!--/f-->
(garment, image) pairs: <!--f:ms4_wrong_refused-->153 of 153<!--/f--> wrong-garment runs refused, <!--f:ms4_same_released-->24 of 30<!--/f-->
same-garment runs released, <!--f:ms4_consistent-->65 of 68<!--/f--> pairs gave the same decision three times.
The other 21 of the 204 are the shortened try-on checks (7 try-on images
against their own garment, 3 runs each, `changed` in
`evidence/ms4-summary.json`): Muse Spark alone passed <!--f:ms4_changed_passed-->4 of 21<!--/f-->, and the
fidelity check is what held all 7 try-ons in the gate. All 204 runs were
answered; none is a not_verified run.

Spend from the ledgers: Meta Model API 5.99 USD of the 80 USD cap, Fireworks
4.83 USD of 60, Replicate 0.105 USD, Baseten 0 on its ledger; no reserve used.
The pack's Meta estimates (SAM 3.1 0.33 + Muse Spark 1.3 5.83, about 6.16 USD
in `evidence/pack/README.md`) are computed differently: they price every
committed call log, while 5.99 is the ledger as read on 29 Oct, which starts at
dd7d280 and so leaves out the 51 SAM calls logged before it (0.13 USD) and the
9 calls logged after that reading (0.04 USD).
The Baseten 0 is not a charge of zero: the spend ledgers were added on 29 Oct
at 10:53 IST (dd7d280), and every one of the 19 Baseten calls is logged
earlier (`evidence/verifier-*.json`, 28 Oct 09:25 IST to 29 Oct 06:13 IST), so none has a ledger entry. Their token
estimate is 0.30 USD (`evidence/pack/README.md`); Baseten's own bill was not
read, so the amount actually charged is UNVERIFIED.

Checked against: README "What each Meta model does" and "Limits",
`evidence/pack/summary.json` (call counts), `evidence/ms4-summary.json`,
`package.json`, `npm run ledger` on 29 Oct after d0499ca.

## Demo script (76 s)

Seven beats, nine shots, 76 s, in `docs/DEMO.md` (v6), showing the two shirts
only (plaid and zebra): the seller's phone photos of a plaid shirt; a pipeline
smoke example (`ms2-shirt-plaid`, the owner's own photo as the candidate,
RELEASE: it shows the pipeline runs, not accuracy); REVIEW for a composite
whose brand label is below its confidence floor
(`live-shirt-plaid-composite-v2-r3`); REFUSE for the wrong garment, the zebra
shirt against the plaid shirt's photos (`live-shirt-plaid-mismatch`); then one
byte of the receipt changed and the verify page says TAMPERED. Framed for
"Build for Your World". The video has no try-on beat: every committed try-on
is of a kurta, and there is no shirt try-on. The try-on results (all held by
the gate, none released) are under Problem above and in the README.

Checked against `docs/DEMO.md` and `test/demo-capture.test.ts` (word caps,
timecodes summing to 76 s, every job committed, no kurta job in any shot,
every committed try-on a kurta job).

## Built during the event and prior work

Work in this repository starts with its first commit, [`4aa99f9`](https://github.com/rmanish2000-del/proofshot-hackathon/commit/4aa99f9ab9989dcc4705a0980f8660c0c9263f95), on
27 Oct 2026 at 11:10 IST, after the hackathon opened on 26 Oct 2026 at 21:30
IST. Every commit in this repository was made during the event. The code was
written here from the specification; no product code from before the event
was copied in. The written specification and the config boilerplate were
carried over, as listed under Prior work used below.

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

## Questions a judge may ask

- *What is the first commit, and is pre-event code in it?* `4aa99f9`, 27 Oct
  2026 at 11:10 IST, after the 26 Oct 21:30 IST opening (`git log --reverse`).
  No product code from before the event is in it or in any later commit: the
  gate, receipt chain, verify page, provider code, demo and evidence were all
  written here.
- *What was carried over?* Only `docs/SPEC.md` (the written specification,
  with event changes marked *(event)*) and the config boilerplate
  (`tsconfig.json`, `.gitignore`), as listed under Prior work used.
- *Is any pre-existing service called?* No. The demo and every receipt use
  only this repository's code and the hosted models named under Built with
  (the `provider` field of each receipt in `data/jobs`); no pre-existing
  ProofShot service exists or is called.
- *Why does the demo show no AI on-model image?* All <!--f:tryon_total-->7<!--/f--> committed try-on
  receipts are kurta jobs, and the gate held every one (<!--f:tryon_refuse-->5<!--/f--> REFUSE,
  <!--f:tryon_review-->2<!--/f--> REVIEW, `data/jobs/live-kurta-0*-tryon*`); the demo shows the two
  shirts only, no shirt try-on exists, and no new paid call was made for the
  video (`docs/DEMO.md`, `test/demo-capture.test.ts`).

## What's next

These are plans, not results:
- Photograph more garments from real sellers, so a rate means more than four
  garments allow.
- Shoot the tricky photos from the seller-pain list (dim room, busy background,
  folded garment and others) and run them through the same gate.
- Check the verify page opened straight from disk in a normal browser window
  (so far from disk only in headless Edge, by the demo capture; and over local
  HTTP in Chromium).
- Get Manish's visual sign-off on composite v2 images before any is shown as a
  product shot.

Checked against: README "Limits" and "What is verified and what is not";
Grok's SP1 list on #23 (six of its twelve cases need a real phone photo).
