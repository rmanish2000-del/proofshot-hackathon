# ProofShot (hackathon build)

ProofShot checks a candidate listing image against the seller's own phone
photos of the garment (three or four of them) before the image goes on sale. A
verifier model compares the garment attribute by attribute. A deterministic
code gate, not the model, then decides **RELEASE**, **REVIEW** or **REFUSE**
from those structured findings and a fidelity check, measured on the garment
masks when measurable. In a live run a missing measurement fails closed: the
fidelity check (`src/fidelity.ts`) gives REVIEW at best and says why on the
receipt. A fixture run (no keys) has a stub fidelity check that measures
nothing and returns RELEASE with `"metrics":null`; its receipt says provenance
`fixture` (example below). Every step from intake to the gate decision is
written into a hash-chained receipt that anyone can check offline in
`web/verify.html`: a single page that makes no network request and needs no
account (checked in Chromium over local HTTP, and opened from disk (`file://`)
in headless Edge by the demo capture).

The candidate images in the committed runs come from two paths. The composite
path cuts the seller's own garment pixels out with a SAM 3.1 mask and places
them on a ghost mannequin, in deterministic code. The try-on path is an AI
try-on (Pruna on Replicate). No Meta image generator is used anywhere, and
Muse Image is refused at runtime. No committed run has released a generated
on-model photo: all <!--f:tryon_total-->7<!--/f--> try-on images were held by the gate (<!--f:tryon_refuse-->5<!--/f--> REFUSE, <!--f:tryon_review-->2<!--/f-->
REVIEW). The verifier alone would not have held them all: in the Muse Spark
cross-check it passed <!--f:ms4_changed_passed-->4 of 21<!--/f--> checks of those shortened try-ons; the measured
fidelity check is what held every one.

That is why the demo video shows no AI on-model image: every committed
try-on receipt (<!--f:tryon_total-->7<!--/f-->, <!--f:tryon_review-->2<!--/f--> REVIEW and <!--f:tryon_refuse-->5<!--/f--> REFUSE) is a kurta job held by
the gate, the demo shows the two shirts only, and there is no shirt try-on.
No new paid call was made for the video (`docs/DEMO.md`,
`test/demo-capture.test.ts`).

## What each Meta model does

| Model | Served by | What it does in ProofShot | Logged calls (committed) |
|---|---|---|---|
| SAM 3.1 (`meta/sam-3.1`) | Meta Model API, `api.meta.ai` | Garment segmentation: the mask the composite cuts out and the fidelity check measures on | <!--f:sam_calls-->130<!--/f-->, `evidence/sam-*.json` |
| Muse Spark 1.3 (`muse-spark-1.3`) | Meta Model API, `api.meta.ai` | Verifier only: per-attribute findings (colour, print, collar, sleeves, hem, pockets, buttons, logo, texture; gate keys `color`, `print_pattern`, `collar`, `sleeve_length`, `hem`, `pocket_count`, `buttons`, `logo_text`, `fabric_texture`) that the gate reads. It never decides and never makes an image | <!--f:muse13_calls-->226<!--/f-->, `evidence/verifier-*.json`, `evidence/ms4/` |
| muse-spark-open (`accounts/fireworks/models/muse-spark-open`) | Fireworks | English and Hindi listing copy and plain-language receipt summaries, written after the gate from the receipt; the text never enters the chain | <!--f:fireworks_calls-->293<!--/f-->, `evidence/fireworks-*.json`, texts in `data/copy/` |
| Muse Spark Open (`meta-models/muse-spark-open-1026`) | Baseten | The first verifier, before the Meta Model API one: its calls are logged from 28 Oct 09:25 IST to 29 Oct 06:13 IST. Two earlier `npm run call:baseten` smoke calls (27 Oct 18:53 IST, 28 Oct 06:21 IST, `evidence/baseten-*.json`) asked for one word and are not verifier calls | <!--f:baseten_calls-->19<!--/f-->, `evidence/verifier-*.json` |

Counts are from `evidence/pack/summary.json` (`npm run evidence:pack`).

## Limits

