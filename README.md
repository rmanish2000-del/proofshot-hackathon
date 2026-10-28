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

Today it shows fixture jobs only, written by the same script with a recorded
clock, because no live render transport exists yet (SPEC §8); the page says so.
`data/jobs/fixture-shirt-01` has synthetic images. `data/jobs/kurta-01` and
`kurta-02` are preview jobs for the two photographed garments under
`data/garments/`: the sources are the intake photos with their `intake.json`
hashes, and the released "render" is the garment's own front photo, unchanged
(no generated image, no person), returned by the `stand-in` render provider,
which the receipt's render entry names (`stand-in` / `owner-photo`). Every card
and product view built from such a receipt carries the tag "owner's photo,
stands in for render". They let a judge see a real garment go through the
receipt, the in-browser verification and the badge.

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

## Providers

Only environment variable names are listed here. Values are never printed or
committed.

- `RENDER_PROVIDER`: `openai-images` (the default), `fal`, `meta` or
  `stand-in`. `MODEL_RENDER` sets the model. `openai-images` defaults to
  `gpt-image-1`, and `fal` and `meta` require it. `stand-in` generates nothing:
  it returns the owner's own front photo and records `owner-photo` as its
  model; any other `MODEL_RENDER` with it is refused (`src/render.ts`).
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
1500 the nine findings were (1338 reasoning tokens first), so the verifier
sends 4096.

The HTTP transports for the three render providers are not written yet. The
renderer takes an injected transport.

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
| Test suite green | 162 tests pass, 0 fail | `npm test`, run on 28 Oct 2026 at 09:30 IST, tree of 256dcc5 plus this change |
| Typecheck clean | yes | `npm run typecheck`, same run |
| CI green | reported, not re-read for this README | [run 40484105220](https://github.com/rmanish2000-del/proofshot-hackathon/actions/runs/40484105220) on e2847f1 |
| Live Muse Spark Open call on Baseten | 2 text calls, both HTTP 200 | `evidence/baseten-2026-10-27T13-23-37-385Z.json` (max_tokens 64, content null, finish_reason length) and `evidence/baseten-2026-10-28T00-51-41-996Z.json` (max_tokens 1024, content "ready", finish_reason stop); numbers in `docs/API-NOTES.md` |
| Live verifier call with images (4 JPEGs, 715×1600) | 2 calls, both HTTP 200: the first cut off at max_tokens 1500 (finish_reason length, 1338 reasoning tokens), the second complete at 4096 (finish_reason stop, 1808 completion tokens, 9 findings all `match`) | `evidence/verifier-2026-10-28T03-55-00-289Z.json`, `evidence/verifier-2026-10-28T03-59-30-015Z.json` (key placeholder, images as size and hash) |
| Live pipeline job through the verifier | 2 jobs on kurta-01, stand-in render, no segmenter: `live-kurta-01` REFUSE (`not_verified`, the cut-off answer), `live-kurta-01-2` REVIEW (fidelity unmeasured: no mask); both receipts verify | `data/jobs/live-kurta-01/`, `data/jobs/live-kurta-01-2/`, `demo/recordings/live-kurta-01-2/` |
| Deliberate-mismatch live job | 1 job (n=1): kurta-01 sources, kurta-02 front as the render (`--render`), no segmenter: REFUSE (`hard_mismatch`, color mismatch at 0.99) | `data/jobs/live-kurta-01-mismatch/`, `evidence/verifier-2026-10-28T04-25-58-791Z.json` |
| Verifier accuracy | **not measured**: two live comparisons are a photo against itself (the stand-in) and one is a single deliberate mismatch that was refused; that shows the model can catch one obvious mismatch, not how often it does | the three live jobs above |
| Live SAM 3.1 call on the Meta Model API | 1 call, HTTP 200, one `<\|box;…\|><\|mask;…\|>` token pair returned for the prompt "kurta" on `data/garments/kurta-01/1-front.jpg` (box confidence 0.957) | `evidence/sam-2026-10-28T03-04-30-778Z.json` (key and headers left out, image replaced by its size and hash); numbers in `docs/API-NOTES.md` |
| SAM 3.1 masks decoded | yes, in tests: `@meta-sam/parser` 0.1.0 turns the logged answer into one box (27,169 to 651,1408 of 715×1600, confidence 0.957) and one full-frame mask whose garment pixels all fall inside that box | `test/sam-parser.test.ts` against `evidence/sam-2026-10-28T03-04-30-778Z.json` and the committed photo |
| SAM 3.1 segmentation in the gate | **wired, not yet run live in a job**: `providersFromEnv` builds the SAM segmenter from `MODEL_SEGMENT` + `MODEL_API_KEY` with the parser glue as default, and the fidelity check takes its masks; no pipeline job has run through SAM live yet, and with JPEG photos fidelity stays REVIEW (no JPEG decoder) | tests in `test/sam-parser.test.ts` and `test/serve.test.ts` |
| Fidelity thresholds | **uncalibrated** | `config/fidelity.json` holds starting values |
| Verify page in a real browser | **not checked** | tested in Node against the same core |
| Seller upload page in a real browser | **not checked** | the server, the API, the gate states and the page's text are tested in Node (`test/serve.test.ts`); no browser has loaded `upload.html` yet |
| Public repo | private until the 3 Nov secret scan and Manish's click | |

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
