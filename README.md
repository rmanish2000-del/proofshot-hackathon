# ProofShot (hackathon build)

**All of ProofShot's code was written during the event, from 27 Oct 2026 (first commit [`15658a4`](https://github.com/rmanish2000-del/proofshot-hackathon/commit/15658a495f0f7469cc1de6fe025fec3bd7cf327e), 11:10 IST; the hackathon opened 26 Oct 2026, 21:30 IST).** The gate, the receipt chain, the verify page, the pipeline and the upload, judge and shop pages are all code in this repository. Disclosed prior work, listed below: the written specification the code was rewritten from (pre-event text published unchanged in `docs/prior-work/`), two config files (`tsconfig.json`, `.gitignore`), and one AI-generated sample model image (`synthetic-01`, used only in try-on runs committed on 28 and 31 Oct and in Space jobs made before 2 Nov; the final demo uses `synthetic-02`, made 28 Oct, during the event). An earlier private prototype's code is not in this repository.

**Live demo:** https://rmanish2000-proofshot.hf.space/, a public Hugging Face
Space (`rmanish2000/proofshot`) whose root opens the seller upload page
(`/upload.html`), checked by Grok on 1 Nov 2026 at 20:10 IST. Which build and
which providers the Space runs is not read from the Space repo in this README,
so it is UNVERIFIED here; everything below is about this repository.

**Video:** https://youtu.be/JSzJBOU11sA (v9 final cut, 172.1 s, 1920x1080; narration is the recorded voiceover, a generated Edge TTS voice, en-IN-PrabhatNeural. The earlier v8 video, https://youtu.be/cOeRYwRZBlA, is superseded).

**Verify a receipt offline:** `web/verify.html` makes no network request. Give
it a `receipt.jsonl` and the image; steps 2 and 3 of "Quick verify in 2
minutes" walk through VALID and TAMPERED, and "Verify page" says what it checks.

**Quick start** (Node 22.6 or later, no API key), after
`git clone https://github.com/rmanish2000-del/proofshot-hackathon.git` and
`cd proofshot-hackathon`; then open the pages in "Quick verify in 2 minutes":

```
npm ci
npm run serve
npm test             # long-running: minutes, see the end of "Quick verify in 2 minutes"
```

