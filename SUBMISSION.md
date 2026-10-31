# ProofShot: submission fields

**Track:** Indie Developer. **Team:** solo, Manish Patel.

Every field below is written from committed evidence in this repository
(receipts in `data/jobs`, call logs and reports in `evidence/`, the README).
The source is named under each section. Updated 29 Oct 2026 from the Codex
review, on master after 7de2c9c. Earlier Challenges and Calibration drafts were
reviewed by Grok on #23 (proofshot coordination); the figures in them are
refreshed here to the current receipts.

## Form answers (paste-ready)

For the Cerebral Valley submit form. Paste from the rendered page (the numbers are kept current by
`npm run figures`). Every answer is from this repository; the evidence for each one is in the sections below
and in README.md. Anything not in the repository is **TBD**.

**Project name:** ProofShot

**Tagline:** An evidence-checking agent for seller listing images: it decides the next action (segment, render, verify, request missing evidence from the seller, or refuse), a deterministic gate decides RELEASE, REVIEW or REFUSE, and every decision gets a hash-chained receipt.

**Short description:** ProofShot is an evidence-checking agent for a seller's listing image. Before the image goes on sale, it decides the next action: segment the seller's phone photos, render or take the candidate, verify it, request missing evidence from the seller, or refuse. SAM 3.1 segments the garment, Muse Spark 1.3 on the Meta Model API checks nine attributes, a fidelity check measures the masked regions, and a deterministic code gate (not a model) decides RELEASE, REVIEW or REFUSE. Every step goes into a SHA-256 hash-chained receipt that a single web page verifies in the browser with no server.

**Long description:**

An Indian boutique seller lists garments online from their own phone photos. Any image that goes on the listing, a cleaned-up product shot or an AI try-on, can quietly change the garment: its colour, its print, its length. The buyer then gets something other than what was photographed.

ProofShot is an evidence-checking agent for those images, with a release gate at the end. For one candidate image it segments the seller's photos with SAM 3.1, takes or makes the candidate (the seller's own photo, a composite v2 that places the seller's own garment pixels on a ghost mannequin with no image model, or an AI try-on from Pruna on Replicate), verifies it against the photos with Muse Spark 1.3 on the Meta Model API (nine attributes: color, print_pattern, collar, sleeve_length, hem, pocket_count, buttons, logo_text, fabric_texture), measures fidelity on the SAM 3.1 masks, and lets a deterministic code gate decide RELEASE, REVIEW or REFUSE. Any doubt ends in REVIEW or REFUSE, never RELEASE.

Every step from intake to the gate decision is written into a SHA-256 hash-chained receipt. `web/verify.html` re-checks the chain in the browser with WebCrypto and makes no network request: give it a receipt and an image and it says VALID, NOT RELEASED or TAMPERED. Change one byte of the receipt and it says TAMPERED, with the entry number.

What the evidence shows, with its limits: <!--f:jobs-->42<!--/f--> jobs and <!--f:renders-->43<!--/f--> renders are committed with receipts, and <!--f:chains-->42 of 42<!--/f--> hash chains verify. In calibration the gate reproduced <!--f:cal_reproduced-->37 of 37<!--/f--> recorded decisions with <!--f:cal_false_match-->0<!--/f--> false matches. In a Muse Spark cross-check, <!--f:ms4_wrong_refused-->153 of 153<!--/f--> wrong-garment runs were refused. All <!--f:tryon_all_total-->12<!--/f--> committed AI try-on images were held by the gate (<!--f:tryon_all_refuse-->10<!--/f--> REFUSE, <!--f:tryon_all_review-->2<!--/f--> REVIEW, none released): the <!--f:tryon_total-->7<!--/f--> kurta try-ons of 28–29 Oct (<!--f:tryon_refuse-->5<!--/f--> REFUSE, <!--f:tryon_review-->2<!--/f--> REVIEW) and the <!--f:tryon_run31_total-->5<!--/f--> of the 31 Oct try-on run (<!--f:tryon_run31_refuse-->5<!--/f--> REFUSE). For the 28–29 Oct kurta try-ons, the verifier alone passed <!--f:ms4_changed_passed-->4 of 21<!--/f--> shortened try-on checks, and the fidelity check returned REVIEW or REFUSE on every one (the gate cited fidelity for 4 of them and the verifier for 3: two timeouts and one soft mismatch). That is <!--f:garments-->4<!--/f--> garments, all the owner's own, so it is not a general accuracy claim.

English and Hindi listing copy is written after the gate, from the receipt, by muse-spark-open on Fireworks.

**Track and team:** Indie Developer track. Solo: Manish Patel.

