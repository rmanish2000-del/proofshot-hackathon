# ProofShot demo script v9 (proofshot-hackathon)

**All of ProofShot's code was written during the event, from 27 Oct 2026 (first commit [`15658a4`](https://github.com/rmanish2000-del/proofshot-hackathon/commit/15658a495f0f7469cc1de6fe025fec3bd7cf327e), 11:10 IST; the hackathon opened 26 Oct 2026, 21:30 IST).** The gate, the receipt chain, the verify page, the pipeline and the upload, judge and shop pages are all code in this repository. Disclosed prior work, listed below: the written specification the code was rewritten from (pre-event text published unchanged in `docs/prior-work/`), two config files (`tsconfig.json`, `.gitignore`), and one AI-generated sample model image (`synthetic-01`, used only in try-on runs committed on 28 and 31 Oct and in Space jobs made before 2 Nov; the final demo uses `synthetic-02`, made 28 Oct, during the event). An earlier private prototype's code is not in this repository.

Current status (3 Nov 2026): the video to submit is v9, in the next section; v8 below is superseded and kept as history.
Its narration is the recorded voiceover: a generated Edge TTS voice
(en-IN-PrabhatNeural). The v7 re-render script below is superseded and kept as
history. The v6 sections (the status note, "What exists today", the timecode
table ending at 1:16 and the shot list) still drive `npm run demo:capture`,
which records the v6 frames.

## v9: the video to submit

Grok, 3 Nov 2026 (#23, FIN1). The final cut: 172.1 s, 1920x1080, 30 fps. The
rendered file is not committed, so its length is UNVERIFIED here. Voice: the
recorded voiceover (a generated Edge TTS voice, en-IN-PrabhatNeural); whether
the rules allow a generated voice is UNVERIFIED. Link: VIDEO_LINK_TBD. The live
job shown is `upload-20261103-003600-8e63` (synthetic-02, gate REFUSE). The
sample replay it shows is labelled recorded. The spoken lines below are
verbatim from the cut's subtitle file (given in FIN1; the subtitle file is not
committed).

| Time | Spoken |
|---|---|
| 0:01 | Hello. |
| 0:03 | This is ProofShot. |
| 0:05 | All of the code you will see was written during this hackathon, from the twenty-seventh of October. |
| 0:13 | Before the event, there was only the written specification the code was rebuilt from, two config files, and one sample model photo that this demo does not use. |
| 0:26 | All three are disclosed in the repo. |
| 0:30 | Meet a seller, anywhere in the world. |
| 0:33 | She photographs every shirt on her phone. |
| 0:37 | A cleaned-up shot, or an AI try-on, looks better. |
| 0:42 | But it can quietly change the garment. |
| 0:46 | And the buyer gets something else. |
| 0:50 | ProofShot checks that image against her own photos before it goes on sale. |
| 0:56 | This is the live demo, on a phone. |
| 1:00 | Step one: photos. |
| 1:03 | She adds three photos. |
| 1:06 | She can type one line, like shirt, or nothing at all. |
| 1:12 | Location, camera and date are stripped from every photo first. |
| 1:17 | Step two: the result. |
| 1:20 | SAM three point one segments the garment. |
| 1:24 | Pruna on Replicate, not a Meta model, made this AI try-on. |
| 1:30 | Muse Spark one point three, on the Meta Model API, reads nine attributes. |
| 1:37 | Each one becomes a chip. |
| 1:40 | Here, eight match, and the fabric could not be measured. |
| 1:45 | She can correct a chip. |
| 1:48 | That never changes the decision. |
| 1:52 | A plain code gate, not a model, decides. |
| 1:56 | Here it says: refuse. |
| 1:59 | The measured fidelity check found the garment shrank in frame. |
| 2:04 | In our committed runs, the gate held all twelve AI try-ons. |
| 2:10 | Every step goes into a hash-chained receipt. |
| 2:14 | The browser checks it, with no server. |
| 2:17 | Valid. |
| 2:20 | Change one byte, and it says tampered. |
| 2:24 | The same page works on a desktop, a tablet or a phone, so a seller needs only her phone. |
| 2:32 | And the seller can read the result in her own language. |
| 2:37 | Here it's Hindi. |
| 2:39 | This is early, and tested on a handful of garments. |
| 2:44 | But the rule is simple: if we cannot prove the photo is true, it does not go live. |