ProofShot checks a candidate listing image against the seller's own phone
photos of the garment (up to three; the upload page takes one to three JPEGs, and the server refuses a
fourth: `test/serve.test.ts` "RV17: the upload API takes one to three photos and refuses a fourth with 400") before the image goes on sale. A
verifier model compares the garment attribute by attribute. A deterministic
code gate, not the model, then decides **RELEASE**, **REVIEW** or **REFUSE**
from those structured findings and a fidelity check, measured on the garment
masks when measurable. In a live run a missing measurement fails closed: the
fidelity check (`src/fidelity.ts`) gives REVIEW at best and says why on the
receipt. A fixture run (no keys) has a stub fidelity check that measures
nothing and returns RELEASE with `"metrics":null`; its receipt says provenance
`fixture` (example below). Every step to the gate decision is written into
a hash-chained receipt (the intake photo hashes are recorded in the `job`
entry's `source_images`) that anyone can check offline in
`web/verify.html`: a single page that makes no network request and needs no
account (checked in Chromium over local HTTP, and opened from disk (`file://`)
in headless Edge by the demo capture).

The candidate images in the committed runs come from two paths. The composite
path cuts the seller's own garment pixels out with a SAM 3.1 mask and frames
them in deterministic code: by default v2 (`src/composite-v2.ts`), with no
body template, on a plain studio backdrop; v1 (`src/composite.ts`) warped them
onto a mannequin template. The try-on path is an AI try-on (Pruna on
Replicate). Some committed runs use neither: the seller's own photo stands in
as the candidate (e.g. `ms2-shirt-plaid`, a pipeline smoke example). No Meta image generator is used anywhere, and
Muse Image is refused at runtime. No committed run has released a generated
on-model photo: all <!--f:tryon_all_total-->12<!--/f--> committed try-on images were held by the gate (<!--f:tryon_all_refuse-->10<!--/f--> REFUSE, <!--f:tryon_all_review-->2<!--/f-->
REVIEW): <!--f:tryon_total-->7<!--/f--> kurta try-ons on 28–29 Oct (<!--f:tryon_refuse-->5<!--/f--> REFUSE, <!--f:tryon_review-->2<!--/f--> REVIEW) and <!--f:tryon_run31_total-->5<!--/f--> in the
31 Oct try-on run (<!--f:tryon_run31_refuse-->5<!--/f--> REFUSE, `evidence/tryon/SUMMARY.md`). For the 28–29 Oct set, the verifier alone would not have held them all: in the Muse Spark
cross-check it passed <!--f:ms4_changed_passed-->4 of 21<!--/f--> checks of those shortened try-ons. The measured
fidelity check returned REVIEW or REFUSE on every one; the gate's cited reason was
fidelity for 4 of them and the verifier for 3 (two timeouts, one soft mismatch).

That is why the demo video shows no AI on-model image: when the v6 script was
written (29 Oct) every committed try-on receipt (<!--f:tryon_total-->7<!--/f-->, <!--f:tryon_review-->2<!--/f--> REVIEW and <!--f:tryon_refuse-->5<!--/f--> REFUSE) was a kurta job held by
the gate, the demo shows the two shirts only, and there was no shirt try-on. The
31 Oct run's try-ons show the synthetic model, so the v7 re-render shows their verdict table, not the try-on images.
The demo capture reads no API key (fixture providers only,
`providersFromEnv({})` in `scripts/demo-capture.ts`) and every captured frame
points at a committed job, recording or file (`test/demo-capture.test.ts`,
DEMO1). The video to submit is v9 (`docs/DEMO.md` "v9: the video to submit"); v8 below is superseded.
v8 ran 167.9 s (about 2:48); the rendered file is not committed and no committed
file gives that length, so it is UNVERIFIED here. Its narration is the recorded
voiceover, a generated Edge TTS voice (en-IN-PrabhatNeural), and each figure it
speaks is checked in the "v8 fact check" table there. The v7 re-render script
(its script runs 2:45, or 2:50 with the optional end card) is superseded. The
v6 capture (9 shots) is 76 s; that is capture timing only, not the video's
length.

## What each Meta model does

| Model | Served by | What it does in ProofShot | Logged calls (committed) |
|---|---|---|---|
| SAM 3.1 (`meta/sam-3.1`) | Meta Model API, `api.meta.ai` | Garment segmentation: the mask the composite cuts out and the fidelity check measures on | <!--f:sam_calls-->130<!--/f-->, `evidence/sam-*.json`; plus <!--f:sam_calls_runs-->47<!--/f--> in the 30–31 Oct agent and try-on run logs (`evidence/<run>/logs/`) |
| Muse Spark 1.3 (`muse-spark-1.3`) | Meta Model API, `api.meta.ai` | Verifier only: per-attribute findings (colour, print, collar, sleeves, hem, pockets, buttons, logo, texture; gate keys `color`, `print_pattern`, `collar`, `sleeve_length`, `hem`, `pocket_count`, `buttons`, `logo_text`, `fabric_texture`) that the gate reads. It never decides and never makes an image | <!--f:muse13_calls-->226<!--/f-->, `evidence/verifier-*.json`, `evidence/ms4/`; plus <!--f:muse13_calls_runs-->16<!--/f--> in the 30–31 Oct run logs |
| muse-spark-open (`accounts/fireworks/models/muse-spark-open`) | Fireworks | English and Hindi listing copy and plain-language receipt summaries, written after the gate from the receipt; the text never enters the chain | <!--f:fireworks_calls-->293<!--/f-->, `evidence/fireworks-*.json`, texts in `data/copy/` |
| Muse Spark Open (`meta-models/muse-spark-open-1026`) | Baseten | **Built with Muse Spark Open.** The first verifier, before the Meta Model API one: its calls are logged from 28 Oct 09:25 IST to 29 Oct 06:13 IST. Two earlier `npm run call:baseten` smoke calls (27 Oct 18:53 IST, 28 Oct 06:21 IST, `evidence/baseten-*.json`) asked for one word and are not verifier calls | <!--f:baseten_calls-->19<!--/f-->, `evidence/verifier-*.json` |

Counts are from `evidence/pack/summary.json` (`npm run evidence:pack`), which reads the logs in `evidence/` and
`evidence/ms4/` only. The 30–31 Oct agent and try-on runs keep their logs in their own folders
(`evidence/<run>/logs/`, <!--f:run_log_dirs-->4<!--/f--> folders); those calls are counted apart by `npm run figures`, so
in all SAM 3.1 has <!--f:sam_calls_all-->177<!--/f--> logged calls and Muse Spark 1.3 <!--f:muse13_calls_all-->242<!--/f-->. The deck and the
rendered videos quote the pack-only counts (SAM 3.1 <!--f:sam_calls-->130<!--/f-->, Muse Spark 1.3 <!--f:muse13_calls-->226<!--/f-->), not
these all-logs totals; they were made before the run logs were counted (NUM10).

## Limits

- **Small sample.** The jobs, calibration, MS4 cross-check and evidence pack
  cover <!--f:garments-->4<!--/f--> real garments (two women's kurtas, two shirts: kurta-01, kurta-02,
  shirt-plaid, shirt-zebra), all from one household. The 31 Oct try-on run
  (`evidence/tryon/SUMMARY.md`) used <!--f:tryon_run31_garments-->5<!--/f--> other real garments (pink polo,
  mustard kurta, pink patchwork kurta, red floral kurta, grey shirt; photos in
  `data/seller-pairs`). No photo is shared between the two sets (sha256 in each
  `intake.json`, checked by a test), and by eye none of the 5 is any of the 4
  (kurta-01, kurta-02, shirt-plaid, shirt-zebra; front photos compared 2 Nov), so <!--f:garments_all-->9<!--/f--> real garments in all. Every rate in this README describes
  the pairs of the set it names, not ProofShot in general.
- **Verifier accuracy is not measured in general.** The Muse Spark cross-check
  (MS4) refused <!--f:ms4_wrong_refused-->153 of 153<!--/f--> wrong-garment runs and released <!--f:ms4_same_released-->24 of 30<!--/f-->
  same-garment runs, on these four garments only.
- **The verifier misses length changes.** On its own it passed <!--f:ms4_changed_passed-->4 of 21<!--/f-->
  checks of try-ons that had shortened the garment. The fidelity check, which
  measured the garment shrinking in frame, returned REVIEW or REFUSE on every one
  of those try-ons; the gate cited fidelity for 4 of the 7 and the verifier for 3
  (two timeouts, one soft mismatch).
- **Thresholds are provisional.** Calibration over the committed receipts finds
  <!--f:cal_false_match-->0<!--/f--> false matches and <!--f:cal_false_refuse-->4<!--/f--> false refusals, all of them where the verifier gave no
  answer; that is a self-check on few garments, not an error rate.
- **No generated on-model photo has been released**, and nothing here claims an
  effect on returns or sales. The only public deploy is the Hugging Face
  Space above (live demo), and what it runs is UNVERIFIED here; the static demo
  below is not published anywhere.

## Quick start

No install: the Live demo line at the top names the public Space (what it runs
is UNVERIFIED here). To run this repository yourself: Node 22.6 or later.

```
npm ci
npm test             # the whole suite, offline: no network, no keys
npm run typecheck
npm run page         # rewrites the inlined core in web/verify.html from src/core.js
npm run intake -- <folder>   # garment photos in: applies EXIF orientation, drops Exif/XMP/vendor data, keeps JFIF/ICC, records both hashes
npm run call:baseten         # one live Muse Spark Open call (the first verifier), logged to evidence/
```

Of these, `npm run call:baseten` is the only command that makes a live model
API call, and it needs `BASETEN_API_KEY` set. It calls Muse Spark Open on
Baseten, the first verifier; the verifier today is Muse Spark 1.3 on the Meta
Model API, turned on by `VERIFIER_PROVIDER=meta` with `MODEL_API_KEY` (see
"Optional: live providers").

## Quick verify in 2 minutes

Needs Node 22.6 or later and Chrome or Edge. No API key, and no network after
`npm ci`. On Windows, clone into a short folder path (the longest file path in
the repository is 82 characters, so keep the folder under about 170), or git
stops with "Filename too long".

```bash
git clone https://github.com/rmanish2000-del/proofshot-hackathon.git
cd proofshot-hackathon
npm ci
npm run serve
```

If port 8787 is taken, `npm run serve` says so; run
`npm run serve -- --port 8790` and use that port below. Then, in about two
minutes:

1. (Replace 8787 with your port in every step.) Open
   `http://127.0.0.1:8787/judge?job=live-shirt-plaid-mismatch`: the plaid
   shirt's photos beside a different shirt, and the gate's **REFUSE**
   (`hard_mismatch` on colour at 0.99). Swap the job for
   `live-shirt-plaid-composite-v2-r3` (**REVIEW**) or `ms2-shirt-plaid`
   (**RELEASE**, the owner's own photo as the candidate: a pipeline smoke
   example). These are committed live jobs; the page only reads their receipts.
2. Open `http://127.0.0.1:8787/verify.html`. Choose the receipt
   `web/shop/ms2-shirt-plaid/receipt.jsonl` and the image
   `web/shop/ms2-shirt-plaid/ms2-shirt-plaid-r0.jpg`, then **Check**: VALID,
   7 entries.
3. Copy that receipt, change `"seq":1` to `"seq":2` on its second line, and check
   the copy with the same image: TAMPERED, entry 1.

Stop the server with Ctrl+C. Nothing is uploaded: the verify page makes no
network request.

The full test suite runs offline too, but takes longer (measured 316 s to 423 s on one
laptop, SUBMISSION "Judge setup on a clean clone"; 467 s on the Windows autorun box after FLK2): `npm test` runs <!--f:tests-->453<!--/f--> tests, the gate, receipt chain and verify core
included.

## Evidence-checking agent (keyless demo)

When the gate says REVIEW or REFUSE because evidence is missing, a bounded agent asks the seller for the
missing photo and re-runs the same gate; the gate still decides. See SUBMISSION.md "Evidence-checking agent"
and `docs/EVIDENCE_CHECKING_PLAN.md`.

```bash
npm run agent:demo      # keyless: length case REVIEW -> photo request -> same gate -> RELEASE; one injection refused
npm run agent:eval      # the agent on the committed jobs; writes evidence/agent-eval-2026-10-30.json
npm run agent:metrics   # local monitoring summary of the demo store
```

`npm run agent:real` ran the agent once on two real seller photo pairs with the live gate (paid, metered on the
Meta ledger; it refuses to run again over its own records): resolved 0 of 2, see SUBMISSION.md. That run
moved the Meta ledger by 0.1058 USD (`meta_spend_usd_this_run` in `evidence/agent-real-2026-10-30.json`, the
ledger's spent after minus before; the ledger is a sum of per-call estimates, not a bill), against the agent's
own budget estimate of 0.12 USD for its 4 gate re-runs (`metrics.spend_usd` there). The replace runs' figures
below are the same `meta_spend_usd_this_run` field.
`npm run agent:replace` ran it once more on the same pairs with the replace-the-first-photo action
(`request_replace_primary`: when fidelity fails and the receipt shows photo 1 is cropped, angled or partial, the
seller is asked to replace photo 1 and the gate re-runs from the start). That first replace run cost 0.0756 USD
and resolved 1 of 2. The polo went REFUSE → RELEASE, against a stand-in render that is the same file as the new
photo 1. The kurta was not asked, because the note patterns missed the verifier's wording. After photo 1's seller
label (here `full_length_back`) was added as a trigger signal, the kurta was re-run once (`--jobs kurta-mustard
--tag 2026-10-31-label`): asked, REFUSE → RELEASE, same stand-in caveat, 0.0433 USD. 2 of 2 with the label
(recorded 31 Oct against a stand-in render that is the new photo 1; today's gate says REVIEW for both: the SC1
self-comparison check, SUBMISSION.md "Self-comparison on this path, closed after the run"); 0.1189 USD in total for the two replace runs, 5 live gate runs
(3 in the first, 2 in the label re-run; agent runs only, not all project spend).

Where the agent's steps are recorded: not in the gate receipt. Each gate re-run writes its own receipt
(`records/<seller>/<job>/runs/run-<n>/receipt.jsonl`, the format below). The agent's proposals (a
`request_replace_primary` included), tool results, the seller's approval and the replacement of photo 1
(`replaced_primary`, old and new sha256) go into a separate file per job, `records/<seller>/<job>/agent.jsonl`,
hash-chained like a receipt with entry kind `agent` (`src/agent/store.ts`, `src/agent/service.ts`; the
committed ones are under `evidence/agent-real-2026-10-30/` and `evidence/agent-replace-2026-10-31*/`). The
job record (`job.json`) keeps the request and the `replaced` list but is not chained. Limit: the two chains
are not linked into one; the agent log's final entry names the last run's receipt head (`gate_head`), but no
gate receipt names the agent log, so the replacement is not inside the gate's hash chain.

The demo's verifier is a labelled canned stand-in (no model judged the images): it shows the mechanics, not
accuracy. Nothing in it calls a model or publishes without the seller's approval.

## Keyless static demo (`out/static-demo/`, not hosted)

`npm run demo:static` builds `out/static-demo/`: the judge view, the verify page and the shop as plain files,
for every committed job (local `upload-*` jobs are left out). It needs no application server and no API key (any static HTTP server works), and nothing in
it judges, generates or uploads anything: each page only reads committed receipts. Open it over HTTP (the pages
fetch JSON files, so `file://` will not work):

```bash
npm run demo:static -- --serve
```

then `http://127.0.0.1:8791/` (`--port` picks another port). Any static host can serve the folder as it is
(about 120 MB); it has not been published anywhere. In this build the judge page's **Verify chain** and
**Tamper demo** buttons show results computed when the demo was built, and the page says so; `verify.html`
still checks any receipt live in the browser.

## Judge quickstart

No API keys are needed. Without keys the run is **fixture mode**; the page and
receipt are labelled as such. The render step shows the owner's photo as a
stand-in; nothing is generated.

A RELEASE in fixture mode is a no-key demo of the pipeline, **not model
verification**: the verifier is a fixture (no model judged the image) and the
fidelity check is a stub that measures nothing (`"metrics":null` in the
receipt). The receipt's job entry says provenance `fixture`, the upload page
shows a "Fixture mode: no model key is set" banner and tags each result
"fixture job", and the verifier is named "fixture verifier (no model judged the
image)". Verified results are the committed live jobs in
`data/jobs` (provenance `live`). The demo capture (v6 shot list in
`docs/DEMO.md`) shows three of them: `ms2-shirt-plaid`,
`live-shirt-plaid-composite-v2-r3` and `live-shirt-plaid-mismatch`. The v7
re-render adds the keyless `npm run agent:demo` run (a labelled canned
verifier, not a `data/jobs` job) and the 31 Oct try-on run's verdict table and
shirt-pink composite from `evidence/tryon/` (`evidence/tryon/SUMMARY.md`).

