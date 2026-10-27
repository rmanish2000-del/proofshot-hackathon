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

Today it shows one job, `data/jobs/fixture-shirt-01` (synthetic images,
recorded findings, `provenance: fixture`), written by the same script with a
recorded clock, because no live render transport exists yet (SPEC §8). The page
says so.

New in this feature, all written during the event: `src/shop.ts`,
`scripts/shop-build.ts`, `web/shop.html`, `web/shop/` (generated),
`data/jobs/fixture-shirt-01/` (generated), `test/shop.test.ts`, SPEC §11, the
`shaFromFragment` helper in `src/core.js` and the `#sha` prefill in
`web/verify.html`, and `src/page.ts` / `scripts/page.ts` covering both pages.
Pre-existing (rebuilt from the spec earlier in this repo, not part of this
feature): the gate, the receipt chain, the verify-page core (`src/core.js`
checks) and the intake.

## Providers

Only environment variable names are listed here. Values are never printed or
committed.

- `RENDER_PROVIDER`: `openai-images` (the default), `fal` or `meta`.
  `MODEL_RENDER` sets the model. `openai-images` defaults to `gpt-image-1`, and
  `fal` and `meta` require it.
- **Muse Image is refused on every provider**, before any request (Meta's
  Geographic Use Policy excludes India). The renderer is checked when it is built
  and again before each request (`src/render.ts`).
- `BASETEN_API_KEY`: the verifier call to Muse Spark Open
  (`meta-models/muse-spark-open-1026`) on Baseten. `MODEL_VERIFIER` overrides
  the model id (`src/baseten.ts`).

The HTTP transports for the three render providers are not written yet. The
renderer takes an injected transport.

## Dependencies and datasets

- Runtime: none. The code uses only Node's standard library (`node:crypto`,
  `node:fs`, `node:zlib` for PNG masks, `node:test`).
- Development: `typescript`, `@types/node`.
- CI (`.github/workflows/ci.yml`): `actions/checkout`, `actions/setup-node`,
  `gitleaks/gitleaks-action`.
- Datasets: none. Tests use synthetic images built in code. The demo input
  will be our own garment photos under `data/garments/`, with metadata
  removed.

## What is verified and what is not

| Claim | Status | Evidence |
|---|---|---|
| Test suite green | 113 tests pass, 0 fail | `npm test`, run on 27 Oct 2026 at 18:14 IST, commit 5a898a4 |
| Typecheck clean | yes | `npm run typecheck`, same run |
| CI green | reported, not re-read for this README | [run 40484105220](https://github.com/rmanish2000-del/proofshot-hackathon/actions/runs/40484105220) on e2847f1 |
| Live Muse Spark Open call on Baseten | **UNVERIFIED** | no call log is committed under `evidence/` yet |
| Real SAM 3.1 segmentation | **not built** | the segmenter is an injected provider; tests use fixtures |
| Fidelity thresholds | **uncalibrated** | `config/fidelity.json` holds starting values |
| Verify page in a real browser | **not checked** | tested in Node against the same core |
| Public repo | private until the 3 Nov secret scan and Manish's click | |

## Built during the event

Everything in this repository was written from the specification
(`docs/SPEC.md`) during the hackathon, starting 26 Oct 2026 at 21:30 IST, with
a new git history. The spec itself was written before the event and carried
over; it marks every change made here with *(event)*. Config boilerplate
(`tsconfig.json`, `.gitignore`) mirrors the pre-existing repo. ProofShot's pre-existing
core stays in a separate private repository. It is not copied here and is
only called as a hosted service.