Fact-check note: "sample model photo that this demo does not use" =
synthetic-01 (the demo uses synthetic-02); "All three" = the specification,
the config files and synthetic-01, all under README "Prior work used"; the
earlier private prototype is not spoken because its code is not here (README
"Prior work used" lists it). The old v8/v9-draft line "Everything you will see
was written fresh…" is no longer in the cut.

## v8 (superseded 3 Nov)

Grok 07:20 IST 2 Nov (#23). The narration was approved by Manish on 1 Nov 2026
and the audio is already rendered (`ProofShot_demo_v8.mp4`, 167.9 s, about
2:48). The rendered file is not committed and no committed file gives that
length, so it is UNVERIFIED here. The spoken text below is verbatim from the staged
`V8_NARRATION.md` and is not edited here. Voice: the recorded voiceover (a
generated Edge TTS voice, en-IN-PrabhatNeural). Whether the hackathon rules
allow a generated voice is UNVERIFIED. What v8 shows on screen in each beat is
not recorded in this repository (UNVERIFIED).

| Beat | Spoken | Caption |
|---|---|---|
| 1 | Hello. | Hello. |
| 1 | This is ProofShot. | This is ProofShot. |
| 1 | Everything you are about to see running was built during this hackathon, from the twenty-seventh of October. | Everything you are about to see running was built during this hackathon, from 27 October. |
| 1 | Before that, there was only the written specification and some config boilerplate. | Before that, there was only the written specification and some config boilerplate. |
| 2 | Picture a small boutique seller in India. | Picture a small boutique seller in India. |
| 2 | She photographs every shirt on her own phone. | She photographs every shirt on her own phone. |
| 2 | But a cleaned-up shot, or an AI try-on, can quietly change the garment. | But a cleaned-up shot, or an AI try-on, can quietly change the garment. |
| 2 | Its colour. | Its colour. |
| 2 | Its print. | Its print. |
| 2 | And the buyer is misled. | And the buyer is misled. |
| 3 | ProofShot stands between that image and the listing. | ProofShot stands between that image and the listing. |
| 3 | It is an evidence-checking agent. | It is an evidence-checking agent. |
| 3 | It checks the image against the seller's own photos, and decides. | It checks the image against the seller's own photos, and decides. |
| 4 | Here is the agent at work. | Here is the agent at work. |
| 4 | This run uses a labelled stand-in verifier, so it shows the mechanics, not accuracy. | This run uses a labelled stand-in verifier, so it shows the mechanics, not accuracy. |
| 4 | The seller gives three close-ups, but no full-length view. | The seller gives three close-ups, but no full-length view. |
| 4 | The gate says: review. | The gate says: REVIEW. |
| 4 | The agent reads the receipt, and asks for the missing photo. | The agent reads the receipt, and asks for the missing photo. |
| 4 | The seller adds it. | The seller adds it. |
| 4 | The same gate runs again, | The same gate runs again, |
| 4 | and says: release. | and says: RELEASE. |
| 4 | Nothing is published until the seller approves. | Nothing is published until the seller approves. |
| 4 | And when a proposal carries injected text, it is rejected. | And when a proposal carries injected text, it is rejected. |
| 5 | Now, real garments. | Now, real garments. |
| 5 | Across our runs, twelve AI try-on images were generated. | Across our runs, 12 AI try-on images were generated. |
| 5 | The gate held all twelve. | The gate held all 12. |
| 5 | Ten refused, two sent for review. | 10 refused, 2 sent for review. |
| 5 | Not one was released. | Not one was released. |
| 5 | And the one image that was released here is built from the seller's own pixels, | And the one image that was released here is built from the seller's own pixels, |
| 5 | cut out and placed, not generated. | cut out and placed, not generated. |
| 6 | Every decision is written into a hash-chained receipt. | Every decision is written into a hash-chained receipt. |
| 6 | All forty-three committed receipts verify. | All 43 committed receipts verify. |
| 6 | This page checks every hash in the browser, with no server. | This page checks every hash in the browser, with no server. |
| 6 | Valid. | VALID. |
| 6 | Now change a single byte. | Now change a single byte. |
| 6 | Tampered, | TAMPERED, |
| 6 | and it shows exactly which entry. | and it shows exactly which entry. |
| 7 | SAM three point one segments the garment. | SAM 3.1 segments the garment. |
| 7 | Muse Spark one point three, on the Meta Model API, checks nine attributes. | Muse Spark 1.3, on the Meta Model API, checks nine attributes. |
| 7 | Every call is logged. | Every call is logged. |
| 7 | And a plain code gate, not a model, makes the final call. | And a plain code gate, not a model, makes the final call. |
| 8 | This is early. | This is early. |
| 8 | Our numbers come from a handful of garments, not a general accuracy claim. | Our numbers come from a handful of garments, not a general accuracy claim. |
| 8 | But the principle holds: | But the principle holds: |
| 8 | if we cannot prove the photo is true, | if we cannot prove the photo is true, |
| 8 | it does not go live. | it does not go live. |

### v8 fact check

Each figure or factual claim spoken in v8, checked on 2 Nov against the
committed files. v8 speaks no test count. The audio is rendered, so a mismatch
is recorded here, not fixed in the narration.

| Spoken claim | Status | Source |
|---|---|---|
| Built during this hackathon, from 27 October; before that only the written specification and some config boilerplate | built from 27 Oct matches; "only the specification and config boilerplate" **differs**: it leaves out the AI-generated model image `data/models/synthetic-01/model.png` (generated 23 Oct 2026) and the earlier private prototype (`rmanish2000-del/proofshot`, code not copied; RV20). The v9 opening line (Grok, #23 comment 6571603135, 2 Nov; the v9 audio is not committed, UNVERIFIED here) says "Only the specification, two config files and one AI-generated model photo carry over", which matches | SUBMISSION "Built during the hackathon" (first commit `15658a4`, 27 Oct 2026 at 11:10 IST; prior work: a written specification, two config files, the synthetic-01 model image, and an earlier private prototype whose code is not here) |
| "Everything you are about to see running was built during this hackathon" | matches only scoped to ProofShot's own code (RV17): ProofShot's own code was written from 27 Oct 2026; the Meta models (SAM 3.1, Muse Spark 1.3 on the Meta Model API), Pruna on Replicate and the Edge TTS voice are third-party services it calls or the video uses, not built here; the carry-overs are the written specification, two config files, the synthetic-01 model image and an earlier private prototype whose code is not here | first commit `15658a4`; SUBMISSION "Built during the hackathon"; README "What each Meta model does"; `src/render-replicate.ts` |
| A labelled stand-in verifier; three close-ups and no full-length view; REVIEW, the agent asks, the seller adds the photo, RELEASE; nothing published until the seller approves; injected text rejected | matches | the v7 beat 2 sources below (`scripts/agent-demo.ts`, `publish` in `src/agent/service.ts`) |
| Twelve AI try-on images generated and all twelve held: ten refused, two sent for review, none released | matches | README intro and SUBMISSION Metrics, "AI try-ons held by the gate" (figures `tryon_all_total` 12, `tryon_all_refuse` 10, `tryon_all_review` 2) |
| "the one image that was released here is built from the seller's own pixels" | matches for the 31 Oct try-on run only; UNVERIFIED as a statement about every committed run | `evidence/tryon/SUMMARY.md` (composite v2 1 RELEASE, 3 REVIEW, 1 REFUSE; Pruna try-on 0 RELEASE). Other committed receipts are RELEASE too (for example the pipeline smoke example `ms2-shirt-plaid`, the owner's photo against itself; SUBMISSION "the other 14 were already RELEASE"), so "the one" holds only with "here" read as that run |
| All forty-three committed receipts verify | matches | SUBMISSION Metrics, "Committed jobs with receipts" (figure `receipt_chains` 43 of 43) |
| The page checks every hash in the browser, with no server; a changed byte reads TAMPERED and shows which entry | matches, scoped | `web/verify.html`; one byte of an entry's content, not the file layout (CLAIMS_AUDIT row "Change one byte", CA1; `docs/JUDGE_QA_TAMPER.md` question 2) |
| SAM 3.1 segments the garment; Muse Spark 1.3 on the Meta Model API checks nine attributes | matches | README "What each Meta model does". Record-day rule 1 asks for their log entries on screen in that beat; what v8 shows there is UNVERIFIED |
| Every call is logged | matches for the committed call logs; UNVERIFIED as a statement about every call ever made | README "What each Meta model does" (logged calls per model) |
| A plain code gate, not a model, makes the final call | matches | `src/gate.ts`; README intro |
| Every decision is written into a hash-chained receipt | matches for jobs run through `runJob` | `runJob` in `src/pipeline.ts` appends a `gate` entry for every decision (REFUSE or REVIEW when a job stops early, otherwise the gate's own RELEASE, REVIEW or REFUSE), and `Receipt.append` in `src/receipt.ts` writes it to `receipt.jsonl`, chained to the entry before; `npm test` checks every committed chain (figure `receipt_chains` 43 of 43). Committed examples, the `gate` entry (seq 5) in each: `data/jobs/ms2-shirt-plaid` RELEASE, `data/jobs/live-shirt-plaid-composite-v2-r3` REVIEW, `data/jobs/live-shirt-plaid-mismatch` REFUSE |
| Beat 8 closing line: an image whose truth is not proven does not go live | design rule, not measured accuracy | SPEC §2, §4, §10: the gate fails closed (absent findings, a failed or cut-off verifier answer are REFUSE; an unmeasured fidelity check gives REVIEW at best), and nothing is published until the seller approves. It says what the gate does when proof is missing, not how often the verifier is right (README "Limits") |
| A handful of garments, not a general accuracy claim | matches | README "Limits" (9 real garments in all) |
| "She photographs every shirt on her own phone" | differs from record-day rule 6 (the seller is spoken of as "the seller") | rule 6 below; the narration was approved by Manish on 1 Nov and is not edited |

Status: v6, 29 Oct 2026, from Manish: the demo shows the two shirts only (plaid
and zebra), no kurta anywhere. v5's try-on beat (`live-kurta-01-tryon-m`) is
dropped, not replaced: on 29 Oct no committed shirt job had a try-on render
(all 7 try-on receipts committed then were kurta jobs), and no new paid call
was made for the video. That was true for v6 only: the 31 Oct try-on run added
5 more (`evidence/tryon/*/pruna/receipt.jsonl`), so 12 committed try-on
receipts now: 10 kurta (7 in `data/jobs/live-kurta-0*-tryon*`, plus
kurta-mustard, kurta-pink-patchwork, kurta-red-floral) and 2 shirt
(shirt-pink, shirt-grey-mufti), all held by the gate. v7 beat 3 cites the
shirt-pink one. The kurta jobs stay in the README results and the evidence pack.
From v5: the plaid self-photo RELEASE is labelled a pipeline smoke example.
Framed for "Build for Your World" with an Indian boutique seller. v5, v4 and v3
are in git history. Every job on screen is a committed receipt; "What exists
today" says what each one is. A `[TBD]` is not read out or shown on screen.

v6 capture timing 76 s (the video to submit is v9, above: 172.1 s,
UNVERIFIED here). Screen recording only, burned-in captions. Voice: the recorded voiceover (a
generated Edge TTS voice, en-IN-PrabhatNeural; whether the rules allow it is UNVERIFIED). Word cap per beat = seconds x 2.5
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
| A generated on-model image | the Pruna try-on transport exists (NR4, `src/render-replicate.ts`); on 29 Oct (v6) 7 live try-on receipts were committed (a `replicate-pruna-tryon` render entry each: 2 REVIEW, 5 REFUSE), all kurta jobs and all held by the gate, and there was no shirt try-on, so v6 has no try-on beat. The 31 Oct run added 5 more, 2 of them shirts, so 12 now (10 kurta, 2 shirt, as in the Status line above), all held: **no generated image has been released**. v7 beat 3 shows the 31 Oct verdict table; the results are in the README. | `data/jobs/live-kurta-0*-tryon*`, `evidence/tryon/` |
| Seller upload page | built, local only (`npm run serve`); checked in a browser (29 Oct, Chromium, fixture mode). The capture has no file picker, so the video shows the empty page, then the committed photos. Since 1 Nov (UX-EASY1) the page is two steps (photos, result) with nothing to type: the agent reads nine attributes from the seller's photos and the result shows them as chips. A capture made before then shows the old three-step form with typed attribute fields; a re-capture uses the sample shirt button, which since SAMPLE1 (2 Nov) is a recorded replay of the committed `ms2-shirt-zebra` receipt (29 Oct live run, REVIEW), labelled "Recorded run from 2026-10-29, not live" in EN and HI; it is not live and makes no call | `web/upload.html`, SPEC §12 |
| Hosted service, public deploy | the public Hugging Face Space in the README "Live demo" line (what it runs is UNVERIFIED there); the video does not show it | README |

Claims rule (PS-C1): name a model only with its call log in the receipt on
screen. SAM 3.1 and Muse Spark 1.3 have logs in the shirt jobs' receipts.

## Re-render script v7 (31 Oct, for the out/final video)

Superseded on 2 Nov by v8 (above); kept as history.

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
narration audio is the recorded voiceover (a generated Edge TTS voice,
en-IN-PrabhatNeural); nothing new is recorded for it.

| Beat | Time | Screen | Narration | Source |
|---|---|---|---|---|
| 1 Problem | 0:00 to 0:25 (25 s, cap 62) | Title card with the prior-work caption (below) on screen from 0:00 to 0:05, then the four phone photos of the plaid shirt; the agent caption (below) over the last sentence | An Indian boutique seller lists garments from their own phone photos. A cleaned-up shot or an AI try-on can quietly change the garment: its colour, its print, its length. ProofShot is an evidence-recovery agent that catches that before the listing goes live. | `data/garments/shirt-plaid` |
| 2 Agent loop | 0:25 to 1:10 (45 s, cap 112) | The keyless `npm run agent:demo` run (2-back.jpg is the image to publish), with the "canned verifier" label visible | This is the keyless agent demo. Its verifier is a labelled stand-in, so it shows the mechanics, not model accuracy. The seller gives three close-ups and no full-length view, and the gate says REVIEW. The agent reads the receipt and asks for the missing view. The seller adds it, the same gate runs again, and it says RELEASE. Nothing is published until the seller approves. A proposal carrying injected text is rejected, and publish stays blocked. | `scripts/agent-demo.ts`; run 31 Oct about 20:27 IST: run-1 REVIEW, run-2 RELEASE, published; injection REVIEW, publish refused. Each fact in the narration: three close-ups and no full-length view = the `closeups` photos (`collar_closeup`, `label_closeup`, `print_closeup`, header comment case 1); asks for the missing view and the seller adds it = `addPhoto` with `full_length_front`; nothing published until the seller approves = `approve(..., "publish", ...)` before `publish` (`publish` in `src/agent/service.ts` refuses without that approval); injected text rejected, publish blocked = case 2 |
| 3 Results | 1:10 to 1:50 (40 s, cap 100) | From 1:10, before Pruna is named: the receipt caption (below) over the verdict table of the try-on run; then the shirt-pink composite beside photo 1. No try-on image, no person in frame | Then five real garments. Pruna (via Replicate) made five AI try-ons. 0 of 5 AI try-ons released; every one held for review or refused, with the reason on the receipt. Composite v2 gave one RELEASE, three REVIEW and one REFUSE. The RELEASE is built from the seller's own pixels, cut out and moved, not a generated image. | `evidence/tryon/SUMMARY.md` (n = 10 jobs on 5 garments; Totals: "AI try-ons released: **0 of 5**"; "By method": Pruna try-on 0 RELEASE, 0 REVIEW, 5 REFUSE; composite v2 1 RELEASE, 3 REVIEW, 1 REFUSE); also SUBMISSION "0 of 5 AI try-ons were released" |
| 4 Verify page | 1:50 to 2:20 (30 s, cap 75) | `web/verify.html` opened from disk: VALID, then the one-byte copy: TAMPERED with the entry number | Every decision is written into a hash-chained receipt. The verify page checks every hash in the browser, with no server: VALID. Change one byte, and it says TAMPERED, with the entry number. | the v6 S7 and S8 frames (6 s each, 12 s of frames inside v6 beat 6, 0:54 to 1:10, 16 s). They are stills, so this script fills the 30 s by holding them longer, not by recapturing or slowing them. How the out/final render split the 30 s between S7 and S8 is not recorded in this repo (UNVERIFIED) |
| 5 Meta tooling | 2:20 to 2:45 (25 s, cap 62) | A receipt with its SAM 3.1 and Muse Spark 1.3 log entries, then one Baseten verifier log | SAM 3.1 segments the garment. Muse Spark 1.3 on the Meta Model API checks nine attributes. Earlier runs used Muse Spark Open via Baseten. Every call is logged, and a code gate, not a model, decides. | Muse Spark Open via Baseten checked against `evidence/verifier-*.json`: 19 logs with provider `baseten`, model `meta-models/muse-spark-open-1026`, 28 Oct to 29 Oct 00:43 UTC; later logs are `muse-spark-1.3` on `api.meta.ai` |
| Card | 2:45 to 2:50 (5 s, no narration, optional) | Prior-work card, text only (repeats the opening caption) | | the card text below |

Prior-work caption (beat 1, 0:00 to 0:05) and optional end card, on screen exactly:

Prior work: the written specification and config boilerplate only. Everything you see running was coded during the hackathon, from 27 Oct (first commit 15658a4). git log is public.

Beat 1 narration is verbatim from the recorded voiceover and is not
re-recorded (Grok 21:57 IST 31 Oct): its agent wording claims only catching. The agent is named in the caption instead, on screen over the last
sentence of beat 1, exactly:

Evidence-checking agent: it asks the seller for missing evidence, or refuses.

Beat 3 narration names Pruna (via Replicate), and record-day rule 1 says a model
is named only with its call log in the receipt on screen (Grok 23:45 IST 31 Oct,
AGW9). The narration is not changed; instead, from 1:10, before the second
sentence, this receipt caption is on screen over the verdict table, as text
only (the render entry, seq 2, of `evidence/tryon/shirt-pink/pruna/receipt.jsonl`;
no try-on image is opened), exactly:

Receipt evidence/tryon/shirt-pink/pruna/receipt.jsonl, entry 2: render, provider replicate-pruna-tryon, model prunaai/p-image-try-on, prediction 0zkmjnhac5rmw0d1j1eaxr46vc. Gate: REFUSE (fidelity).

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

For the v6 capture. For v9, the video to submit, the frames are not in this
repository, so whether each item below holds for it is UNVERIFIED here; the
voice line applies to v9 (and the superseded v8) as written.

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
- [ ] The recorded voiceover: a generated Edge TTS voice (en-IN-PrabhatNeural).