1. Install dependencies from the committed lockfile:

```bash
npm ci
```

2. Run the tests:

```bash
npm test
```

3. Start the local server:

```bash
npm run serve
```

Then open `http://127.0.0.1:8787/` (the URL `npm run serve` prints). You should
see the seller upload page, two steps since UX-EASY1: Photos, then Result (the
375 px English and Hindi screenshot check is pending until those screenshots land). The
Result step shows the pipeline board (strip metadata, segment, render, verify,
gate). Each result card shows a RELEASE, REVIEW or REFUSE badge, reasons, and a **View
receipt** link. This seller upload page is local in this repo (`npm run serve`);
the public Space is named at the top ("Live demo"), and what it runs is
UNVERIFIED here. The local page was checked in Chromium on 29 Oct in fixture mode,
as the 3-step page before UX-EASY1 (see
"What is verified and what is not"). Each ProofShot result has a hash-chained
receipt; a deterministic code gate decides RELEASE/REVIEW/REFUSE.

4. Replay the canned examples (no network, no key; output goes to the
   gitignored `out/`):

```bash
npm run demo:replay -- demo/recordings/refuse out/replay
npm run demo:replay -- demo/recordings/review out/replay
npm run demo:replay -- demo/recordings/release out/replay
```

They end in REFUSE (hard_mismatch), REVIEW (soft_mismatch) and RELEASE. The
recordings in `demo/recordings` are `refuse`, `review` and `release` (canned),
plus `live-kurta-01-2` and `live-kurta-01-mismatch` (recorded from live jobs).

5. Verify a receipt: click **View receipt** on a result card that has an image.
It opens `http://127.0.0.1:8787/verify.html#sha=<image sha256>`, the receipt
verification page with the image hash filled in. You can also download the
receipt from the card and check it on `web/verify.html` opened from disk. In
fixture mode the receipt's job entry says provenance `fixture`.