- **Small sample.** <!--f:garments-->4<!--/f--> real garments (two women's kurtas, two shirts), all
  from one household. Every rate in this README describes those pairs, not
  ProofShot in general.
- **Verifier accuracy is not measured in general.** The Muse Spark cross-check
  (MS4) refused <!--f:ms4_wrong_refused-->153 of 153<!--/f--> wrong-garment runs and released <!--f:ms4_same_released-->24 of 30<!--/f-->
  same-garment runs, on these four garments only.
- **The verifier misses length changes.** On its own it passed <!--f:ms4_changed_passed-->4 of 21<!--/f-->
  checks of try-ons that had shortened the garment; the gate held all of them
  only because the fidelity check measured the garment shrinking in frame.
- **Thresholds are provisional.** Calibration over the committed receipts finds
  <!--f:cal_false_match-->0<!--/f--> false matches and <!--f:cal_false_refuse-->4<!--/f--> false refusals, all of them where the verifier gave no
  answer; that is a self-check on few garments, not an error rate.
- **No generated on-model photo has been released**, and nothing here claims an
  effect on returns or sales. No public deploy.

## Quick start

Node 22.6 or later.

```
npm install
npm test             # the whole suite, offline: no network, no keys
npm run typecheck
npm run page         # rewrites the inlined core in web/verify.html from src/core.js
npm run intake -- <folder>   # garment photos in: strips metadata, records both hashes
npm run call:baseten         # one live Muse Spark Open call, logged to evidence/
```

Of these, `npm run call:baseten` is the only command that makes a live model
API call, and it needs `BASETEN_API_KEY` set.

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
`data/jobs` (provenance `live`); every job in the demo video is one of those.

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
see the seller upload page with the five-step board: metadata, segment, render,
verify, gate. Each result card shows a RELEASE, REVIEW or REFUSE badge, reasons,
and a **View receipt** link. The seller upload page is local only
(`npm run serve`) and visually UNVERIFIED. Each ProofShot result has a hash-chained
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

### Optional: live providers

You do not need these for the quickstart. Without them, every provider is a
fixture and the run is fixture mode.

- Live verifier: Muse Spark Open on Baseten: set env var `BASETEN_API_KEY` (do not put a key value here).
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

`receipt.jsonl`, one entry per line, append-only:

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

The chain catches an edited, reordered or deleted entry. It does not stop
someone from rewriting the whole file from entry 0, because there is no
signature or outside witness (`docs/SPEC.md` §3, threat model).

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
the committed live jobs; no generative render transport exists (SPEC §8).
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
login: drop up to three JPEGs of one garment, say what it is, and watch the
steps (strip metadata, segment, render, verify, gate) go green one by one as
the providers actually return. Then one card: the image, the RELEASE / REVIEW /
REFUSE badge, the gate's reasons in words, "View receipt" (opens `verify.html`
with the image hash prefilled) and a receipt download. **Publish to shop** is
there only on RELEASE; the server refuses anything else, and a publish is a
shop build, so the job is listed only if its receipt verifies.

With no model key set the page says **fixture mode**: the metadata strip, the
receipt chain and the gate are real; the render is the stand-in (the seller's
own front photo, tagged as such) and the findings are recorded as matching, not
judged by a model. The receipt says `fixture` too. With `BASETEN_API_KEY` set
the verifier is Muse Spark Open on Baseten (`src/verifier.ts`), the fidelity
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
gate saw no findings) and `live-kurta-01-2` (REVIEW: all nine findings
`match` at 0.96 or above, fidelity unmeasured because no mask exists); the
second is recorded as `demo/recordings/live-kurta-01-2`.

