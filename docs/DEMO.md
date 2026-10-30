# ProofShot demo script v6 (proofshot-hackathon)

Status: v6, 29 Oct 2026, from Manish: the demo shows the two shirts only (plaid
and zebra), no kurta anywhere. v5's try-on beat (`live-kurta-01-tryon-m`) is
dropped, not replaced: no committed shirt job has a try-on render (all 7 of
the committed try-on receipts are kurta jobs), and no new paid call was made
for the video. The kurta jobs stay in the README results and the evidence pack.
From v5: the plaid self-photo RELEASE is labelled a pipeline smoke example.
Framed for "Build for Your World" with an Indian boutique seller. v5, v4 and v3
are in git history. Every job on screen is a committed receipt; "What exists
today" says what each one is. A `[TBD]` is not read out or shown on screen.

Length 76 s. Screen recording only, burned-in captions. Voice: Manish's own (an
AI voice is UNVERIFIED against the rules). Word cap per beat = seconds x 2.5
(150 wpm).

## What exists today (master), so the script claims nothing else

| Thing the video could show | State | Where |
|---|---|---|
| Gate, receipt chain, verify page, intake | built, tested on master (`npm test`, all pass) | `npm test` |
| Gate fails closed | absent findings, a failed or cut-off verifier answer are `REFUSE not_verified` or `verifier_truncated`; an unmeasured fidelity check gives REVIEW at best | SPEC §2, §4, §10 |
| The seller's photos | `data/garments/shirt-plaid`: 4 phone photos of the owner's own shirt (front, back, collar, print), no person; intake found no metadata to remove (each file's hash unchanged, `removed` empty in `intake.json`) | `data/garments/shirt-plaid` |
| Pipeline smoke example (RELEASE) | `ms2-shirt-plaid`: the candidate is the owner's own front photo (stand-in), Muse Spark 1.3 on `api.meta.ai` finds 9 of 9 attributes matching, fidelity measured on SAM 3.1 masks, gate RELEASE. Photo against itself: it shows the pipeline runs end to end, **not** accuracy | `data/jobs/ms2-shirt-plaid` |
| REVIEW on the plaid shirt | `live-shirt-plaid-composite-v2-r3`: composite v2 (the shirt's own pixels cut out by SAM 3.1 and placed on a ghost mannequin by deterministic code, no image model); all 9 attributes agree; `logo_text` scored 0.80, under its 0.85 floor, so the gate says REVIEW | `data/jobs/live-shirt-plaid-composite-v2-r3` |
| REFUSE for the wrong garment | `live-shirt-plaid-mismatch`: the zebra shirt's front photo as the candidate against the plaid shirt's photos; `hard_mismatch` on colour at 0.99, REFUSE. One job, n=1; the MS4 cross-check refused 153 of 153 wrong-garment runs on these four garments | `data/jobs/live-shirt-plaid-mismatch`, `evidence/ms4-summary.json` |
| A generated on-model image | the Pruna try-on transport exists (NR4, `src/render-replicate.ts`); the 7 live try-on calls committed so far (7 receipts with a `replicate-pruna-tryon` render entry: 2 REVIEW, 5 REFUSE) were all held by the gate, so **no generated image has been released**. All of them are kurta jobs and there is no shirt try-on, so this video has no try-on beat; the results are in the README | `data/jobs/live-kurta-0*-tryon*` |
| Seller upload page | built, local only (`npm run serve`); checked in a browser (29 Oct, Chromium, fixture mode). The capture has no file picker, so the video shows the empty page, then the committed photos | `web/upload.html`, SPEC §12 |
| Hosted service, public deploy | **none** | — |

Claims rule (PS-C1): name a model only with its call log in the receipt on
screen. SAM 3.1 and Muse Spark 1.3 have logs in the shirt jobs' receipts.

## Rules for record day

1. Name a model on screen or in the voiceover only if its call log is in the
   receipt being shown. No log: cut the model from the video.
2. Do not name Muse Image, anywhere.
3. No price clause and no claim about returns or sales.
4. Licence on the end slide only if `LICENSE` exists in this repository (MIT today).
5. The smoke-example beat says on screen that the candidate is the owner's own
   photo and that it is a pipeline smoke example.
6. No person in any frame. The seller is spoken of as "the seller", not
   named. Only the plaid and zebra shirts appear; no kurta job is opened.

## Timecode table

| # | Timecode | Screen | Voiceover | Words / cap | Caption | Judging criterion |
|---|---|---|---|---|---|---|
| 1 | 0:00-0:06 | Title card (S1) showing the voiceover line | Build for Your World. An Indian boutique seller lists a shirt online. | 12 / 15 | same as voiceover | Impact 30% |
| 2 | 0:06-0:18 | The seller upload page (S2), then the four phone photos of the plaid shirt on its judge page (S3) | The seller uploads their own phone photos of the shirt. ProofShot checks every candidate listing image against those photos before it goes on sale. | 24 / 30 | Seller's own photos in. Every candidate checked against them. | Impact 30% |
| 3 | 0:18-0:30 | Judge page of `ms2-shirt-plaid` (S4): the stand-in tag, 9 of 9 attributes, gate RELEASE | A pipeline smoke example first: the seller's own photo as the candidate. All nine attributes match, and the gate says RELEASE. | 21 / 30 | Pipeline smoke example: the owner's own photo. RELEASE. | Meta tooling 25% |
| 4 | 0:30-0:42 | Judge page of `live-shirt-plaid-composite-v2-r3` (S5): the composite beside the photos, then the gate: REVIEW, `logo_text` below its floor | Next, a ghost-mannequin composite of the plaid shirt. The brand label is matched below its confidence floor, so the gate says REVIEW. | 22 / 30 | Composite, not AI-generated. Label below its floor: REVIEW. | Technical depth 20% |
| 5 | 0:42-0:54 | Judge page of `live-shirt-plaid-mismatch` (S6): the plaid photos beside the zebra shirt, then the gate: REFUSE `hard_mismatch` on colour | Then a different shirt. The verifier finds a hard colour mismatch and the gate says REFUSE, so this image is not released. | 22 / 30 | Wrong garment. REFUSE. | Meta tooling 25%, Impact 30% |
| 6 | 0:54-1:10 | The receipt bytes around the byte that will change (S7), then `web/verify.html` opened from disk with that receipt and image: VALID, then the one-byte copy: TAMPERED with the entry number (S8) | Every decision is written into a hash-chained receipt. The verify page checks every hash in the browser, with no server: VALID. Change one byte, and it says TAMPERED. | 28 / 40 | Every hash checked in the browser. One byte changed: TAMPERED. | Technical depth 20%, Demo 25% |
| 7 | 1:10-1:16 | End slide (S9): name, one line, `github.com/rmanish2000-del/proofshot-hackathon`, "Licence: MIT" | ProofShot. Every ProofShot result has its receipt. The code is on GitHub. | 12 / 15 | github.com/rmanish2000-del/proofshot-hackathon | Demo 25% |

Timecodes are the cumulative shot seconds of `DEMO_SHOTS` (`src/demo-capture.ts`,
`shots.json`): 9 shots, 76 s, so the cut ends at 1:16. Every beat's voiceover is
within its cap (test/demo-capture.test.ts, DEMO1h).

What the verify page shows for TAMPERED (`src/core.js`, `checkChain`): the index
of the first entry that fails and one reason. Check it in the browser before
recording (checklist).

## Shot list

| Shot | For beat | What to capture | Source |
|---|---|---|---|
| S1 | 1 | Title card with the opening line | slide |
| S2 | 2 | The seller upload page, empty | `web/upload.html` served by `npm run serve` |
| S3 | 2 | The four phone photos of the plaid shirt | the input section of `/judge?job=ms2-shirt-plaid` |
| S4 | 3 | Gate RELEASE with the stand-in tag and the 9 findings, captioned as a pipeline smoke example | the gate section of `/judge?job=ms2-shirt-plaid` |
| S5 | 4 | The composite beside the photos, then gate REVIEW | `/judge?job=live-shirt-plaid-composite-v2-r3` |
| S6 | 5 | The plaid photos beside the zebra shirt, then gate REFUSE `hard_mismatch` | `/judge?job=live-shirt-plaid-mismatch` |
| S7 | 6 | The receipt bytes around the byte that will change | `web/shop/ms2-shirt-plaid/receipt.jsonl` (the tamper bytes page of `npm run demo:capture`) |
| S8 | 6 | Verify page: VALID, then TAMPERED with the entry number | `web/verify.html` opened from disk; receipt and image from `web/shop/ms2-shirt-plaid/` |
| S9 | 7 | End slide | slide |

## Recording checklist

- [ ] Every model named has its call log in the receipt on screen; none named otherwise.
- [ ] No Muse Image anywhere, no `UNVERIFIED` on screen, no price, no claim about returns.
- [ ] The smoke-example beat shows that the candidate is the owner's own photo.
- [ ] Shirts only: no kurta job and no try-on image in any frame.
- [ ] The verify page really shows the broken entry for TAMPERED (check before recording).
- [ ] verify.html opened from disk (file:// URL visible), no server running.
- [ ] No terminal shows a key, a token, `.env`, an email address or a home path.
- [ ] No person in any frame.
- [ ] Captions burned in; each beat under its word cap; total 76 s.
- [ ] End slide URL is `github.com/rmanish2000-del/proofshot-hackathon`; licence only if `LICENSE` exists.
- [ ] Manish's own voice.