Demo frames (DEMO1, DEMO1b): `npm run demo:capture` starts its own local
server on a free port, opens every `docs/DEMO.md` shot in headless Edge or
Chrome (`PROOFSHOT_BROWSER` names another) from the committed receipts, and
writes numbered PNG frames at 360 and 1280 px to the gitignored `out/demo/`.
Title cards (S1, S9) and the receipt bytes around the byte the tamper step
changes (S7) are plain pages it writes from committed files; S8 opens
`web/verify.html` from disk with the receipt and then its one-byte copy. `out/demo/shots.json`
gives each shot's seconds (76 s in total for v6; the capture's cap is 115 s) and `out/demo/frames.txt` is
an ffmpeg concat list of the 1280 px frames; the video is assembled from it
elsewhere, the script runs no ffmpeg. `out/demo/captions.srt` (DEMO1c) is the
subtitle track for the muted cut: one cue per narrated shot, the `docs/DEMO.md`
voiceover verbatim, timed from the same seconds (a line still marked TBD gets no
cue; since DEMO1f no beat is TBD, so every shot has one). No upload, no publish, no live call, no key read. `npm run demo:stage`
(DEMO1d) then copies the 1280 px frames, shots.json, frames.txt and captions.srt
to `%LOCALAPPDATA%\ProofShotStaging\demo\<UTC timestamp>\` (or `-- --to <dir>`)
with a `manifest.json` of each file's sha256 and size; frames.txt names bare
files, so it works there as is. Nothing staged is committed.

6. Optional: keep generated jobs out of tracked folders:

```bash
npm run serve -- --jobs out/ui-jobs --shop out/ui-shop
```

Judge Q and A, each answer citing its source and naming its weak spot:
`docs/JUDGE_QA_TAMPER.md` (the tamper check and receipt chains),
`docs/JUDGE_QA_TRYON_MODELS.md` (the try-on, the fidelity check and the
models) and `docs/JUDGE_QA_GATE.md` (the gate).

### Optional: live providers

You do not need these for the quickstart. Without them, every provider is a
fixture and the run is fixture mode.

- Live verifier today: Muse Spark 1.3 on the Meta Model API (`api.meta.ai`, `src/verifier-meta.ts`): set env vars `VERIFIER_PROVIDER=meta` and `MODEL_API_KEY` (in the process, or the Windows User env) for `npm run job:live`; the live batch scripts set `VERIFIER_PROVIDER=meta` themselves. `npm run serve` does not wire this verifier yet: with `VERIFIER_PROVIDER=meta` the page stays in fixture mode and its label says so.
- First verifier: Muse Spark Open on Baseten (`src/verifier.ts`): set env var `BASETEN_API_KEY` and leave `VERIFIER_PROVIDER` unset (`npm run job:live`, `npm run serve`, `npm run call:baseten`). Do not put a key value here.
- Live SAM 3.1 segmentation: SAM 3.1 on `api.meta.ai`: set env vars `MODEL_API_KEY` and `MODEL_SEGMENT` (do not put key values here).

## How the gate decides

`decide()` in `src/gate.ts` returns **RELEASE**, **REVIEW** or **REFUSE**. Its
input is the verifier's findings (`attribute`, `verdict`, `confidence`) and,
optionally, the fidelity result. No other field exists, so no prompt, note or
model prose can reach the decision. The rules, highest priority first, are in
`docs/SPEC.md` §2. In short:

- a duplicate or unknown attribute, a confident mismatch on a hard attribute
  (`color`, `print_pattern`, `logo_text`, `collar`), or an attribute with no finding: **REFUSE**
- low confidence, a soft mismatch, or `uncertain`: **REVIEW**
- nothing fired: **RELEASE**

It fails closed. A missing attribute is not a pass, and `NaN` confidence counts
as 0. If the renderer or segmenter throws, the result is **REFUSE**
(`render_failed`, `segment_failed`), and so is an unreadable prior record. The
fidelity check can only make a decision worse, never better. Earlier
refusals for the same garment stay visible: each job records `prior_records`
from earlier receipts with the same `garment_id`.

## Receipt format

`receipt.jsonl`, one entry per line, append-only by convention (the code only
appends; nothing enforces it, see the last paragraph of this section):

```
hash = sha256(canonicalJson({ seq, at, kind, payload, prev }))
```

`prev` is the previous entry's `hash` (64 zeros for entry 0). `canonicalJson`
sorts keys and rejects non-finite numbers. A job writes these kinds in order:
`job`, `segments`, then for each scene `render`, `verifier`, `fidelity`,
`gate` and, only on RELEASE, `release`. Payload fields are listed in
`docs/SPEC.md` §3. Here is a shortened example, a fixture job with one scene
(hashes are cut to 8 characters):

```json
{"seq":0,"at":"2026-10-27T10:00:00.000Z","kind":"job","payload":{"job_id":"demo","garment_note":"blue cotton shirt","provenance":"fixture","scenes":["studio"],"source_images":[{"name":"1-front.jpg","sha256":"3f1c…"}],"garment_id":"a9e2…","prior_records":[]},"prev":"0000…","hash":"5b07…"}
{"seq":1,"kind":"segments","payload":{"count":1,"segments":[{"label":"shirt","box":[0.1,0.1,0.8,0.8],"score":0.97,"mask_sha256":null}]}, …}
{"seq":2,"kind":"render","payload":{"render_id":"demo-r0","sha256":"c41d…","model":"fixture-render","provider":"fixture","prompt":"…"}, …}
{"seq":3,"kind":"verifier","payload":{"render_id":"demo-r0","findings":[{"attribute":"color","verdict":"match","confidence":0.95}, …],"verifier":{"provider":"fixture","model":"fixture-verifier","base":"fixture"}}, …}
{"seq":4,"kind":"fidelity","payload":{"render_id":"demo-r0","decision":"RELEASE","metrics":null,"reasons":[]}, …}
{"seq":5,"kind":"gate","payload":{"render_id":"demo-r0","decision":"RELEASE","cited":null,"reasons":[]}, …}
{"seq":6,"kind":"release","payload":{"render_id":"demo-r0","image_sha256":"c41d…","approver":"unattended","approved_by_human":false}, …}
```

The `fidelity` entry above is the fixture stub (`fixtureProviders` in
`src/pipeline.ts`): `"metrics":null` and RELEASE, because a fixture job
measures nothing. A live job's fidelity entry carries the measured metrics, or
REVIEW with the reason when it could not measure (`live-kurta-01-2` in
`data/jobs` is one).

The chain catches an edited, reordered or forged entry, and an entry deleted
from the middle. Entries cut off the end leave a shorter chain that still
verifies, and only the git history shows the cut; if the cut removes an image's `release` entry, the verify page says
NOT RELEASED for that image (or TAMPERED, in no entry, if its `render` entry is
cut too), never VALID (`checkImageWith` in `src/core.js`; `test/check.test.ts`
RV2 8). It does not stop someone from rewriting the whole file from entry 0,
because there is no signature or outside witness (`docs/SPEC.md` §3, threat
model).

## Verify page

`web/verify.html` is one self-contained file that makes no network request: a
Content-Security-Policy of `default-src 'none'` blocks every request. It has
been checked in Chromium served over local HTTP; opened straight from disk
(`file://`) it is checked in headless Edge: the demo capture (S8, 29 Oct) gave
VALID for `ms2-shirt-plaid`, then TAMPERED for its one-byte copy. Give it a
`receipt.jsonl` and an image (or its sha256). It checks the chain with
WebCrypto (`crypto.subtle`) and answers **VALID** (this image was released by
this record), **NOT RELEASED** (rendered but not released, with the gate's
decision) or **TAMPERED** (the chain is broken, or the image is not in the
record). If the browser has no WebCrypto, it says "cannot verify in this
browser" and gives no verdict. The page and the Node side run the same
`src/core.js`, and a test checks they agree.

## Shopper preview (built during the hackathon)

What a buyer sees (SPEC §11). `npm run shop` reads `data/jobs/*/receipt.jsonl`
and writes `web/shop/`: a `catalog.json` row for every `release` entry of a
receipt whose chain verifies and whose released image is beside it with the
right bytes, plus a copy of that image and receipt. A REVIEW or REFUSE never
becomes a row; a broken receipt gives its job no row and a non-zero exit.
`web/shop.html` (serve the `web/` folder statically) shows the catalog as a
phone-first grid. In the browser it re-verifies each copied receipt and
re-hashes the image bytes it just fetched; only when both match the release
does the image get the **Verified by ProofShot** badge, otherwise it says
"not verified". The badge opens a panel with the chain head, `render_id`, gate
reason, provenance, a "Verify it yourself offline" link to
`verify.html#sha=<hex>` (which prefills the hash) and downloads of the receipt
and image. The shop decides nothing and calls no model; it reads.

It shows fixture jobs, written by the same script with a recorded clock, and
the committed live jobs. Of the generative render transports (SPEC §8), only
the Pruna try-on is written (`src/render-replicate.ts`, see Providers), and
the gate held all <!--f:tryon_all_total-->12<!--/f--> of its committed outputs, so no shop card shows one; the
`openai-images`, `fal` and `meta` transports are not written.
`data/jobs/fixture-shirt-01` has synthetic images. `data/jobs/kurta-01` and
`kurta-02` are preview jobs for the two photographed garments under
`data/garments/`: the sources are the intake photos with their `intake.json`
hashes, and the released "render" is the garment's own front photo, unchanged
(no generated image, no person), returned by the `stand-in` render provider,
which the receipt's render entry names (`stand-in` / `owner-photo`). Every card
and product view built from such a receipt carries the tag "owner's photo,
stands in for render". They let a judge see a real garment go through the
receipt, the in-browser verification and the badge. `live-kurta-02-composite`
is a live job whose released image is a composite (see Providers), tagged
"Composite: your garment photo on a mannequin. Not AI-generated."