**Theme:** Build for Your World (Indian boutique sellers' listing images).

**Meta models used (logged calls):**

| Model | Served by | Role | Logged calls |
|---|---|---|---|
| SAM 3.1 (`meta/sam-3.1`) | Meta Model API, `api.meta.ai` | Garment segmentation: masks for the composite and the fidelity check | <!--f:sam_calls-->130<!--/f--> |
| Muse Spark 1.3 (`muse-spark-1.3`) | Meta Model API, `api.meta.ai` | Verifier: per-attribute findings the gate reads | <!--f:muse13_calls-->226<!--/f--> |
| Muse Spark Open (`meta-models/muse-spark-open-1026`) | Baseten | The first verifier. Built with Muse Spark Open | <!--f:baseten_calls-->19<!--/f--> |
| muse-spark-open (`accounts/fireworks/models/muse-spark-open`) | Fireworks | English and Hindi listing copy, written after the gate | <!--f:fireworks_calls-->293<!--/f--> |

The decision is made by plain code, not a model. No Meta image generator is used; Muse Image is refused at runtime. AI try-on candidates came from Pruna on Replicate (<!--f:pruna_all_calls-->12<!--/f--> calls, all held by the gate); that is not a Meta model.

**Built during the hackathon:** The hackathon opened on 26 Oct 2026 at 21:30 IST. This repository's first commit is `15658a4`, on 27 Oct 2026 at 11:10 IST, and `git log` has no commit dated before it. (History was re-authored on 30 Oct 2026 to remove a personal email address; dates unchanged, so commit hashes differ from earlier copies of these documents: the first commit was 4aa99f9.) Everything in the demo (the gate, the receipt chain, the verify page, the pipeline, the upload and judge pages) is code in this repository from that commit on. Prior work: the written specification and config boilerplate only; the specification's pre-event text and its 27 Oct update are published unchanged in `docs/prior-work/`, and changes made during the event are marked *(event)* in `docs/SPEC.md`.

**Repository:** https://github.com/rmanish2000-del/proofshot-hackathon

**Licence:** MIT (`LICENSE`).

**Demo video:** YOUTUBE_URL_TBD

**Still TBD:** the video link; whether the narration is the TTS voice or Manish's own; any form field not listed here (for example a thumbnail or social links).

Sources: README.md (intro, "What each Meta model does", "What is verified and what is not", "Built during the event"),
the sections below (Inspiration, What it does, Problem, Calibration, Built with, Built during the event and prior
work), `docs/DEMO.md`, `docs/prior-work/README.md`, `LICENSE`.

## Metrics (measured, with their limits)

Every number here is from a committed test, run log or report, named in the last column; numbers with a
figure marker are kept current by `npm run figures`. Anything not measured says so.

| What | Result | Source |
|---|---|---|
| Automated tests | <!--f:tests-->386<!--/f--> tests, all passing (CI runs them and gitleaks on every push) | `npm test`, `.github/workflows/ci.yml` |
| Committed jobs with receipts | <!--f:jobs-->42<!--/f--> jobs, <!--f:renders-->43<!--/f--> renders; <!--f:chains-->42 of 42<!--/f--> hash chains verify | `evidence/pack/summary.json` |
| Calibration: recorded gate decisions reproduced at 1x | <!--f:cal_reproduced-->37 of 37<!--/f--> | `evidence/calibration-jobs-2026-10-29.json` |
| Calibration: false matches | <!--f:cal_false_match-->0<!--/f--> at every threshold factor (0.5x to 2x) | same |
| Calibration: false refusals at 1x | <!--f:cal_false_refuse-->4<!--/f-->, all verifier failures (2 failed calls, 2 non-JSON answers), not a threshold effect | same; Calibration below |
| Muse Spark cross-check: wrong-garment runs refused | <!--f:ms4_wrong_refused-->153 of 153<!--/f--> | `evidence/ms4-summary.json` |
| Muse Spark cross-check: same-garment runs released | <!--f:ms4_same_released-->24 of 30<!--/f--> | same |
| Muse Spark cross-check: same decision on all 3 runs | <!--f:ms4_consistent-->65 of 68<!--/f--> pairs | same |
| AI try-ons held by the gate | <!--f:tryon_all_total-->12<!--/f--> of <!--f:tryon_all_total-->12<!--/f--> committed (<!--f:tryon_all_refuse-->10<!--/f--> REFUSE, <!--f:tryon_all_review-->2<!--/f--> REVIEW): <!--f:tryon_total-->7<!--/f--> kurta try-ons 28–29 Oct, <!--f:tryon_run31_total-->5<!--/f--> in the 31 Oct run; on the 28–29 Oct set the verifier alone passed <!--f:ms4_changed_passed-->4 of 21<!--/f--> shortened try-on checks | `data/jobs/live-kurta-0*-tryon*`, `evidence/tryon/SUMMARY.md`, `evidence/ms4-summary.json` |
| Latency per call, median / p90 (answered calls) | SAM 3.1: 2.9 s / 4.4 s; Muse Spark 1.3: 19.1 s / 32.8 s; Muse Spark Open on Baseten: 26.2 s / 169.5 s; muse-spark-open copy on Fireworks: 30.8 s / 110.5 s | `evidence/pack/README.md` (committed call logs, across days and payload sizes; not a controlled benchmark) |
| Fixture-mode job, no key (upload to RELEASE) | about 1 s for three photos on one Windows laptop | `out/final/JUDGE_RUN.md` run 2 (one run) |
| Judge setup on a clean clone | clone + `npm ci` 76 s; `npm test` 316 s to 423 s on the same laptop | `out/final/JUDGE_RUN.md` |
| Spend | Meta Model API 5.99 USD, Fireworks 4.83 USD, Replicate 0.105 USD: ledger figures read on 29 Oct, each a per-call token estimate, not a bill; all <!--f:pruna_all_calls-->12<!--/f--> committed Pruna calls, incl. the 31 Oct run: <!--f:pruna_all_usd_est-->0.180<!--/f--> USD estimated on the receipts | Built with, below |
| General verifier accuracy | **not measured** (4 garments, all the owner's own; the rates above are for these pairs only) | README "What is verified and what is not" |
| False-match rate on real sellers' listings | **not measured** | none |
| End-to-end latency of one live job | **not measured** as a single number (per-call medians only) | none |
| Throughput or cost per listing at scale | **not measured** | none |

## Evidence Recovery Agent: safety and security design

A bounded agent for one narrow job: when the gate says REVIEW or REFUSE because evidence is missing, it reads the
receipt, finds the missing photo view, asks the seller for it (fixed English and Hindi text), and re-runs the
same pipeline and gate. Code: `src/agent/`, `src/recovery-gate.ts`; plan: `docs/EVIDENCE_RECOVERY_PLAN.md`.

- **The gate alone decides.** The agent reaches the gate only through one injected `rerun_gate` function; no file
  in `src/agent/` imports the gate or the pipeline (a test checks this). For the same inputs the gate receipt is
  byte-identical with or without the agent (test).
- **Real violations are never recovered.** A mismatch the verifier saw or a measured fidelity breach ends in an
  explanation only (test; on the committed jobs, 20 of 20 violations were left alone). One exception, added
  31 Oct: when the fidelity check says REVIEW or REFUSE and the receipt shows the first photo (the one fidelity
  measures against) is cropped, angled or partial, the agent may ask the seller to replace photo 1 (below).
- **Allowlist and schemas in code.** Seven tools only (`read_receipt`, `check_photo_quality`, `detect_missing_view`,
  `request_seller_photo`, `request_replace_primary`, `rerun_gate`, `explain`); every proposed action, from the rule policy or a model, is
  validated before it runs: unknown tools, extra or missing arguments, another job's id, free text where the
  fixed seller text is required, or explaining a different outcome are rejected and logged.
- **Untrusted inputs.** Photos, filenames, EXIF and model output are data: intake applies the EXIF orientation, then drops Exif/XMP; filenames and
  model text cannot pick a tool or an argument outside the schema (tests with an instruction-like filename, an
  EXIF block and malicious model proposals: same tools, same verdict, nothing published).
- **Scoped files.** Every path is built from checked seller and job ids and must stay inside that job's folder.
- **Caps and approvals.** At most 4 agent steps per job, a tool-call cap per step, a step timeout, and per-job
  and per-seller caps on paid model calls and spend; a paid re-check needs the seller's approval first (with the
  estimate shown), and publishing needs the seller's approval and a RELEASE. Nothing auto-publishes.
- **Records.** Each job's agent section (`agent.jsonl`, hash-chained) holds every proposal, its validation,
  approvals (who, when), tool results, cost, latency and the final gate decision; no secrets (test).
- **Design guidance:** OWASP Top 10 for LLM Applications, LLM06 Excessive Agency (limit tools, permissions and
  autonomy). This is design guidance we followed, not a certification or an audit.

**Results, measured** (`evidence/agent-eval-2026-10-30.json`, `npm run agent:eval`): on the <!--f:jobs-->42<!--/f--> committed jobs
plus the fixture job (43 receipts), one offline agent step each, no seller action and no model call: 0 decisions
changed by the agent; 20 real violations left alone; 5 missing-evidence cases got a photo request (4 full-length
front, 1 label close-up); 4 verifier failures got a paid re-check proposal that waits for approval; **0 resolved**,
because resolving needs a new seller photo or an approved paid call, which the committed data does not have. On
length: the verifier alone passed <!--f:ms4_changed_passed-->4 of 21<!--/f--> shortened try-on checks; the gate held the <!--f:tryon_total-->7<!--/f--> of <!--f:tryon_total-->7<!--/f--> 28–29 Oct kurta try-ons in data/jobs (the 31 Oct run was not in this evaluation)
before the agent and after it, and the agent attempted no recovery on them (they are real violations). Agent
step latency on this laptop: p50 69 ms, p90 222 ms. On the committed jobs the agent proposes the next step;
whether those steps resolve real REVIEWs is measured only on the two real pairs below.

**Real seller photos, measured** (`evidence/agent-real-2026-10-30.json`, `npm run agent:real`, run once on
30 Oct): two garments photographed by Manish, a pink polo and a mustard kurta, each a deliberately bad photo
(the polo angled with a sleeve and the hem cut off; the kurta's plain back with a sleeve cut off) and a
full-length front, checked for people and personal data before intake. The gate ran live (SAM 3.1 and Muse
Spark 1.3 on api.meta.ai); the render is the seller's own full-length front photo (stand-in, nothing generated).
**Resolved by the agent: 0 of 2.** With only the bad photo, the gate said REFUSE on both from the masked
fidelity check (polo: texture 0.531 below 0.650; kurta: colour, histogram, texture and area all outside), so the
agent treated them as violations, as its rules say, and asked for no photo. As a control, the seller added the
full-length front unprompted and approved a second paid re-check: Muse Spark then matched every attribute on
both garments (it had already matched every attribute of the polo from the cropped photo alone), and the gate
still said REFUSE with the same fidelity numbers, because the fidelity check compares the render with the
listing's first photo only (`src/fidelity.ts`), and the bad photo was first. Seller steps per garment: list,
approve, add a photo, approve; no listing completed. Cost: 4 live gate runs, 0.106 USD on the Meta ledger
(0.03 USD per run was the estimate shown before approval). What this shows: on these two pairs the blocker was
not the request logic but a bad *first* photo, which no added photo can fix. At the time the agent could not
replace or reorder photos, and its seller text ("More photos will not change this") did not say what would.

**Replace the first photo, measured** (`evidence/agent-replace-2026-10-31.json`, `npm run agent:replace`, run once
on 31 Oct, cap 0.20 USD). A new allowlisted action, `request_replace_primary`: after a live run whose fidelity
check says REVIEW or REFUSE, the agent reads the same receipt for signs that photo 1 is the problem: the SAM mask
box of photo 1 touching the top or bottom edge (cropped), a verifier note matching fixed patterns that say the
source is cut off, angled, partial or the back only, or (added after the first run, below) a seller label on
photo 1 other than full-length front. No new model call is made for this. The seller gets a fixed
text naming the problem and asking for a full-length front as photo 1. The seller must approve and give the photo.
The old photo 1 leaves the listing, and the gate runs again from the start, offline first, then live after a
second approved paid re-check. At most 1 replacement per job, enforced in the validator and in the seller action.
The per-job step, cost and timeout limits are unchanged. The gate and `src/fidelity.ts` are unchanged. The
seller text for a mismatch or a fidelity breach now says what would change the outcome. Same photos, fresh jobs:

| Garment | Photo 1 | Agent asked to replace? | Live verdict before | Live verdict after |
|---|---|---|---|---|
| Pink polo | angled, hem cut off | yes: cropped (mask box at the bottom edge; the verifier notes did not say so) | REFUSE (texture 0.531 below 0.650) | **RELEASE** (recorded 31 Oct self-comparison; would be REVIEW today) |
| Mustard kurta, first run | the back, sleeve cut off | **no** | REFUSE (hem mismatch; fidelity delta_e 92.3, area 0.103) | not run |
| Mustard kurta, re-run with the label signal | the same | yes: partial view (photo 1 is labelled `full_length_back`) | REFUSE (the same hem mismatch and fidelity numbers) | **RELEASE** (recorded 31 Oct self-comparison; would be REVIEW today) |

In the first run the kurta was missed. Its mask box is clear of the top and bottom edges. This time Muse Spark
wrote "Source shows back view which is plain" and "Source shows only back round neckline", and neither matches
the fixed patterns ("back view only", "only the back"). On 30 Oct it wrote "back view only", which does match.
So the note patterns depend on the verifier's wording and are not reliable on their own. The fix, approved by
Manish ("Yes, add and re-run"): a third signal, the view label the seller picked for photo 1. When it is not
`full_length_front` it counts as a partial view. The label is structured data from the job record, not model
text, and it still only counts after a fidelity REVIEW or REFUSE. The note patterns were not changed. The kurta
was then re-run once as a fresh job (`evidence/agent-replace-2026-10-31-label.json`, `--jobs kurta-mustard`).
The first live result is kept as it happened.

**Resolved: 2 of 2 with the label signal (1 of 2 before it) (recorded 31 Oct self-comparison; would be REVIEW today).** Caveat: the stand-in render is the seller's own
full-length front, so after the replacement photo 1 and the render are the same file (fidelity delta_e 0.0001
polo, 0.0023 kurta). This shows the evidence path now works, not that a generated image is faithful. Seller
steps for a resolved garment: 4 (list, approve, replace, approve). Cost: 5 live gate runs, 0.1189 USD on the
Meta ledger (0.0756 + 0.0433, under the 0.20 USD cap; estimate shown before approval: 0.03 USD per run). Two
pairs is a small sample, not a rate.

**Self-comparison on this path, closed after the run (SC1, 31 Oct).** A red-team question: what stops a seller
answering the replace request with the image to publish itself? Nothing did. Since SC1 the agent's gate runner
checks every run: when the image to publish is a source photo byte for byte (SC1; SC2, below, adds near-copies), a fidelity RELEASE becomes REVIEW (a
person looks; REVIEW and REFUSE stay as they are), and the receipt's fidelity entry says "self_comparison: the image
to publish is source photo N ... byte for byte ... the seller's own photo, nothing generated". The thresholds, the
gate rules and `src/fidelity.ts` are unchanged. The two RELEASEs above were exactly this case, so **run again
today, both would be REVIEW, not RELEASE**; their committed records are kept as they happened. The keyless demo's
image to publish is now a photo the seller never lists, so its RELEASE is not a self-comparison either.
SC2 narrows the next step of the same trick: a JPEG or PNG copy of the image to publish that was re-saved,
re-encoded, stripped of EXIF or resized, and is within the grid threshold, is moved to REVIEW. Both pictures are
reduced to a 32x32 grid of mean colours; a mean difference of at most 3 (0-255) counts as the same picture, and the
RELEASE becomes REVIEW with that distance in the receipt. Measured on a committed photo: copies 0.00 to 0.49, other
photos of the same garment at the same size above 40. Not caught (CLAIMS_AUDIT): a crop, rotation, mirror, an
aspect ratio more than 2% different, heavy edits, a file that is neither JPEG nor PNG, or a new photo taken of the
printed or on-screen image.

**Keyless demo** (`npm run agent:demo`, video `out/final/evidence_recovery_demo.mp4`, not uploaded): a labelled
canned verifier (no model judged the images) shows the mechanics: three close-ups → REVIEW → the agent asks for
the full-length view → the seller adds it → the same gate → RELEASE → the seller approves → published; and an
injected instruction is rejected. It is a demonstration of the agent's mechanics, not of model accuracy.

**Scaling:** local queue with N workers, stateless per-job steps, separate photo and record stores, per-seller
limits, local metrics (`npm run agent:metrics`); the managed-queue path is a plan (`docs/AGENT_SCALING.md`).

## Inspiration

An Indian boutique seller lists every garment from their own phone photos.
Any image that goes on that listing, a cleaned-up product shot or an AI
try-on, can quietly change the colour, the print or the length, and the buyer
gets something else. In my live try-on calls, long kurtas came back shorter,
and the gate held all <!--f:tryon_all_total-->12<!--/f--> committed try-on images (<!--f:tryon_all_refuse-->10<!--/f--> REFUSE, <!--f:tryon_all_review-->2<!--/f--> REVIEW, none
released; <!--f:tryon_total-->7<!--/f--> kurta try-ons on 28–29 Oct and <!--f:tryon_run31_total-->5<!--/f--> on 31 Oct). So I wanted a deterministic check against the seller's own photos
before any candidate image can be listed.

## What it does

For one candidate listing image, ProofShot segments the seller's photos with
SAM 3.1, takes or makes the candidate (the seller's own photo; composite v2,
the seller's own garment pixels on a ghost mannequin, no image model; or an AI
try-on with Pruna on Replicate),
verifies it against those photos with Muse Spark 1.3, measures fidelity on the
SAM 3.1 masks, and lets a deterministic gate decide RELEASE, REVIEW or REFUSE.
Every step from intake to the gate decision goes into a SHA-256 hash-chained
receipt, and `web/verify.html` re-checks that receipt in the browser with
WebCrypto. English and Hindi listing copy is written after the gate by
muse-spark-open on Fireworks, from the receipt, and is kept outside the chain
(`data/copy`, each record naming the receipt head it was written from).

Checked against: README "What each Meta model does" (the model table) and
"How the gate decides", `src/pipeline.ts`, `data/jobs/live-kurta-0*-tryon*`.

## Problem

An Indian boutique seller lists garments online from their own phone photos.
Any image that goes on the listing, whether a cleaned-up product shot or an AI
try-on, can quietly change the garment: its colour, its print, its length. A
buyer then gets something other than what the photo showed.

In our live try-on calls, long kurtas came back shorter, and the gate caught
every one: <!--f:tryon_all_total-->12<!--/f--> of <!--f:tryon_all_total-->12<!--/f--> committed try-on images were held (<!--f:tryon_all_refuse-->10<!--/f--> REFUSE, <!--f:tryon_all_review-->2<!--/f--> REVIEW), none released.
ProofShot checks each candidate image against the seller's own photos before it
can be listed, and a deterministic gate, not a model, decides.

Checked against:
- Try-on results: the <!--f:tryon_total-->7<!--/f--> receipts with a `replicate-pruna-tryon` render entry in
  `data/jobs/live-kurta-0*-tryon*` (<!--f:tryon_refuse-->5<!--/f--> REFUSE, <!--f:tryon_review-->2<!--/f--> REVIEW, <!--f:tryon_release-->0<!--/f--> RELEASE), the
  <!--f:tryon_run31_total-->5<!--/f--> in `evidence/tryon/*/pruna/receipt.jsonl` (<!--f:tryon_run31_refuse-->5<!--/f--> REFUSE), and
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
- On two real seller pairs the Evidence Recovery Agent first resolved 0 of 2:
  the bad photo was photo 1, the one fidelity compares against, so no added
  photo could help. A "replace photo 1" request fixed the polo, but missed the
  kurta, because the verifier described the back view in words my fixed note
  patterns did not match.

Checked against:
- No findings, refused: `data/jobs/live-kurta-01` (gate REFUSE not_verified).
- No stored mask: `data/jobs/live-kurta-01-mismatch` has no segment with mask
  bytes; the judge view line is from 7a339a5.
- Copy audit and fix: 03f63c4, a1f5b07 (`data/copy`: <!--f:copy_texts-->168<!--/f--> texts,
  <!--f:copy_model-->164<!--/f--> by the model, <!--f:copy_template-->4<!--/f--> template, from `evidence/pack/summary.json`). These
  are final copy texts, not model calls; the Fireworks call count under Built
  with is higher because retries and rewrites are logged too.
- Caps and reserve: README spend section (Fireworks 60 USD batch + 40 reserve,
  Meta Model API 80 USD batch + 70 reserve).
- Network retry: `live-shirt-plaid-composite-v2` and `-r2` (REFUSE
  not_verified, "fetch failed"), the retry in b35c7b0 (test MS2 7).
- Four garments: `data/garments` has kurta-01, kurta-02, shirt-plaid and
  shirt-zebra with photos.
- Agent on real pairs: Evidence Recovery Agent above;
  `evidence/agent-real-2026-10-30.json`, `evidence/agent-replace-2026-10-31.json`.

## Calibration

`npm run calibrate:jobs` re-judges <!--f:cal_cases-->37<!--/f--> labelled renders from committed receipts
(<!--f:cal_same-->18<!--/f--> same garment, <!--f:cal_different-->19<!--/f--> different) at threshold factors 0.5x to 2x. At 1x,
<!--f:cal_reproduced-->37 of 37<!--/f--> rows match the gate decision each receipt recorded. <!--f:cal_unmeasured-->6<!--/f--> of those <!--f:cal_cases-->37<!--/f--> are
unmeasured (no mask, so the fidelity check could not run); they stay in the
<!--f:cal_cases-->37<!--/f--> and in the counts below. A further <!--f:cal_skipped-->6<!--/f--> fixture renders are skipped,
outside the <!--f:cal_cases-->37<!--/f-->, because their fidelity values were written, not measured.
The gate reports <!--f:cal_false_match-->0<!--/f--> false matches at 1x (0 at every factor in the report).
At 1x there are <!--f:cal_false_refuse-->4<!--/f--> false refusals: two failed verifier calls
(`live-shirt-plaid-composite-v2` and `-r2`, the failed runs under Challenges)
and two verifier outputs that were not JSON (`live-kurta-01`,
`live-kurta-01-composite`), all recorded as not_verified, so they are not a
threshold effect. No threshold changed: the
0.5x to 2x factor sweep only reports, and the configured thresholds in
`config/fidelity.json` were not edited after it. Four garments and many
repeated images: this is not a calibrated error rate.

Checked against `evidence/calibration-jobs-2026-10-29.json` (gate table: same
18, different 19, false_match 0 at every factor, false_refuse 10, 5, 4, 4, 4
at x0.5 to x2) and the run on 7de2c9c, which printed "x1 against the gate
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
| Muse Spark Open | Baseten | The first verifier (calls logged 28 Oct 09:25 IST to 29 Oct 06:13 IST; 2 earlier one-word smoke calls in `evidence/baseten-*.json` are not counted here) | <!--f:baseten_calls-->19<!--/f--> |
| Pruna try-on (`prunaai/p-image-try-on`) | Replicate | AI try-on candidates; all held by the gate | <!--f:pruna_all_calls-->12<!--/f--> (render entries in the receipts: <!--f:pruna_calls-->7<!--/f--> for the 28–29 Oct kurta jobs, the rest in the 31 Oct try-on run) |

Candidate images come from a composite v2 renderer (the seller's own garment
pixels on a ghost mannequin, deterministic code, no image model) or an AI
try-on (Pruna on Replicate). No Meta image generator is used; Muse Image is
refused at runtime. The Muse Spark cross-check (MS4) ran <!--f:ms4_runs-->204<!--/f--> checks over <!--f:ms4_pairs-->68<!--/f-->
(garment, image) pairs: <!--f:ms4_wrong_refused-->153 of 153<!--/f--> wrong-garment runs refused, <!--f:ms4_same_released-->24 of 30<!--/f-->
same-garment runs released, <!--f:ms4_consistent-->65 of 68<!--/f--> pairs gave the same decision three times.
The other 21 of the <!--f:ms4_runs-->204<!--/f--> are the shortened try-on checks (the <!--f:tryon_total-->7<!--/f--> kurta try-on images of 28–29 Oct
against their own garment, 3 runs each, `changed` in
`evidence/ms4-summary.json`): Muse Spark alone passed <!--f:ms4_changed_passed-->4 of 21<!--/f-->, and the
fidelity check returned REVIEW or REFUSE on all <!--f:tryon_total-->7<!--/f--> of these kurta try-ons (the gate cited fidelity for 4, the verifier for 3). All <!--f:ms4_runs-->204<!--/f--> runs were
answered; none is a not_verified run.

Spend, ledger figures (ProofShot's own spend ledgers, `npm run ledger` on 29
Oct; each entry is the per-call estimate the code records when it makes the
call, tokens x the price table; no provider bill was read): Meta Model API
5.99 USD (ledger) of the 80 USD cap, Fireworks 4.83 USD (ledger) of 60,
Replicate 0.105 USD (ledger), Baseten 0 (ledger); no reserve used. None of
these is a billed total. The 29 Oct Replicate reading covers the <!--f:pruna_calls-->7<!--/f--> kurta try-on
calls (<!--f:pruna_usd_est-->0.105<!--/f--> USD at the 0.015 USD per-call estimate on their receipts); the
31 Oct try-on run came later, so across all <!--f:pruna_all_calls-->12<!--/f--> committed Pruna calls the receipt
estimate is <!--f:pruna_all_usd_est-->0.180<!--/f--> USD (`evidence/tryon/SUMMARY.md`); the ledger was not re-read. The pack's Meta estimates (SAM 3.1 0.33 + Muse Spark
1.3 5.83, about 6.16 USD estimated, in `evidence/pack/README.md`) are computed
differently: they price every
committed call log, while 5.99 is the ledger as read on 29 Oct, which starts at
25d7afd and so leaves out the 51 SAM calls logged before it (0.13 USD estimated)
and the 9 calls logged after that reading (0.04 USD estimated).
The Baseten 0 is not a charge of zero: the spend ledgers were added on 29 Oct
at 10:53 IST (25d7afd), and every one of the <!--f:baseten_calls-->19<!--/f--> Baseten calls is logged
earlier (`evidence/verifier-*.json`, 28 Oct 09:25 IST to 29 Oct 06:13 IST), so none has a ledger entry. Their token
estimate is 0.30 USD (estimate, `evidence/pack/README.md`); Baseten's own bill
was not read, so the amount actually charged is UNVERIFIED.

Checked against: README "What each Meta model does" and "Limits",
`evidence/pack/summary.json` (call counts), `evidence/ms4-summary.json`,
`package.json`, `npm run ledger` on 29 Oct after 7de2c9c.

## Demo script (76 s)

Seven beats, nine shots, 76 s, in `docs/DEMO.md` (v6), showing the two shirts
only (plaid and zebra): the seller's phone photos of a plaid shirt; a pipeline
smoke example (`ms2-shirt-plaid`, the owner's own photo as the candidate,
RELEASE: it shows the pipeline runs, not accuracy); REVIEW for a composite
whose brand label is below its confidence floor
(`live-shirt-plaid-composite-v2-r3`); REFUSE for the wrong garment, the zebra
shirt against the plaid shirt's photos (`live-shirt-plaid-mismatch`); then one
byte of the receipt changed and the verify page says TAMPERED. Framed for
"Build for Your World". The v6 video has no try-on beat: when v6 was written
(29 Oct) every committed try-on was of a kurta, with no shirt try-on (the 31 Oct
try-on run, which has two shirts, came later; v7 shows only its verdict table). The try-on results (all held by
the gate, none released) are under Problem above and in the README.

Checked against `docs/DEMO.md` and `test/demo-capture.test.ts` (word caps,
timecodes summing to 76 s, every job committed, no kurta job in any shot,
every committed try-on a kurta job).

## Built during the event and prior work

Work in this repository starts with its first commit, [`15658a4`](https://github.com/rmanish2000-del/proofshot-hackathon/commit/15658a495f0f7469cc1de6fe025fec3bd7cf327e), on
27 Oct 2026 at 11:10 IST, after the hackathon opened on 26 Oct 2026 at 21:30
IST. `git log` has no commit dated before it. The prior work used is
`docs/SPEC.md` and the config boilerplate only, as listed under Prior work used
below; the code was written here from that specification.

History note: on 30 Oct 2026 the commit history was re-authored to replace a personal email address in the author and committer fields with a GitHub noreply address. Names, dates, messages and file contents are unchanged, but every commit hash changed (the first commit was 4aa99f9 before, 15658a4 now); the hashes cited in this repository's documents are the new ones.

**Prior work used:**

- `docs/SPEC.md`: the written specification of ProofShot's attributes, gate
  rules and receipt format, first written on 24 Oct 2026, before the event. It
  was brought up to date with the earlier private code on 27 Oct at 10:33 IST
  (during the event, 37 minutes before this repository's first commit; that
  update rewrote the §3 payloads and §4 validation and added §7 to §10) and
  carried over. The code here is rewritten from it,
  and every change of substance made to it in this repository is marked
  *(event)*; punctuation-only edits are not. The pre-event text itself is in
  [`docs/prior-work/`](docs/prior-work/), copied unchanged from the private
  repository's `pre-hackathon-baseline` tag (blob `b666be9`), with the 27 Oct
  update beside it as
  [`docs/prior-work/SPEC-04e207d.md`](docs/prior-work/SPEC-04e207d.md) (blob
  `9651a5c`), so both steps can be compared with this
  repository's `docs/SPEC.md` and code.
- Config boilerplate (`tsconfig.json`, `.gitignore`) mirrors the earlier
  private repository.

The demo and every committed receipt use only the code in this repository and
the hosted models named under Built with (SAM 3.1 and Muse Spark 1.3 on
`api.meta.ai`, Muse Spark Open on Baseten, muse-spark-open on Fireworks, Pruna
on Replicate).

Checked against: `git log --reverse` (first commit and the dates of all
commits), the `provider` fields of every receipt in `data/jobs`, and every
endpoint URL in `src/` and `scripts/`.

## Questions a judge may ask

- *What is the first commit, and is pre-event code in it?* `15658a4`, 27 Oct
  2026 at 11:10 IST, after the 26 Oct 21:30 IST opening (`git log --reverse`).
  `git log` has no commit dated before it, and the gate, receipt chain, verify
  page, provider code, demo and evidence are all in commits from 15658a4 on.
- *What was carried over?* Only `docs/SPEC.md` (the written specification,
  with event changes marked *(event)*) and the config boilerplate
  (`tsconfig.json`, `.gitignore`), as listed under Prior work used.
- *What do the demo and the receipts call?* The demo and every receipt use
  only this repository's code and the hosted models named under Built with
  (the `provider` field of each receipt in `data/jobs`, and the endpoint URLs
  in `src/` and `scripts/`).
- *Did any AI on-model image get released?* No: <!--f:tryon_all_total-->12<!--/f--> of <!--f:tryon_all_total-->12<!--/f--> committed try-on
  images were held (<!--f:tryon_all_refuse-->10<!--/f--> REFUSE, <!--f:tryon_all_review-->2<!--/f--> REVIEW): <!--f:tryon_total-->7<!--/f--> kurta try-ons of 28–29 Oct in
  `data/jobs/live-kurta-0*-tryon*` (<!--f:tryon_refuse-->5<!--/f--> REFUSE, <!--f:tryon_review-->2<!--/f--> REVIEW) and <!--f:tryon_run31_total-->5<!--/f--> in the 31 Oct run
  (`evidence/tryon/SUMMARY.md`, all REFUSE). On the 28–29 Oct set the
  verifier alone passed <!--f:ms4_changed_passed-->4 of 21<!--/f--> shortened try-on checks in MS4; the fidelity
  check returned REVIEW or REFUSE on every one (the gate cited fidelity for 4, the verifier for 3). The v6
  demo shows the two shirts only and has no AI on-model image (v7 shows the 31 Oct verdict table, not the try-on images), and no new
  paid call was made for the video (`docs/DEMO.md`,
  `test/demo-capture.test.ts`).
- *What can I run without a key?* `npm ci`, `npm test`, `npm run serve` and
  `npm run demo:replay` need no key; without keys every provider is a fixture
  and the page and receipt say so (README "Judge quickstart"). In the README's
  command list, `npm run call:baseten` is the one live model call and needs
  `BASETEN_API_KEY`; the live batch scripts (`npm run job:live` and others)
  also need their keys and are not part of the quickstart.
- *Can I open `web/verify.html` from disk?* Yes. It is checked from disk
  (`file://`) in headless Edge by the demo capture (S8: VALID, then TAMPERED
  for the one-byte copy) and over local HTTP in Chromium. It is not yet checked
  from disk in a normal browser window.

## Accomplishments that I'm proud of

I built ProofShot in TypeScript during the event, starting from the written
spec. The pipeline segments a seller's photos, verifies a candidate image,
measures fidelity, and lets a deterministic gate decide. It writes each step
from intake to the gate decision into a SHA-256 hash-chained receipt, and
`web/verify.html` checks that chain in the browser. In calibration, the gate
reproduced <!--f:cal_reproduced-->37 of 37<!--/f--> recorded decisions at 1x with <!--f:cal_false_match-->0<!--/f--> false matches. In the
Muse Spark cross-check, <!--f:ms4_wrong_refused-->153 of 153<!--/f--> wrong-garment runs were refused, and the
fidelity check returned REVIEW or REFUSE on all <!--f:tryon_all_total-->12<!--/f--> committed try-on images (<!--f:tryon_total-->7<!--/f--> on 28–29 Oct, <!--f:tryon_run31_total-->5<!--/f--> on 31 Oct).

On two real seller pairs, the Evidence Recovery Agent got both to RELEASE (recorded 31 Oct self-comparison; would be REVIEW today) by
asking the seller to replace a bad first photo (2 of 2 with the seller's photo
label as a trigger, 1 of 2 before I added it). The caveat comes first: the
render was a stand-in, the seller's own new photo 1, so render and photo were
the same file. That proves the evidence path works, not that a generated image
is faithful, and two pairs is not a rate. In a try-on run on 5 real garments,
0 of 5 AI try-ons were released. The one RELEASE was a composite v2, the
seller's own pixels placed again, not a generated image.

Checked against: Built during the event (first commit 15658a4), Calibration
and Built with above, `src/gate.ts`, `src/receipt.ts`, `web/verify.html`;
Evidence Recovery Agent above; `evidence/tryon/SUMMARY.md`.

## What I learned

I learned to handle silent failures explicitly. A verifier that returns no
findings should not release an image, so the gate refuses it as not verified.
When no mask was stored, the job view says the fidelity check could not run
instead of showing a misleading REVIEW. I added a copy audit and fix pass
because generated copy sometimes described the software instead of the
garment. A verifier call with large photos is now retried once, and the two
failed runs stay recorded as refusals. With four garments, calibration is a
self-check, not a true error rate. A trigger that reads the verifier's free
text depends on its wording: the same kurta back was "back view only" on
30 Oct and "Source shows back view which is plain" on 31 Oct, so the agent
missed it. Structured data, such as the seller's photo label, is a safer signal.

Checked against: Challenges and Calibration above; `src/gate.ts` (an attribute
with no finding fires `not_verified`); Evidence Recovery Agent above.

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
- Make the agent's replace-photo trigger structural (mask geometry and seller
  labels) rather than dependent on the verifier's wording, and measure it on
  more than two pairs.
- Re-take the grey shirt through intake from the original phone file: since
  EX1 (31 Oct) intake applies the EXIF orientation before stripping it, but the
  committed grey shirt photo was stripped before that, so it is still sideways
  and was not changed (the original with its tag is not in the repo).

Checked against: README "Limits" and "What is verified and what is not";
Grok's SP1 list on #23 (six of its twelve cases need a real phone photo);
`evidence/tryon/SUMMARY.md`.
