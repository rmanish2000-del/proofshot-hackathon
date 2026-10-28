# ProofShot (hackathon build)

A boutique takes three or four phone photos of a garment and gets on-model
product photos back. Every photo comes with a receipt: a hash-chained record of
what was segmented, rendered and checked, and why it was released, sent for
review or refused. The models do the work, but they don't decide what ships. A
deterministic code gate does, from structured findings only, and the receipt
can be checked offline by anyone holding it.

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

`npm run call:baseten` is the only command that uses the network, and it needs
`BASETEN_API_KEY` set.

## Judge quickstart

No API keys are needed. Without keys the run is **fixture mode**; the page and
receipt are labelled as such. The render step shows the owner's photo as a
stand-in; nothing is generated.

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
(`npm run serve`) and visually UNVERIFIED. Each image ships with a hash-chained
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
Title cards (S1, S11), the replay's terminal lines (S4) and the tampered byte
(S5, S7) are plain pages it writes from committed files. `out/demo/shots.json`
gives each shot's seconds (under 115 s in total) and `out/demo/frames.txt` is
an ffmpeg concat list of the 1280 px frames; the video is assembled from it
elsewhere, the script runs no ffmpeg. `out/demo/captions.srt` (DEMO1c) is the
subtitle track for the muted cut: one cue per narrated shot, the `docs/DEMO.md`
voiceover verbatim, timed from the same seconds (a line still marked TBD gets no
cue). No upload, no publish, no live call, no key read. `npm run demo:stage`
(DEMO1d) then copies the 1280 px frames, shots.json, frames.txt and captions.srt
to `%LOCALAPPDATA%\ProofShotStaging\demo\<UTC timestamp>\` (or `-- --to <dir>`)
with a `manifest.json` of each file's sha256 and size; frames.txt names bare
files, so it works there as is. Nothing staged is committed.

6. Optional: keep generated jobs out of tracked folders:

```bash
npm run serve -- --jobs out/ui-jobs --shop out/ui-shop
```

### Live jobs and calibration (28 Oct 13:50 IST)

- Live VERIFIER: Muse Spark Open on Baseten (`meta-models/muse-spark-open-1026`), one chat completion per render, per-attribute findings.
- Live SEGMENTER: SAM 3.1 on `api.meta.ai`; every SAM call in `job:live` writes a redacted call log.
- JPEG decode is wired, so fidelity is measured on JPEG.
- Renders: the `sam` jobs below used the stand-in (the owner's front photo, tagged "owner's photo, stands in for render"), so a RELEASE on them is photo-vs-itself and proves the measured path runs, NOT accuracy. Since NR1 (6beed3a) `RENDER_PROVIDER=composite` places the SAM-cut garment from the seller's front photo onto the code-drawn `mannequin-01` template (homography warp, feathered edge); the receipt says `method: composite`, `generative: false`, and a missing mask is a REFUSE, never a fall-back to the stand-in. No image model is called, nothing is generated, and no person is in frame.
- Live composite jobs (0e12a5e): `live-kurta-02-composite` RELEASE (2 SAM segments, verifier 9 of 9 `match`, fidelity on the warped source mask delta_e 0.19); `live-kurta-01-composite` REFUSE `not_verified`, because the verifier answer was cut off at max_tokens 4096. NR2 (8d0b72b) retries a cut-off answer once and refuses a second one as `verifier_truncated`; the kurta-01 re-run `live-kurta-01-composite-r2` (9e08fee, on eb09bc3) is RELEASE, verifier finish_reason stop in one attempt. The composite is the same photo's pixels on a new background, so these too show the measured path, not accuracy on a generated image.
- Composite v2 (NR3, SPEC-composite-v2, `src/composite-v2.ts`, model `composite-v2`, now the default for `RENDER_PROVIDER=composite`; `COMPOSITE_VERSION=v1` or `RENDER_TEMPLATE` keeps v1): a "ghost mannequin" product shot, 1200x1600, with no body template. The mask is cleaned, lighting is flattened and white balance adjusted by bounded, recorded amounts (max ±8% per colour channel, shadow gain 0.80 to 1.35), a flat neck insert fills the neck opening, and the garment gets a soft shadow on a studio backdrop. Fidelity checks compare against the seller's original photo. A photo that fails the quality pre-check (cut off, too small, harsh shadow, clipped, fragmented mask, correction ΔE above 6) is REVIEW (`render_quality`) with the reason and every check on the receipt, and no image. Run offline on the committed SAM masks, both kurta front photos are REVIEW "over- or under-exposed photo" (clipped 7.7% and 4.7% against 3%; kurta-01 also shadow 0.64 against 0.55), so no v2 image exists yet; a retake per `docs/CAPTURE.md` is the fix, not looser thresholds. Thresholds are provisional (UNVERIFIED). Any v2 image is UNVERIFIED for camera until Manish signs it off.
- Verifier accuracy NOT MEASURED.
- Absent or undefined verifier findings fail closed as `REFUSE not_verified`, the same as a verifier that failed.
- Live jobs on `kurta-01`: `REFUSE not_verified` (first answer cut off), `REVIEW` (no mask), `REFUSE mismatch` (kurta-02 front as the render, colour hard mismatch, n=1), `live-kurta-01-sam` (3 segments 0.957/0.949/0.973, gate `REVIEW`, fidelity could not decode JPEG then), and `live-kurta-01-sam-2` (4 logged SAM calls, verifier matched, fidelity measured, gate `RELEASE`).
- Live job `live-kurta-02-sam` on `kurta-02`: 3 logged SAM 3.1 calls and 1 logged verifier call, gate `RELEASE`, but the render is the stand-in kurta-02 front photo so it is photo-vs-itself and proves the measured path, not accuracy.
- Calibration (fidelity only, not a gate decision) has SAM masks for 5 of 5 photos of two garments and measured 20 of 20 photo pairs, including the different-garment pairs: at the current thresholds 0 false matches and 6 of 8 same-garment pairs refused; at 1.5x looser 0 false matches, 0 false refusals, 2 same-garment pairs sent to review. Only two garments, so this is a small sample, not a calibrated false-match rate; thresholds are unchanged.
- No public deploy.

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

The chain catches an edited, reordered or deleted entry. It does not stop
someone from rewriting the whole file from entry 0, because there is no
signature or outside witness (`docs/SPEC.md` §3, threat model).

## Verify page

`web/verify.html` is one self-contained file. Open it from disk. It works offline: a
Content-Security-Policy of `default-src 'none'` blocks every request. Give it a
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
Pre-existing (rebuilt from the spec earlier in this repo, not part of this
feature): the gate, the receipt chain, the verify-page core (`src/core.js`
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
verifier is live. Two live jobs are committed under `data/jobs/`:
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
start this one with `npm run serve -- --port 8788`. Not yet
loaded in a real browser: the inline scripts are parse-checked in
`test/present.test.ts`, and no screenshots exist.

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
  **Seven live Pruna calls as of ace95ac (n=7): two REVIEW, five REFUSE,
  none released; the gate caught every one.** First (14dad54, `data/jobs/live-kurta-02-tryon`): the gate said **REVIEW**. The try-on cut the below-knee kurta-02 to hip
  length and drew shorts below it; the verifier flagged the hem as a mismatch
  (0.98) and the fidelity check found the garment shrank in frame (area
  0.212). The gate caught an AI model changing the garment, and nothing was
  released. Why (NR4b): the cut-out was the whole kurta, but the synthetic
  model wears a hip-length T-shirt over leggings and no prompt was sent, so
  the try-on replaced only the T-shirt. Since NR4b the request carries a
  prompt with the garment type and length the seller claimed (`Type:`,
  `Length:` or `hem:` in the garment note), never colour or print, and none
  when neither is claimed. That fix did not keep the length (9b3b226,
  `live-kurta-02-tryon-2` and `live-kurta-01-tryon`, both **REFUSE**): both
  outputs are still hip-length tunics over the model's leggings (fidelity area
  0.212 and 0.206, below 0.400), and kurta-01's full sleeves came back
  three-quarter. On both, the verifier timed out at 180 s, so the gate
  refused them as not verified (fail closed). Since NR4c a verifier request
  that times out is sent once more with a 360 s timeout, and the receipt lists
  both attempts. On a second model image, `synthetic-02` (an AI-generated
  fictional adult in an ankle-length slip, so the lower body is free; 04d9cd0),
  both kurtas still came back short (4427c81, `live-kurta-02-tryon-s02` and
  `live-kurta-01-tryon-s02`, both **REFUSE** on fidelity, area 0.210 and
  0.183). This time the verifier answered and flagged the hem as a mismatch on
  both. The garment image sent is the whole kurta, hem included (NR4d,
  `evidence/tryon-sent/`); since NR4d it has a white margin. The margin did
  not keep the length either (ace95ac, synthetic-02: `live-kurta-02-tryon-m`
  **REFUSE**, area 0.176, delta_e 22.687; `live-kurta-01-tryon-m` **REVIEW**,
  area 0.301, delta_e 17.522). So for long garments the honest demo is
  composite v2, with the try-on shown as what the gate catches. Separately,
  two committed try-on images were re-verified without a new Pruna call (the
  render entry is a stand-in file, so these are not try-on calls):
  `live-kurta-02-tryon-2-reverify` **REVIEW** (the verifier answered: hem
  mismatch 0.96, soft) and `live-kurta-01-tryon-reverify` **REFUSE**
  (fidelity: texture 0.641, area 0.206). Since NR4e each
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
  garment"). One live call is logged (see the table below).
- `BASETEN_API_KEY`: the verifier call to Muse Spark Open
  (`meta-models/muse-spark-open-1026`) on Baseten (`src/verifier.ts`, one
  chat completion per render with the photos as `image_url` parts).
  `MODEL_VERIFIER` overrides the model id.

**Built with Muse Spark Open.** The verifier calls `meta-models/muse-spark-open-1026`
on Baseten. Four real calls are logged under `evidence/` with the key redacted
and the images replaced by their size and hash; tokens, latency and finish
reasons are in `docs/API-NOTES.md`. The model reasons before it answers
(`reasoning_content`): at `max_tokens` 64 a one-word answer was cut off, and at
1500 the nine findings were (1338 reasoning tokens first). At 4096 the
kurta-01 composite answer was cut off too (4055 reasoning tokens,
`evidence/verifier-2026-10-28T12-30-54-012Z.json`), so the verifier now sends
8192 and retries once at 16384 when the answer stops at the limit; a second
cut-off answer is a REFUSE (`verifier_truncated`), never a pass.

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

## What is verified and what is not

| Claim | Status | Evidence |
|---|---|---|
| Test suite green | 202 tests pass, 0 fail | `npm test`, run on 28 Oct 2026 at 15:12 IST, tree of 01770c7 plus N10 (per-pair calibrate values) |
| Typecheck clean | yes | `npm run typecheck`, same run |
| CI green | on 2859cde: [run 40654848955](https://github.com/rmanish2000-del/proofshot-hackathon/actions/runs/40654848955); on 00fe261: [run 40641160204](https://github.com/rmanish2000-del/proofshot-hackathon/actions/runs/40641160204) (run ids given by Grok, 28 Oct 13:50 IST) | earlier: [run 40484105220](https://github.com/rmanish2000-del/proofshot-hackathon/actions/runs/40484105220) on e2847f1 |
| Live Muse Spark Open call on Baseten | 2 text calls, both HTTP 200 | `evidence/baseten-2026-10-27T13-23-37-385Z.json` (max_tokens 64, content null, finish_reason length) and `evidence/baseten-2026-10-28T00-51-41-996Z.json` (max_tokens 1024, content "ready", finish_reason stop); numbers in `docs/API-NOTES.md` |
| Live verifier call with images (4 JPEGs, 715×1600) | 2 calls, both HTTP 200: the first cut off at max_tokens 1500 (finish_reason length, 1338 reasoning tokens), the second complete at 4096 (finish_reason stop, 1808 completion tokens, 9 findings all `match`) | `evidence/verifier-2026-10-28T03-55-00-289Z.json`, `evidence/verifier-2026-10-28T03-59-30-015Z.json` (key placeholder, images as size and hash) |
| Live pipeline job through the verifier | 5 jobs, stand-in render. On kurta-02: `live-kurta-02-sam` (1e05d38) RELEASE with 3 SAM 3.1 calls and 1 verifier call, each logged redacted (`evidence/sam-2026-10-28T08-1*.json`, `evidence/verifier-2026-10-28T08-16-02-429Z.json`). **Like `live-kurta-01-sam-2`, that RELEASE is the owner's photo checked against itself** (the stand-in render is kurta-02 front), so it proves the measured path on a second garment, not accuracy; its shop card carries the same stand-in tag. On kurta-01: `live-kurta-01` REFUSE (`not_verified`, the cut-off answer) and `live-kurta-01-2` REVIEW (fidelity unmeasured: no mask), both with no segmenter; `live-kurta-01-sam` REVIEW with SAM 3.1 masks (fidelity unmeasured: run before the JPEG decode); `live-kurta-01-sam-2` (189f87c) RELEASE with SAM 3.1 masks and fidelity measured on the JPEGs (delta_e 0.0001, texture 1). **That RELEASE is the owner's photo checked against itself** (the stand-in render is kurta-01 front): it proves the measured path runs end to end, not that the gate is accurate, and its shop card is tagged "owner's photo, stands in for render" | `data/jobs/live-kurta-02-sam/`, `data/jobs/live-kurta-01/`, `data/jobs/live-kurta-01-2/`, `data/jobs/live-kurta-01-sam/`, `data/jobs/live-kurta-01-sam-2/`, `demo/recordings/live-kurta-01-2/` |
| Deliberate-mismatch live job | 1 job (n=1): kurta-01 sources, kurta-02 front as the render (`--render`), no segmenter: REFUSE (`hard_mismatch`, color mismatch at 0.99) | `data/jobs/live-kurta-01-mismatch/`, `evidence/verifier-2026-10-28T04-25-58-791Z.json`, recording `demo/recordings/live-kurta-01-mismatch/` (replays to REFUSE) |
| Verifier accuracy | **not measured**: two live comparisons are a photo against itself (the stand-in) and one is a single deliberate mismatch that was refused; that shows the model can catch one obvious mismatch, not how often it does | the three live jobs above |
| Live SAM 3.1 call on the Meta Model API | 1 call, HTTP 200, one `<\|box;…\|><\|mask;…\|>` token pair returned for the prompt "kurta" on `data/garments/kurta-01/1-front.jpg` (box confidence 0.957) | `evidence/sam-2026-10-28T03-04-30-778Z.json` (key and headers left out, image replaced by its size and hash); numbers in `docs/API-NOTES.md` |
| SAM 3.1 masks decoded | yes, in tests: `@meta-sam/parser` 0.1.0 turns the logged answer into one box (27,169 to 651,1408 of 715×1600, confidence 0.957) and one full-frame mask whose garment pixels all fall inside that box | `test/sam-parser.test.ts` against `evidence/sam-2026-10-28T03-04-30-778Z.json` and the committed photo |
| SAM 3.1 segmentation in the gate | **run live in one job**: `live-kurta-01-sam` (kurta-01, stand-in render) got 3 kurta segments from SAM 3.1 (scores 0.957, 0.949, 0.973); fidelity was unmeasured (REVIEW: that job ran before the JPEG decode of R3), so the gate said REVIEW. Its SAM calls have no per-call log in `evidence/` (only the receipt's segments entry). The re-run `live-kurta-01-sam-2` (189f87c) logged each of its 4 SAM calls (`evidence/sam-2026-10-28T05-4*.json`, key and headers left out) and measured fidelity on the masks | `data/jobs/live-kurta-01-sam/`, `data/jobs/live-kurta-01-sam-2/`, tests in `test/sam-parser.test.ts` and `test/serve.test.ts` |
| Fidelity thresholds | **uncalibrated**: `npm run calibrate` (R4) scores 20 ordered pairs of the 5 committed kurta photos (same garment dir = same: 8 same, 12 different). With SAM masks for all 5 photos (run by Grok 28 Oct 13:50, after `live-kurta-02-sam`), all 20 pairs are measured: at the current values (x1) 0 of 12 different-garment pairs are falsely matched and 6 of 8 same-garment pairs are refused (every front/back pair; the two kurta-01 front/front pairs are released); at 1.5x looser, 0 false match, 0 false refuse, and the 2 kurta-02 front/back pairs go to REVIEW; at 2x looser, 8 of 12 different-garment pairs go to REVIEW (none released). This is the fidelity check alone (no verifier findings), on two garments: it is not a gate decision and no threshold is changed on it. Earlier run (11:35, kurta-01 masks only): 6 same pairs measured, 4 refused, 14 pairs unmeasured. With whole-frame masks (background included, not the SPEC §10 measure) the current values refuse all 8 same-garment pairs (front against back counts as same); at 2x looser the 8 are released and the 12 different-garment pairs go to REVIEW. 5 photos of 2 garments, so no threshold is changed on this. The CLI scores the fidelity check alone (no verifier findings, said in its output); in the scorer a pair with no findings now fails closed at the gate (REFUSE `not_verified`), fixed in N1 after PS-1 found it released. Since N10 the CLI also prints the four raw values (delta_e, hist, texture, area) for every pair and writes them under `pairs` in its `--out` file, values only, no threshold applied. In the 15:15 run (same 5 SAM masks): delta_e is 2.6 to 10.8 on the 8 same-garment pairs and 32.3 to 41.6 on the 12 different-garment pairs; texture is 0.45 to 0.94 on same and 0.34 to 0.61 on different, so the two overlap, and the 6 front/back same pairs refused at x1 are refused on texture (0.45 to 0.55, below 0.65). Two garments: an observation, not a threshold decision |  `config/fidelity.json`, `evidence/calibration-sam-20261028-1515.json` (per-pair values), `evidence/calibration-sam-2026-10-28.json` (5/5 masks), `evidence/calibration-sam-20261028.json`, `evidence/calibration-sam-20261028-1135.json`, `evidence/calibration-whole-frame-20261028.json` |
| Verify page in a real browser | **not checked** | tested in Node against the same core |
| Seller upload page in a real browser | **not checked** | the server, the API, the gate states and the page's text are tested in Node (`test/serve.test.ts`); no browser has loaded `upload.html` yet |
| Public repo | public since 28 Oct 2026 (history scan clean: one fake test key in 115c3ba, no EXIF/GPS, no phone number; author email is the noreply address from 28 Oct) | made public by Manish on 28 Oct after the history scan |

## Built during the event

Everything in this repository was written from the specification
(`docs/SPEC.md`) during the hackathon, starting 26 Oct 2026 at 21:30 IST, with
a new git history. The spec itself was written before the event and carried
over; it marks every change made here with *(event)*. Config boilerplate
(`tsconfig.json`, `.gitignore`) mirrors the pre-existing repo. ProofShot's pre-existing
core stays in a separate private repository. It is not copied here and is
only called as a hosted service.

## License

MIT, see [LICENSE](LICENSE).