New in this feature, all written during the event: `src/shop.ts`,
`scripts/shop-build.ts`, `web/shop.html`, `web/shop/` (generated),
`data/jobs/fixture-shirt-01/` (generated), `test/shop.test.ts`, SPEC §11, the
`shaFromFragment` helper in `src/core.js` and the `#sha` prefill in
`web/verify.html`, and `src/page.ts` / `scripts/page.ts` covering both pages.
Built earlier in this repository, during the event, and not part of this
feature: the gate, the receipt chain, the verify-page core (`src/core.js`
checks) and the intake.

## Seller upload (built during the hackathon)

What a seller does (SPEC §12). `npm run serve` starts a local server on
`http://127.0.0.1:8787/` that serves `web/` and runs the real pipeline. The
page `web/upload.html` is one screen, phone first, Hindi/English toggle, no
login: drop up to three JPEGs of one garment (saying what it is is optional;
nothing has to be typed), and watch the
steps (strip metadata, segment, render, verify, gate) go green one by one as
each pipeline step returns (the stand-in renderer and fixture providers
unless live keys are set, see below). Then one card: the image, the RELEASE / REVIEW /
REFUSE badge, the gate's reasons in words, "View receipt" (opens `verify.html`
with the image hash prefilled) and a receipt download. **Publish to shop** is
there only on RELEASE; the server refuses anything else, and a publish is a
shop build, so the job is listed only if its receipt verifies.

With no model key set the page says **fixture mode**: the metadata strip, the
receipt chain and the gate are real; the render is the stand-in (the seller's
own front photo, tagged as such) and the findings are recorded as matching, not
judged by a model. The receipt says `fixture` too. On this page the live
verifier is the first one, Muse Spark Open on Baseten (`src/verifier.ts`), with
`BASETEN_API_KEY` set; `npm run serve` gives the Muse Spark 1.3 verifier no
fetch, so `VERIFIER_PROVIDER=meta` leaves the page in fixture mode, while
`npm run job:live` and the batch scripts use Muse Spark 1.3. With a live verifier the fidelity
check is the masked one of SPEC §10, and the run is live; until a segmenter
runs there is no mask, so fidelity is REVIEW and the gate can say REVIEW at
best. The segmenter becomes SAM 3.1 once `MODEL_SEGMENT` and `MODEL_API_KEY`
are set (the masks are decoded by `@meta-sam/parser`, see Dependencies); with
masks the fidelity check decodes the images (JPEG through jpeg-js, PNG in
house) and measures them. Every step's provider is listed under
"Which provider ran each step" on the page and in the `npm run serve` output.
Jobs go to `data/jobs/upload-<stamp>/` (the stripped photos under `sources/`);
`.gitignore` covers `data/jobs/upload-*/`, so a seller's photos are never
committed by a sync. Pass `--jobs <dir> --shop <dir>` for a scratch run.

`npm run job:live` (`scripts/live-job.ts`) runs the same pipeline on a
garment's intake photos from the command line, and refuses to start unless the
verifier is live. The first two live jobs committed under `data/jobs/` were
`live-kurta-01` (REFUSE: the model's answer was cut off at 1500 tokens, so the
gate saw no findings; this job ran on 28 Oct with `max_tokens` 1500, before
the limit was raised to 4096 and then to 8192 with a retry at 16384
(`docs/HISTORY.md`), see its call log
`evidence/verifier-2026-10-28T03-55-00-289Z.json`, `finish_reason` `length`) and `live-kurta-01-2` (REVIEW: all nine findings
`match` at 0.96 or above, fidelity unmeasured because no mask exists); the
second is recorded as `demo/recordings/live-kurta-01-2`.

