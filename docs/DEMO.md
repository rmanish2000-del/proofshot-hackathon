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

## Re-render script v7 (31 Oct, for the out/final video)

Grok 17:35 IST 31 Oct (#23). This is the script for re-rendering the
assembled video in out/final (first commit cited: 15658a4). It does not
change the v6 timecode table and shot list below: those still drive
`npm run demo:capture`. Five beats, 2:50 in all with the optional end card
(2:45 without it), word cap = seconds x 2.5. Every figure was read from a
committed file on 31 Oct.

Grok 21:10 IST 31 Oct: the prior-work line comes at the opening, as an
on-screen caption over the first 5 s of beat 1; beat 3 is 10 s shorter (40 s,
same narration, which fits its cap) and the later beats move up; the end card
is optional. The narration text is unchanged from the first v7 (72db20c). The
narration audio is Manish's own recorded voiceover; nothing is re-recorded or
generated.

| Beat | Time | Screen | Narration | Source |
|---|---|---|---|---|
| 1 Problem | 0:00 to 0:25 (25 s, cap 62) | Title card with the prior-work caption (below) on screen from 0:00 to 0:05, then the four phone photos of the plaid shirt; the agent caption (below) over the last sentence | An Indian boutique seller lists garments from their own phone photos. A cleaned-up shot or an AI try-on can quietly change the garment: its colour, its print, its length. ProofShot is an evidence-recovery agent that catches that before the listing goes live. | `data/garments/shirt-plaid` |
| 2 Agent loop | 0:25 to 1:10 (45 s, cap 112) | The keyless `npm run agent:demo` run (2-back.jpg is the image to publish), with the "canned verifier" label visible | This is the keyless agent demo. Its verifier is a labelled stand-in, so it shows the mechanics, not model accuracy. The seller gives three close-ups and no full-length view, and the gate says REVIEW. The agent reads the receipt and asks for the missing view. The seller adds it, the same gate runs again, and it says RELEASE. Nothing is published until the seller approves. A proposal carrying injected text is rejected, and publish stays blocked. | `scripts/agent-demo.ts`; run 31 Oct about 20:27 IST: run-1 REVIEW, run-2 RELEASE, published; injection REVIEW, publish refused |
| 3 Results | 1:10 to 1:50 (40 s, cap 100) | The verdict table of the try-on run, then the shirt-pink composite beside photo 1 | Then five real garments. Pruna (via Replicate) made five AI try-ons. 0 of 5 AI try-ons released; every one held for review or refused, with the reason on the receipt. Composite v2 gave one RELEASE, three REVIEW and one REFUSE. The RELEASE is built from the seller's own pixels, cut out and moved, not a generated image. | `evidence/tryon/SUMMARY.md` (n = 10 jobs on 5 garments; Totals, "By method": composite v2 1 RELEASE, 3 REVIEW, 1 REFUSE) |
| 4 Verify page | 1:50 to 2:20 (30 s, cap 75) | `web/verify.html` opened from disk: VALID, then the one-byte copy: TAMPERED with the entry number | Every decision is written into a hash-chained receipt. The verify page checks every hash in the browser, with no server: VALID. Change one byte, and it says TAMPERED, with the entry number. | as v6 S7/S8 |
| 5 Meta tooling | 2:20 to 2:45 (25 s, cap 62) | A receipt with its SAM 3.1 and Muse Spark 1.3 log entries, then one Baseten verifier log | SAM 3.1 segments the garment. Muse Spark 1.3 on the Meta Model API checks nine attributes. Earlier runs used Muse Spark Open via Baseten. Every call is logged, and a code gate, not a model, decides. | Muse Spark Open via Baseten checked against `evidence/verifier-*.json`: 19 logs with provider `baseten`, model `meta-models/muse-spark-open-1026`, 28 Oct to 29 Oct 00:43 UTC; later logs are `muse-spark-1.3` on `api.meta.ai` |
| Card | 2:45 to 2:50 (5 s, no narration, optional) | Prior-work card, text only (repeats the opening caption) | | the card text below |

Prior-work caption (beat 1, 0:00 to 0:05) and optional end card, on screen exactly:

Prior work: spec document only. Everything you see running was coded 27–31 Oct (first commit 15658a4). git log is public.

Beat 1 narration is verbatim from Manish's recorded voiceover and is not
re-recorded (Grok 21:57 IST 31 Oct): its "evidence-recovery agent" claims only
catching. The agent is named in the caption instead, on screen over the last
sentence of beat 1, exactly:

Evidence-checking agent: it asks the seller for missing evidence, or refuses.

Do not say or show:

- "5/5 distortion caught" or "5 REFUSED" for the try-ons; the line is "0 of 5 AI try-ons released".
- The 31 Oct 2-of-2 agent runs on the pink polo and the mustard kurta (`evidence/agent-replace-2026-10-31*`): they were self-comparisons and would be REVIEW under SC1 (87f209b).
- Any model without its call log on screen (v6 rule 1); Muse Image anywhere (rule 2).
- Open for Grok: the try-on images show the AI-generated synthetic model (`data/models/*/LICENSE.md`), and v6 rule 6 says no person in any frame. Until Grok or Manish says otherwise, beat 3 shows the verdict table and the composite, not the try-on images.

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