`--render <image>` makes that file stand in for the render (still nothing
generated; the render entry's model is `file:<path>`). One deliberate-mismatch
live job is committed: `live-kurta-01-mismatch`, kurta-01's three photos as
sources and kurta-02's front photo as the render. The gate said **REFUSE**
(`hard_mismatch`: color mismatch at 0.99; print_pattern mismatch at 0.98 also
hard; sleeve_length and hem soft mismatches). That is one job (n=1), not an
accuracy figure.

New in this feature: `src/serve.ts`, `scripts/serve.ts`, `web/upload.html`,
`test/serve.test.ts` (the three gate states, a failing segmenter and verifier,
a non-JPEG upload, the HTTP surface, the page's CSP and strings), SPEC §12.

**Presentation (NR5).** The upload page is now three steps (photos with a
drawn photo guide and the EXIF-strip notice; the claimed attributes, one field
per gate attribute; review and submit), and the result card shows the seller's
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

- `RENDER_PROVIDER`: `openai-images` (the default), `fal`, `meta` or
  `stand-in`. `MODEL_RENDER` sets the model. `openai-images` defaults to
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
  All <!--f:tryon_total-->7<!--/f--> committed try-on calls were held by the gate (<!--f:tryon_refuse-->5<!--/f--> REFUSE,
  <!--f:tryon_review-->2<!--/f--> REVIEW, none released): for the long kurtas the try-on came back shorter,
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
  (default `synthetic-01`, an AI-generated fictional adult, 3e852fd;
  `REPLICATE_MODEL_IMAGE` picks another). The render entry's `input` records
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
  (Grok, 14dad54). Pruna and Replicate data and output terms and India
  availability are UNVERIFIED.
- **Muse Image is refused on every provider**, before any request (Meta's
  Geographic Use Policy excludes India). The renderer is checked when it is built
  and again before each request (`src/render.ts`).
- `MODEL_API_KEY`: the Meta Model API key for SAM 3.1 segmentation
  (`src/sam-meta.ts`, `POST https://api.meta.ai/v1/responses`, request model
  `sam-3.1`). `MODEL_SEGMENT` must be `meta/sam-3.1 (api.meta.ai)` for that
  transport; `SEGMENT_PROMPT` overrides the noun phrase (default "the
  garment"). Every SAM call is logged under `evidence/sam-*.json`.
- `BASETEN_API_KEY`: the verifier call to Muse Spark Open
  (`meta-models/muse-spark-open-1026`) on Baseten (`src/verifier.ts`, one
  chat completion per render with the photos as `image_url` parts).
  `MODEL_VERIFIER` overrides the model id.
- `FIREWORKS_API_KEY`: the plain-language receipt summary and listing copy
  (`npm run copy:fireworks -- <job>`, `src/fireworks-copy.ts`), written by
  Meta's `accounts/fireworks/models/muse-spark-open` on Fireworks from facts
  already in the receipt and the seller's note, stored in `data/copy/`, never
  in the hash chain. `FIREWORKS_MODEL` overrides the model id. Llama 3.3 70B
  is not served to this key (404, 3097a7b), so no text here is from Llama. An
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
  million tokens in / out (Fireworks and Baseten pages); SAM 3.1 2.50 USD per
  1000 images (secondary sources, not read on dev.meta.ai).

**Built with Muse Spark.** The verifier today is Muse Spark 1.3 on the Meta Model
API (`api.meta.ai`, <!--f:muse13_calls-->226<!--/f--> logged calls); the first verifier was Muse Spark Open
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
  redistributing anything built on it. `jpeg-js` 0.4.4 (BSD-3-Clause), used
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

## Evidence pack

`evidence/pack/` is built by `npm run evidence:pack` from committed material only: every receipt in `data/jobs` (one row per render in `results.csv`, with chain check, providers, model ids and tokens), the call logs in `evidence/` (latency median and p90, and cost from logged usage, per stage), the MS4 cross-check, the calibration report and the copy. Museum samples (the Met, Rijksmuseum) are **not used**: no museum-image fetch is logged in `evidence/`, so the pack covers the 4 real garments only (`kurta-01`, `kurta-02`, `shirt-plaid`, `shirt-zebra`), not the 12 #10 first asked for. A test fails if the committed pack no longer matches the receipts. Summary: `evidence/pack/README.md`.

## What is verified and what is not

Dated experiment rows (each live run and when it happened) are in
`docs/HISTORY.md`.

| Claim | Status | Evidence |
|---|---|---|
| Test suite | <!--f:tests-->348<!--/f--> tests; CI runs them and gitleaks on every push | `npm test`; the count is written by `npm run figures` from the test files |
| Typecheck clean | yes | `npm run typecheck`, also run in CI |
| Live model calls | every call logged, key replaced: SAM 3.1 <!--f:sam_calls-->130<!--/f-->, Muse Spark 1.3 <!--f:muse13_calls-->226<!--/f-->, muse-spark-open on Fireworks <!--f:fireworks_calls-->293<!--/f-->, Muse Spark Open on Baseten <!--f:baseten_calls-->19<!--/f-->; Llama 3.3 70B on Fireworks: <!--f:llama_calls-->6<!--/f--> calls, none answered (404), no output used; Pruna try-on (`prunaai/p-image-try-on`) on Replicate: <!--f:pruna_calls-->7<!--/f--> calls, about <!--f:pruna_usd_est-->0.105<!--/f--> USD estimated, the same as the Replicate spend ledger | `evidence/`, counts in `evidence/pack/summary.json`; the Pruna calls are the `replicate-pruna-tryon` render entries in `data/jobs/live-kurta-0*-tryon*` (`attempts`, `cost_estimated_usd`, `prediction_id`) |
| Receipts | <!--f:jobs-->42<!--/f--> jobs, <!--f:renders-->43<!--/f--> renders (<!--f:live_renders-->37<!--/f--> live, <!--f:fixture_renders-->6<!--/f--> fixture); <!--f:chains-->42 of 42<!--/f--> hash chains verify | `evidence/pack/results.csv` |
| Verifier accuracy | **not measured in general.** The Muse Spark cross-check (MS4, verifier alone, no fidelity check): <!--f:ms4_pairs-->68<!--/f--> pairs, <!--f:ms4_runs-->204<!--/f--> runs; wrong garment refused <!--f:ms4_wrong_refused-->153 of 153<!--/f-->; same garment released <!--f:ms4_same_released-->24 of 30<!--/f-->; shortened try-ons held <!--f:ms4_changed_held-->17 of 21<!--/f-->, so the verifier alone passed <!--f:ms4_changed_passed-->4 of 21<!--/f-->, and the gate's fidelity check is what held those try-ons; the same decision on all 3 runs for <!--f:ms4_consistent-->65 of 68<!--/f--> pairs. Four garments only | `evidence/ms4-summary.json` |
| Calibration | <!--f:cal_cases-->37<!--/f--> labelled renders (<!--f:cal_same-->18<!--/f--> same, <!--f:cal_different-->19<!--/f--> different) at the shipped thresholds: <!--f:cal_false_match-->0<!--/f--> false matches, <!--f:cal_false_refuse-->4<!--/f--> false refusals (all where the verifier gave no answer), <!--f:cal_unmeasured-->6<!--/f--> unmeasured; recorded decisions reproduced <!--f:cal_reproduced-->37 of 37<!--/f-->. A self-check, not an error rate | `evidence/calibration-jobs-2026-10-29.json` |
| Listing copy | <!--f:copy_texts-->168<!--/f--> texts (English and Hindi), <!--f:copy_model-->164<!--/f--> by muse-spark-open, <!--f:copy_template-->4<!--/f--> template | `data/copy/` |
| Verify page in a real browser | **checked, served over HTTP** (29 Oct, Chromium, WebCrypto): the real kurta-01 JPEG with its upload receipt → VALID; `fixture-shirt-01-r1.png` with its receipt → NOT RELEASED (gate REFUSE); the receipt with one character changed → TAMPERED, entry 0; another image → TAMPERED, in no entry. The CSP blocked a fetch from inside the page. From disk (`file://`): **checked in headless Edge** by `npm run demo:capture` (29 Oct, no flags that loosen security): `ms2-shirt-plaid` receipt and image → VALID, its one-byte copy → TAMPERED. Not yet checked from disk in a normal browser window: the in-app browser used for the HTTP check shows `file://` pages outside its project as a static snapshot | also tested in Node against the same core |
| Seller upload page in a real browser | **checked** (29 Oct, Chromium, fixture mode, keys blanked, jobs and shop in scratch folders): three kurta-01 photos through the 3-step form, every pipeline step shown, RELEASE, receipt and judge links, Publish, the shop shows the item with the badge, Hindi toggle (`lang="hi"`). Photos were handed to the file input in-page (the browser pane has no OS file picker). Found and fixed: with `--shop <dir>` the shop page read `web/shop`, so a published item never appeared; `/shop/...` is now served from `--shop` (`test/serve.test.ts`) | `test/serve.test.ts`; no live model was called |
| Public repo | public since 28 Oct 2026 (history scan clean: one fake test key in 115c3ba, no EXIF/GPS, no phone number; author email is the noreply address from 28 Oct) | made public by Manish on 28 Oct after the history scan |

## Built during the event

Work in this repository starts with its first commit, [`4aa99f9`](https://github.com/rmanish2000-del/proofshot-hackathon/commit/4aa99f9ab9989dcc4705a0980f8660c0c9263f95), on
27 Oct 2026 at 11:10 IST, after the hackathon opened on 26 Oct 2026 at 21:30
IST. `git log` has no commit dated before it. The prior work used is
`docs/SPEC.md` and the config boilerplate only (below); the code was written
here from that specification.

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

The demo and every committed receipt use only the code in this repository and
the hosted models named above (SAM 3.1 and Muse Spark 1.3 on
`api.meta.ai`, Muse Spark Open on Baseten, muse-spark-open on Fireworks, Pruna
on Replicate).

## License

MIT, see [LICENSE](LICENSE).