`--render <image>` makes that file stand in for the render (still nothing
generated; the render entry's model is `file:<path>`). Three deliberate-mismatch
live jobs are committed, all **REFUSE**: `live-shirt-plaid-mismatch` (the
shirt-zebra front photo as the plaid shirt's render), `live-kurta-01-mismatch`
and `ms3-live-kurta-01-mismatch` (a re-run with that job's same render image).
In `live-kurta-01-mismatch`, kurta-01's three photos are the sources and
kurta-02's front photo is the render. The gate said **REFUSE**
(`hard_mismatch`: color mismatch at 0.99; print_pattern mismatch at 0.98 also
hard; sleeve_length and hem soft mismatches). That is three jobs on two
render swaps, not an accuracy figure.

New in this feature: `src/serve.ts`, `scripts/serve.ts`, `web/upload.html`,
`test/serve.test.ts` (the three gate states, a failing segmenter and verifier,
a non-JPEG upload, the HTTP surface, the page's CSP and strings), SPEC §12.

**Presentation (NR5, then UX-EASY1 on 1 Nov).** The upload page is two steps:
photos, then the result. Step 1 is a big drop zone for three phone photos, a
"Try with our sample shirt" button (a recorded replay, see below), an optional one-line
type note, the drawn photo guide and the EXIF-strip notice. The seller types no
attributes: the verifier (Muse Spark in a live run; recorded, not judged, in
fixture mode) reads nine attributes from the seller's photos, and the
result card shows them under "What we read from your photos", one chip per
attribute (matches / does not match / not measured) with the verifier's note,
read from the receipt's verifier entry. An upload with no note records
`garment (the seller typed no note)` as its `garment_note`; the gate rules, the
receipt format and the hash chain did not change.

**Sample button: a recorded replay, not a live run (SAMPLE1, 2 Nov).** "Try
with our sample shirt" runs nothing. It replays the committed receipt of
`data/jobs/ms2-shirt-zebra` (a live run on 29 Oct 2026 on the three committed
`shirt-zebra` photos; verifier `meta / muse-spark-1.3`, nine findings; gate
REVIEW, because no source mask was stored), from `GET /api/sample/replay`. The
card is labelled "Recorded run from 2026-10-29, not live" (Hindi: "2026-10-29
का रिकॉर्ड किया गया रन, लाइव नहीं"), and shows the receipt's own decision,
reasons and nine findings, the photos side by side, a Verify offline link
(`verify.html#sha=<image sha256>`) and the receipt download. The replay starts
no job, calls no provider and writes nothing (`test/sample-replay.test.ts`
counts zero provider calls); it offers no Correct it and no Publish. Uploading
your own photos is unchanged and runs live. The earlier three-step form
(one typed field per attribute) is gone; the 29 Oct browser check below was
made on that form. Under the chips, an optional "Something wrong? Correct it"
link (UX-EASY2) opens the nine attributes as toggles (matches / does not match
/ not sure) and one optional line. Saving stores the correction outside the
hash chain, the way listing copy lives in `data/copy`: one record per save in
`data/corrections/<job>.json` (`npm run serve -- --corrections <dir>` moves
it), naming the receipt head it refers to. It is never a receipt entry and never
a gate input, so the receipt bytes and the decision stay exactly as they were
(tested in `test/serve.test.ts`); the page says so in English and Hindi. No one
reviews corrections; the file only keeps what the seller said, and
`data/corrections/upload-*.json` is gitignored like the upload job folders.
The result card shows the seller's
photos beside the result with the render-method badge read from the receipt.
`http://127.0.0.1:8787/judge` is the judge view: a job picker (last 20 jobs
under `--jobs`, with RELEASE / REVIEW / REFUSE counts), the pipeline for that
job (for the render picked, when a job has several), input vs result, the gate chip with each reason (attribute, verdict,
hard/soft, evidence boxes over the photos), and the receipt as a timeline with
**Verify chain**, a download, and a tamper demo that checks a copy with one
byte changed and never touches the stored file. Every name on it comes from
the job's receipt (`src/present.ts`): SAM 3.1 only with a `segments` entry
that records it, Muse Spark Open only with a `verifier` entry, the Pruna
try-on only with a generative `render` entry; a step with no entry says
UNVERIFIED. Source photos are served only when a file's bytes hash to the
receipt's recorded sha256 (`--garments`, default `data/garments`); when no
file matches, the page shows "We don't have this source file here, but its
hash is recorded."
If `/judge` answers 404, an older `npm run serve` from before NR5 is still
holding port 8787 (seen 29 Oct 00:05, Grok's screenshot run): stop it, or
start this one with `npm run serve -- --port 8788`. Loaded in a real
browser on 29 Oct (Chromium, fixture mode, an upload of the kurta-01
photos): every step, the side-by-side, "Verify chain" (chain intact, 7
entries) and "Tamper demo" (broken at entry 1, stored receipt unchanged).
The inline scripts are also parse-checked in `test/present.test.ts`.

## Providers

Only environment variable names are listed here. Values are never printed or
committed.

- `RENDER_PROVIDER`: `openai-images` (the default of `rendererFromEnv` in
  `src/render.ts`), `fal`, `meta`, `stand-in` or `composite`. `npm run serve`
  and `npm run job:live` default to `stand-in` (`src/serve.ts`). `openai-images`,
  `fal` and `meta` need an injected transport today (none is written, see
  below): in `npm run serve` and `npm run job:live` every render from them is
  refused (`render_failed`), so none of them works out of the box. `MODEL_RENDER` sets the model. `openai-images` defaults to
  `gpt-image-1`, and `fal` and `meta` require it. `stand-in` generates nothing:
  it returns the owner's own front photo and records `owner-photo` as its
  model; any other `MODEL_RENDER` with it is refused (`src/render.ts`).
  `composite` (`src/composite.ts`, model `composite-v1`) generates nothing
  either: it warps the SAM-masked garment from the front photo onto the
  `mannequin-01` template, and with no mask the scene is refused
  (`render_failed`); shop cards from it say "Composite: your garment photo on
  a mannequin. Not AI-generated." `composite` v2 (`src/composite-v2.ts`,
  model `composite-v2`, the default) uses no template; its cards say
  "Composite: your garment photo on a studio backdrop, lighting adjusted
  within recorded bounds. Not AI-generated. UNVERIFIED for camera." When
  white balance is skipped (a coloured garment), the receipt note and the
  shop panel say "Lighting only: no colour correction was applied".
- `PROOFSHOT_RENDER=replicate-pruna-tryon` (NR4, `src/render-replicate.ts`):
  an AI preview by Pruna p-image-try-on on Replicate (third-party, non-Meta).
  All <!--f:tryon_all_total-->12<!--/f--> committed try-on images were held by the gate (<!--f:tryon_all_refuse-->10<!--/f--> REFUSE,
  <!--f:tryon_all_review-->2<!--/f--> REVIEW, none released; <!--f:tryon_total-->7<!--/f--> kurta jobs 28–29 Oct, <!--f:tryon_run31_total-->5<!--/f--> in the 31 Oct run): for the long kurtas the try-on came back shorter,
  and the fidelity check or the verifier caught it. The run-by-run log (NR4 to
  NR4d) is in `docs/HISTORY.md`. Since NR4e each
  model folder declares how far down the model's own outfit reaches
  (`model.json` `covers`: synthetic-01 `hip`, synthetic-02 `ankle`). A garment
  claimed longer than that falls back to composite v2 with `fallback_reason`
  `model_too_short` before any paid call. Since NR6 this is enforced in code,
  not only a demo choice: a garment claimed to reach the knee or further (NR6b) gets
  composite v2 (`render_choice_reason: long_garment_default` on the receipt)
  and reaches the try-on only with `PROOFSHOT_TRYON_LONG=1`. It
  sends the SAM 3.1 garment cut-out (seller pixels only) and
  a synthetic model image from `data/models/<id>/` with its `LICENSE.md`
  (default `synthetic-02`, an AI-generated fictional adult made during the
  event, 28 Oct, 04d9cd0; `REPLICATE_MODEL_IMAGE` picks another;
  `synthetic-01` remains only as the model named in the try-on receipts
  committed on 28 Oct (kurtas) and 31 Oct (shirts) and in Space jobs made
  before 2 Nov). The render entry's `input` records
  exactly the fields sent (images by sha256, seed, the prompt when one was
  sent, and `preserve_input_size` only when
  `REPLICATE_PRESERVE_INPUT_SIZE` is `true` or `false`; `reference_pose` is
  never sent, since Pruna types it as an image input) and carries no pipeline `prompt`. The token is read from `REPLICATE_API_TOKEN` only. Meta did
  not draw the image: SAM 3.1 (cut-out and fidelity masks), Muse Spark (the
  verifier) and the ProofShot gate decide what is released, with thresholds
  unchanged. The receipt says `generative: true` and "AI preview: look only".
  No token, no model image, no mask, a spend ledger past 5 USD
  (`%LOCALAPPDATA%\ProofShot\replicate-ledger.json`, outside the repo), or two
  failed or timed-out attempts (120 s each) fall back to composite v2, and the
  render entry then names the composite with `fallback_reason`. The input
  fields sent were checked against the model's API schema before the live call
  (Grok, 44576a0). Pruna and Replicate data and output terms and India
  availability are UNVERIFIED.
- **Muse Image is refused on every provider**, before any request. The policy
  reason (Meta's Geographic Use Policy excluding India) is UNVERIFIED here: no
  copy or quote of the policy page is committed. The renderer is checked when it is built
  and again before each request (`src/render.ts`). Muse Image is the only
  model refused by policy; the `openai-images`, `fal` and `meta` render
  transports are a separate gap: they are not written yet (see
  `RENDER_PROVIDER` above). ProofShot itself works for sellers anywhere.
- `MODEL_API_KEY`: the Meta Model API key for SAM 3.1 segmentation
  (`src/sam-meta.ts`, `POST https://api.meta.ai/v1/responses`, request model
  `sam-3.1`). `MODEL_SEGMENT` must be `meta/sam-3.1 (api.meta.ai)` for that
  transport; `SEGMENT_PROMPT` overrides the noun phrase (default "the
  garment"). SAM calls in the evidence pack are logged under
  `evidence/sam-*.json`, and the 30-31 Oct run calls under `evidence/<run>/logs/`.
- `VERIFIER_PROVIDER=meta` with `MODEL_API_KEY`: the verifier today, Muse
  Spark 1.3 (`muse-spark-1.3`) on the Meta Model API (`src/verifier-meta.ts`),
  used by `npm run job:live` and the live batch scripts (not by `npm run
  serve`). `MODEL_VERIFIER_META` picks another listed id.
- `BASETEN_API_KEY` (with `VERIFIER_PROVIDER` unset): the first verifier, the
  call to Muse Spark Open (`meta-models/muse-spark-open-1026`) on Baseten
  (`src/verifier.ts`, one chat completion per render with the photos as
  `image_url` parts); also what `npm run call:baseten` uses.
  `MODEL_VERIFIER` overrides the model id.
- `FIREWORKS_API_KEY`: the plain-language receipt summary and listing copy
  (`npm run copy:fireworks -- <job>`, `src/fireworks-copy.ts`), written by
  Meta's `accounts/fireworks/models/muse-spark-open` on Fireworks from facts
  already in the receipt and the seller's note, stored in `data/copy/`, never
  in the hash chain. `FIREWORKS_MODEL` overrides the model id. Llama 3.3 70B
  is not served to this key (404; call log
  `evidence/fireworks-2026-10-29T04-39-45-711Z.json`, cfaa582), so no text here is from Llama. An
  answer that drops, changes or softens the gate's decision word, or is cut
  off, is not used: the record holds the template text and says why.
- Spend caps (CAP1 / CAP1b, 29 Oct, enforced in code with a ledger entry per
  call, one ledger per account in `%LOCALAPPDATA%\ProofShot`; `npm run ledger`
  prints spent, batch left and reserve left; "spent" is the sum of the
  ledger's per-call estimates, not a provider bill). A batch stops at the cap; the
  reserve above it is for the live judge demo and re-runs and is spent only
  by a call made with `PROOFSHOT_USE_RESERVE=1`, never past cap + reserve.
  Fireworks: 60 USD batch + 40 reserve (`src/fireworks-copy.ts`). Meta Model
  API credit (`api.meta.ai`: SAM 3.1, Muse Spark): 80 USD batch + 70 reserve
  (`src/spend-meta.ts`). Baseten (the muse-spark-open verifier, paid from
  the Baseten account, not the Meta credit): its own ledger, 5 USD, no reserve, until a
  figure is set. Replicate 5 USD. A call over its limit is refused before it is
  sent, so the step fails closed. Prices: muse-spark-open 1.25 / 4.25 USD per
  million tokens in / out (Fireworks and Baseten pages); SAM 3.1 price
  UNVERIFIED (no source read first-hand or committed; the spend ledger uses a
  working estimate per image, `src/spend-meta.ts`).

**Built with Muse Spark.** The verifier today is Muse Spark 1.3 on the Meta Model
API (`api.meta.ai`, <!--f:muse13_calls_all-->242<!--/f--> logged calls, <!--f:muse13_calls_runs-->16<!--/f--> of them in the 30–31 Oct run logs); the first verifier was Muse Spark Open
(`meta-models/muse-spark-open-1026`) on Baseten (<!--f:baseten_calls-->19<!--/f--> logged calls). Every call
log is under `evidence/` with the key replaced and the images replaced by
their size and hash. The verifier sends `max_tokens` 8192 and asks once more
at 16384 when the answer stops at the limit; a second cut-off answer is a
REFUSE (`verifier_truncated`), never a pass. How that limit was found is in
`docs/HISTORY.md`.

The HTTP transports for `openai-images`, `fal` and `meta` are not written yet.
The renderer takes an injected transport.

## Dependencies and datasets

- Runtime: two packages, pinned exactly. `@meta-sam/parser` 0.1.0 (Meta's
  streaming parser for SAM 3 segmentation tokens, no runtime dependencies of
  its own; glue in `src/sam-parser.ts`). Its licence is the **SAM License**
  (`node_modules/@meta-sam/parser/LICENSE`, not MIT): read it before
  redistributing anything built on it. Its full text and the jpeg-js notice
  are in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md). `jpeg-js` 0.4.4 (BSD-3-Clause), used
  only to decode JPEG photos and renders for the fidelity check
  (`src/image.ts`). Everything else uses only Node's
  standard library (`node:crypto`, `node:fs`, `node:zlib` for PNG masks,
  `node:test`).
- Development: `typescript`, `@types/node`.
- CI (`.github/workflows/ci.yml`): `actions/checkout`, `actions/setup-node`,
  `gitleaks/gitleaks-action`.
- Datasets: none. Tests use synthetic images built in code. The demo input
  will be our own garment photos under `data/garments/`, with metadata
  removed.

## Third-party licences and terms

Runtime dependencies (every entry of `dependencies` in `package.json`; each
licence is the `license` field of the installed
`node_modules/<name>/package.json`, checked against it by
`test/claims-wording.test.ts` "RV23"):

| Package | Version | Licence (from its installed package.json) |
|---|---|---|
| `@meta-sam/parser` | 0.1.0 | SEE LICENSE IN LICENSE (the SAM License, full text in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)) |
| `jpeg-js` | 0.4.4 | BSD-3-Clause |

Images: the two AI-generated sample model images carry their own terms,
[`data/models/synthetic-01/LICENSE.md`](data/models/synthetic-01/LICENSE.md)
and [`data/models/synthetic-02/LICENSE.md`](data/models/synthetic-02/LICENSE.md).

Providers (services called at run time; none of their code is in this
repository). The terms page of each is not read from a file in this
repository, so whether ProofShot's use follows each one is UNVERIFIED here:

- Baseten (Muse Spark Open): terms UNVERIFIED.
- Fireworks (muse-spark-open listing copy): terms UNVERIFIED.
- Replicate (hosts Pruna): terms UNVERIFIED.
- Pruna (`prunaai/p-image-try-on`, AI try-on candidates): terms UNVERIFIED.
- Pruna on Replicate: data and output terms and India availability
  UNVERIFIED (not a Meta model; used only for the AI try-on candidates).
- Meta Model API, `api.meta.ai` (SAM 3.1, Muse Spark 1.3): terms UNVERIFIED.
- Meta Geographic Use Policy §2.2, as quoted in the team's compliance
  register (row 18, kept in the coordination repo, not in this one): "you may
  not access that Meta Model from ... Muse Image: India". ProofShot refuses
  Muse Image at runtime (`refuseMuseImage` in `src/render.ts`,
  `test/render.test.ts`). The policy reason stays UNVERIFIED here: no copy of
  the policy page is committed.
- Muse Spark Open licence: no geographic limit found (excerpt only); full
  licence text not reviewed: UNVERIFIED.

## Evidence pack

`evidence/pack/` is built by `npm run evidence:pack` from committed material only: every receipt in `data/jobs` that has a render (one row per render in `results.csv`; the <!--f:receipts_no_render-->1<!--/f--> receipt that stopped before a render has no row, with chain check, providers, model ids and tokens), the call logs in `evidence/` (latency median and p90, and cost from logged usage, per stage), the MS4 cross-check, the calibration report and the copy. Museum samples (the Met, Rijksmuseum) are **not used**: no museum-image fetch is logged in `evidence/`, so the pack covers the 4 real garments only (`kurta-01`, `kurta-02`, `shirt-plaid`, `shirt-zebra`), not the 12 #10 first asked for. A test fails if the committed pack no longer matches the receipts. Summary: `evidence/pack/README.md`.

## What is verified and what is not

Dated experiment rows (each live run and when it happened) are in
`docs/HISTORY.md`.

| Claim | Status | Evidence |
|---|---|---|
| Test suite | <!--f:tests-->453<!--/f--> tests; CI runs them and gitleaks on every push | `npm test`; the count is written by `npm run figures` from the test files |
| Typecheck clean | yes | `npm run typecheck`, also run in CI |
| Live model calls | every call logged, key replaced: SAM 3.1 <!--f:sam_calls-->130<!--/f-->, Muse Spark 1.3 <!--f:muse13_calls-->226<!--/f--> in the pack (plus <!--f:sam_calls_runs-->47<!--/f--> SAM 3.1 and <!--f:muse13_calls_runs-->16<!--/f--> Muse Spark 1.3 in the 30–31 Oct run logs, `evidence/<run>/logs/`), muse-spark-open on Fireworks <!--f:fireworks_calls-->293<!--/f-->, Muse Spark Open on Baseten <!--f:baseten_calls-->19<!--/f-->; Llama 3.3 70B on Fireworks: <!--f:llama_calls-->6<!--/f--> calls, none answered (404), no output used; Pruna try-on (`prunaai/p-image-try-on`) on Replicate: <!--f:pruna_all_calls-->12<!--/f--> calls, about <!--f:pruna_all_usd_est-->0.180<!--/f--> USD estimated (<!--f:pruna_calls-->7<!--/f--> kurta calls on 28–29 Oct, <!--f:pruna_usd_est-->0.105<!--/f--> USD, the same as the Replicate spend ledger read on 29 Oct; the rest in the 31 Oct try-on run, after that reading) | `evidence/`, counts in `evidence/pack/summary.json`; the Pruna calls are the `replicate-pruna-tryon` render entries in `data/jobs/live-kurta-0*-tryon*` and `evidence/tryon/*/pruna/receipt.jsonl` (`attempts`, `cost_estimated_usd`, `prediction_id`) |
| Receipts | <!--f:jobs-->42<!--/f--> jobs with a render, <!--f:renders-->43<!--/f--> renders (<!--f:live_renders-->37<!--/f--> live, <!--f:fixture_renders-->6<!--/f--> fixture); <!--f:chains-->42 of 42<!--/f--> hash chains verify. With the <!--f:receipts_no_render-->1<!--/f--> job that stopped before a render, <!--f:receipts-->43<!--/f--> receipts are committed and <!--f:receipt_chains-->43 of 43<!--/f--> verify | `evidence/pack/results.csv` |
| Verifier accuracy | **not measured in general.** The Muse Spark cross-check (MS4, verifier alone, no fidelity check): <!--f:ms4_pairs-->68<!--/f--> pairs, <!--f:ms4_runs-->204<!--/f--> runs; wrong garment refused <!--f:ms4_wrong_refused-->153 of 153<!--/f-->; same garment released <!--f:ms4_same_released-->24 of 30<!--/f-->; shortened try-ons held <!--f:ms4_changed_held-->17 of 21<!--/f-->, so the verifier alone passed <!--f:ms4_changed_passed-->4 of 21<!--/f-->, and on the <!--f:tryon_total-->7<!--/f--> committed kurta try-on jobs those 21 checks were run on, the gate's fidelity check returned REVIEW or REFUSE on every one (the gate cited fidelity for 4 of the 7 and the verifier for 3); the same decision on all 3 runs for <!--f:ms4_consistent-->65 of 68<!--/f--> pairs. Four garments only | `evidence/ms4-summary.json` |
| Calibration | <!--f:cal_cases-->37<!--/f--> labelled renders (<!--f:cal_same-->18<!--/f--> same, <!--f:cal_different-->19<!--/f--> different) at the shipped thresholds: <!--f:cal_false_match-->0<!--/f--> false matches, <!--f:cal_false_refuse-->4<!--/f--> false refusals (all where the verifier gave no answer), <!--f:cal_unmeasured-->6<!--/f--> unmeasured; recorded decisions reproduced <!--f:cal_reproduced-->37 of 37<!--/f-->. A self-check, not an error rate | `evidence/calibration-jobs-2026-10-29.json` |
| Listing copy | <!--f:copy_texts-->168<!--/f--> texts (English and Hindi), <!--f:copy_model-->164<!--/f--> by muse-spark-open, <!--f:copy_template-->4<!--/f--> template | `data/copy/` |
| Verify page in a real browser | **checked, served over HTTP** (29 Oct, Chromium, WebCrypto): the real kurta-01 JPEG with its upload receipt → VALID; `fixture-shirt-01-r1.png` with its receipt → NOT RELEASED (gate REFUSE); the receipt with one character changed → TAMPERED, entry 0; another image → TAMPERED, in no entry. The CSP blocked a fetch from inside the page. From disk (`file://`): **checked in headless Edge** by `npm run demo:capture` (29 Oct, no flags that loosen security): `ms2-shirt-plaid` receipt and image → VALID, its one-byte copy → TAMPERED. Not yet checked from disk in a normal browser window: the in-app browser used for the HTTP check shows `file://` pages outside its project as a static snapshot | also tested in Node against the same core |
| Seller upload page in a real browser | **checked** (29 Oct, Chromium, fixture mode, keys blanked, jobs and shop in scratch folders): three kurta-01 photos through the 3-step form (the 29 Oct page, before UX-EASY1 made it two steps: Photos, Result; this row does not cover the two-step page), every pipeline step shown, RELEASE, receipt and judge links, Publish, the shop shows the item with the badge, Hindi toggle (`lang="hi"`). Photos were handed to the file input in-page (the browser pane has no OS file picker). Found and fixed: with `--shop <dir>` the shop page read `web/shop`, so a published item never appeared; `/shop/...` is now served from `--shop` (`test/serve.test.ts`) | `test/serve.test.ts`; no live model was called |
| Two-step upload page (Photos, Result) in a real browser | **UNVERIFIED**: no real-browser check of the current two-step page is committed (the 29 Oct check above was the 3-step page and is not borrowed) | `test/serve.test.ts` and the upload page tests run in Node only |
| Public repo | public since 28 Oct 2026 (history scan clean: one fake test key in 6c6837f, no EXIF/GPS, no phone number; since the 30 Oct history re-authoring every commit's author and committer email is a GitHub noreply address, see the history note below and `docs/HISTORY.md`) | made public by Manish on 28 Oct after the history scan |

## Built during the event

**All of ProofShot's code was written during the event, from 27 Oct 2026 (first commit [`15658a4`](https://github.com/rmanish2000-del/proofshot-hackathon/commit/15658a495f0f7469cc1de6fe025fec3bd7cf327e), 11:10 IST; the hackathon opened 26 Oct 2026, 21:30 IST).** The gate, the receipt chain, the verify page, the pipeline and the upload, judge and shop pages are all code in this repository. Disclosed prior work, listed below: the written specification the code was rewritten from (pre-event text published unchanged in `docs/prior-work/`), two config files (`tsconfig.json`, `.gitignore`), and one AI-generated sample model image (`synthetic-01`, used only in try-on runs committed on 28 and 31 Oct and in Space jobs made before 2 Nov; the final demo uses `synthetic-02`, made 28 Oct, during the event). An earlier private prototype's code is not in this repository.

Work in this repository starts with its first commit, [`15658a4`](https://github.com/rmanish2000-del/proofshot-hackathon/commit/15658a495f0f7469cc1de6fe025fec3bd7cf327e), on
27 Oct 2026 at 11:10 IST, after the hackathon opened on 26 Oct 2026 at 21:30
IST. `git log` has no commit dated before it. Prior work: a written
specification; two config files (`tsconfig.json`, `.gitignore`); one
AI-generated synthetic model image (`data/models/synthetic-01/model.png`,
generated 23 Oct 2026 for MirrorOS, a fictional adult, see its LICENSE.md),
used only in try-on runs committed on 28 and 31 Oct and in Space jobs made
before 2 Nov (new jobs use `synthetic-02`, made during the event); and
an earlier private prototype (`rmanish2000-del/proofshot`, 24–26 Oct; tag
`pre-hackathon-baseline`, 1485431) whose code is not in this repository: the
code here was rewritten from the specification from 27 Oct, not copied. Each
is listed below.

History note: on 30 Oct 2026 the commit history was re-authored to replace a personal email address in the author and committer fields with a GitHub noreply address. Names, dates, messages and file contents are unchanged, but every commit hash changed (the first commit was 4aa99f9 before, 15658a4 now); the hashes cited in this repository's documents are the new ones.

### Prior work used

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
- One AI-generated synthetic model image,
  [`data/models/synthetic-01/model.png`](data/models/synthetic-01/LICENSE.md):
  a fictional adult, generated from text only on 23 Oct 2026, before the
  event, for MirrorOS (`google/nano-banana` on Replicate); provenance and terms
  in its `LICENSE.md`. It is a try-on model image, not code. It is named only
  by the try-on receipts committed on 28 Oct (`data/jobs/live-kurta-01-tryon`,
  `live-kurta-02-tryon`, `live-kurta-02-tryon-2`) and 31 Oct (the two shirts in
  `evidence/tryon/`) and by Space jobs made before 2 Nov; since SYN2 the
  default is `synthetic-02` (`data/models/synthetic-02/`, made 28 Oct, during
  the event).
- The earlier private prototype (`rmanish2000-del/proofshot`, 24–26 Oct 2026;
  tag `pre-hackathon-baseline`, 1485431): its code is not in this repository.
  The code here was rewritten from the specification from 27 Oct, not copied.

The demo and every committed receipt use only the code in this repository and
the hosted models named above (SAM 3.1 and Muse Spark 1.3 on
`api.meta.ai`, Muse Spark Open on Baseten, muse-spark-open on Fireworks, Pruna
on Replicate).

## License

MIT, see [LICENSE](LICENSE).
