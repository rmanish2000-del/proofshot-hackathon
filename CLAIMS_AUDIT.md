# Claims audit (30 Oct 2026, round 4)

Every claim a judge reads or hears, from README.md, SUBMISSION.md, the pitch deck (`out/final/build/deck.py`,
exported to `ProofShot_Pitch.pptx` and `.pdf`) and the video scripts (`out/final/build/segments.py` for v3,
`segments_v3d.py` for v3d), checked against the code, the tests and the committed data. Numbers marked as
figures are written by `npm run figures` from the committed evidence; a test fails if they drift.

Verdicts: **proven** (code, a test or committed data shows it), **weak** (true as written only with a caveat;
softened or scoped where marked), **remove** (not supported; taken out). No claim needed removing in this pass.

## The product

| Claim (where) | Verdict | Evidence |
|---|---|---|
| A deterministic code gate, not a model, decides RELEASE / REVIEW / REFUSE (README intro, SUBMISSION, deck 1 and 3, video) | proven | `src/gate.ts` `decide()` imports only `src/types.ts`, no model or network; `test/gate.test.ts` (18 tests), `test/gate-edge.test.ts` (6) |
| Any doubt ends in REVIEW or REFUSE, never RELEASE (judge page line, deck 3, video frames) | proven for live runs; weak for fixture runs, now scoped | Gate rules in `src/gate.ts` (low_confidence and uncertain → REVIEW, missing finding → REFUSE); an unmeasured live fidelity check gives REVIEW at best (`src/fidelity.ts`). A no-key fixture run has a stub fidelity check that returns RELEASE unmeasured; README intro and Judge quickstart say so and the run is labelled `fixture` (`out/final/JUDGE_RUN.md` run 2) |
| Fidelity can only make a decision worse, never better (README) | proven | `src/gate.ts` lines 39-48; `test/gate-edge.test.ts` "fidelity is never cited over them" |
| Muse Spark 1.3 checks nine attributes (SUBMISSION, deck 3, video) | proven | `ATTRIBUTES` in `src/types.ts` (9); the three demo receipts each hold 9 findings from `muse-spark-1.3` |
| SAM 3.1 segments the garment (SUBMISSION, deck, video C3) | proven | `segments` entries name `meta/sam-3.1 (api.meta.ai)`; figure sam_calls (130 logged calls in `evidence/sam-*.json`) |
| Every step from intake to the gate decision is written into a SHA-256 hash-chained receipt (README, SUBMISSION) | proven | `src/pipeline.ts`, `src/receipt.ts`; `test/receipt.test.ts`; figure chains (42 of 42 verify) |
| Every ProofShot result has its receipt (video end card, deck) | weak, kept with a scope note | Every gate decision has one (`docs/SPEC.md` §3, implemented in `src/pipeline.ts`: every scene a job attempts ends with a `gate` entry). An upload rejected at intake (not a JPEG) gets an error and no decision, so no receipt (`src/serve.ts` line 327); that is not a result. The end card is in the rendered videos, so it stays; this row records the scope |
| `web/verify.html` re-checks the chain in the browser with WebCrypto and makes no network request (README, SUBMISSION, deck 5, video) | proven | CSP `default-src 'none'` in `web/verify.html`; a `fetch` from the page was blocked in both judge runs; `test/check.test.ts` runs the same core in Node |
| Change one byte and it says TAMPERED with the entry number (README, deck 5, video) | proven | Judge runs 1 and 2: "TAMPERED: the record does not verify: entry 1, seq is 2, expected 1"; `test/check.test.ts` |
| The receipt is a hash chain, not a signature; a file rewritten from the start is not detected (README, deck 5) | proven (a limit, stated) | `docs/SPEC.md` §3 threat model; `web/verify.html` intro text |
| Composite v2 places the seller's own garment pixels on a ghost mannequin with no image model (README, SUBMISSION, video) | proven | Render entry `provider: composite, model: composite-v2, generative: false` in `data/jobs/live-shirt-plaid-composite-v2-r3`; `src/composite*.ts` is deterministic code |
| No Meta image generator is used; Muse Image is refused at runtime (README, SUBMISSION, deck 6) | proven | `MuseImageRefused` in `src/render.ts`; `test/render.test.ts`, `test/verifier-meta.test.ts` MS2 2 |
| Listing copy (English and Hindi) is written after the gate, from the receipt, outside the chain (README, SUBMISSION, deck 6) | proven | `data/copy/*.json` records carry `receipt_head`; no copy entry kind exists in `src/pipeline.ts` |
| Intake strips photo metadata (deck 3, README) | proven for the tool; note | `src/intake.ts`, `test/intake.test.ts`. For the committed shirt photos there was nothing to strip (`intake.json` `removed: []`); DEMO.md says so |

## Evidence and numbers

| Claim (where) | Verdict | Evidence |
|---|---|---|
| 42 jobs, 43 renders committed; 42 of 42 hash chains verify (README, SUBMISSION, deck 7, video C4) | proven | figures jobs, renders, chains; `test/evidence-pack.test.ts` "the committed pack is current" |
| 37 of 37 recorded decisions reproduced at 1x; 0 false matches at every factor (README, SUBMISSION, deck 7, video C4) | proven, scoped | `evidence/calibration-jobs-2026-10-29.json`; 4 garments, all the owner's own, so it is not a calibrated error rate (said next to it everywhere) |
| 4 false refusals at 1x, all verifier failures, not a threshold effect (SUBMISSION, deck 7) | proven | same file; the 4 receipts carry `VerifierTransportError` (2) or `VerifierProtocolError` (2) |
| 153 of 153 wrong-garment runs refused; 65 of 68 pairs gave the same decision three times (README, SUBMISSION, deck 7) | proven, scoped | `evidence/ms4-summary.json`; verifier alone, these pairs only |
| AI try-ons: 7 of 7 held (5 REFUSE, 2 REVIEW), none released (README, SUBMISSION, deck 6 and 7, video C4) | proven | figures tryon_*; the 7 `replicate-pruna-tryon` receipts in `data/jobs/live-kurta-0*-tryon*` |
| "The fidelity check is what held every one" of the try-ons (README, SUBMISSION four places, deck 7) | **weak, fixed** | The fidelity check returned REVIEW or REFUSE on all 7, but the gate's cited reason was fidelity for 4 and the verifier for 3 (two timeouts, `not_verified`; one `soft_mismatch`). All five places now say exactly that |
| The verifier alone passed 4 of 21 shortened try-on checks (README, SUBMISSION, deck 7) | proven | figure ms4_changed_passed; `evidence/ms4-summary.json` `changed` |
| Logged calls: SAM 3.1 130, Muse Spark 1.3 226, Muse Spark Open on Baseten 19, muse-spark-open on Fireworks 293, Pruna 7 (README, SUBMISSION, deck 6, video C3) | proven | figures; `evidence/pack/summary.json`; Pruna from the receipts' render entries |
| "Built with Muse Spark Open" (README, SUBMISSION, deck 6, video C3) | proven | 19 logged Baseten verifier calls (`evidence/verifier-*.json`), the first verifier; 293 copy calls on muse-spark-open |
| Spend 5.99 / 4.83 / 0.105 USD (SUBMISSION) | proven as labelled | Ledger figures, each a per-call token estimate, not a bill; SUBMISSION says so |
| Per-call latency medians (SUBMISSION metrics) | proven, scoped | `evidence/pack/README.md`; across days and payload sizes, not a benchmark (said in the table) |
| General verifier accuracy, false-match rate on real sellers (anywhere) | not claimed | SUBMISSION metrics table marks them "not measured" |

## Demo, judge path and prior work

| Claim (where) | Verdict | Evidence |
|---|---|---|
| Every job in the demo video is a committed live job; no fixture receipt on screen (README, SUBMISSION) | proven | `test/demo-capture.test.ts` "Codex 2" |
| The demo shows the two shirts only; no kurta, no try-on image, no person (README, DEMO.md, SUBMISSION) | proven | `test/demo-capture.test.ts` DEMO1j; per-second frame review in VIDEO_NOTES.md and VIDEO_NOTES_v3d.md |
| No new paid call was made for the video (README, SUBMISSION) | proven | every frame is a committed job or page (`test/demo-capture.test.ts` DEMO1); the narration is Edge TTS, not a model API in this project |
| Quick verify in about two minutes, no key (README) | proven on one machine | `out/final/JUDGE_RUN.md` runs 1 and 2 (the pages and checks; `npm test` is listed separately at about five minutes) |
| The verify page works opened from disk (README) | proven in headless Edge only | demo capture frame S08a; not yet in a normal browser window (README says so) |
| The keyless static demo needs no server and no key, and is not published (README) | proven | `test/static-demo.test.ts`; built and served locally in round 4; nothing deployed |
| Built during the hackathon: first commit 15658a4 on 27 Oct 2026 at 11:10 IST, after the 26 Oct 21:30 IST opening; no commit dated before it (README, SUBMISSION, deck 8, video v3d C2) | proven | `git log --reverse --date=iso-local`: 15658a4 2026-10-27 11:10:32 +0530; history note in README and SUBMISSION (re-authored 30 Oct to remove a personal email, dates unchanged, was 4aa99f9) |
| Prior work is the written specification and config boilerplate only (README, SUBMISSION, deck 8, video C2) | proven | `docs/prior-work/` (pre-event text and the 27 Oct update, both copied unchanged with their blob hashes); changes made here are marked *(event)* in `docs/SPEC.md` |

## Framing (no data claimed)

| Claim (where) | Verdict | Note |
|---|---|---|
| A listing photo can quietly change the garment: colour, print, length (README, SUBMISSION, deck 1, video C1) | proven as a risk; observed: length | The 7 try-ons shortened long kurtas (`data/calibration/labels.json`); a colour or print change by an image tool was not observed in our committed runs (the colour mismatch shown is a different shirt). "Can" is kept; SUBMISSION states the observed case |
| Who it is for: Indian boutique sellers (deck 2, video) | **weak, softened** | No seller interviews or usage data. Deck slide 2 now says "Intended users ... (not yet tested with real sellers)" |
| "ProofShot checks every candidate listing image ... before it goes on sale" (video beat 2) | proven within ProofShot | Only a `release` entry gets a row in the shop preview (`src/shop.ts`, `test/shop.test.ts` "REVIEW and REFUSE jobs produce no row"); no real marketplace is connected |

## Evidence Recovery Agent (round 5)

Only claims proven by a test or a committed file are made about the agent.

| Claim (where) | Verdict | Evidence |
|---|---|---|
| The deterministic gate alone decides; the agent reaches it only through `rerun_gate` (SUBMISSION, README, demo video) | proven | `test/agent.test.ts` "agent 11" (no file in `src/agent/` imports the gate or the pipeline); "agent 4" (gate receipt byte-identical with or without the agent) |
| A real violation never triggers recovery (SUBMISSION, video) | proven, with one exception | "agent 5"; `test/agent-eval.test.ts` (20 of 20 committed violations: explain only, no request, no re-run). Exception since 31 Oct: a fidelity REVIEW/REFUSE where the receipt shows photo 1 is cropped, angled or partial may get a request to replace photo 1; the gate then re-runs from the start and decides |
| `request_replace_primary` is allowlisted and validated (current job, photo 1 only, only the problems the receipt shows, max 1 per job), only the job's own seller can approve the replacement, and the action, approval, replacement, result and cost are in the hash-chained agent section (SUBMISSION) | proven | `test/agent-replace.test.ts` "replace 1" to "replace 5" |
| After a replacement the gate verdict is the gate's own: the receipt is byte-identical to a direct gate run on the same photos (SUBMISSION) | proven | "replace 6" |
| The seller text for a mismatch or a fidelity breach says what would change the outcome, not "More photos will not change this" (SUBMISSION) | proven | "replace 7" |
| Tool allowlist and argument schemas enforced in code; anything else rejected and logged (SUBMISSION, video) | proven | "agent 1", "agent 7" |
| File access scoped to the seller's job (SUBMISSION) | proven | "agent 2" |
| Instruction-like filenames, EXIF text and model output cannot change the tools or the verdict (SUBMISSION, video) | proven for the cases tested | "agent 6" (filename, EXIF), "agent 7" (six malicious model proposals). Text drawn inside image pixels is not read by the agent at all (no OCR); the verifier's text output is parsed into findings by the pipeline as before |
| Caps: 4 steps, tool calls per step, step timeout, per-job and per-seller model calls and spend, image size (SUBMISSION) | proven | "agent 8", "agent 9", "agent 13" |
| Seller approval before any paid call and before publish; nothing auto-publishes (SUBMISSION, video) | proven | "agent 9", "agent 7" (publish refused on REVIEW) |
| The agent section records every proposal, validation, approval, result, cost, latency and the gate decision, hash-chained, no secrets (SUBMISSION, video) | proven | "agent 10" |
| Two sellers' jobs run at the same time without mixing files; one seller is held to its concurrent limit (SUBMISSION, AGENT_SCALING) | proven locally | "agent 12" |
| On the committed jobs: 0 decisions changed, 20 violations left alone, 5 photo requests, 4 paid re-check proposals, 0 resolved; try-ons held 7 of 7 before and after (SUBMISSION, video) | proven | `evidence/agent-eval-2026-10-30.json`; `test/agent-eval.test.ts` keeps it current |
| The agent resolves real REVIEWs | **not claimed** | measured on 2 real seller pairs only: resolved 0 of 2 without replacement (`evidence/agent-real-2026-10-30.json`), 1 of 2 with replacement (`evidence/agent-replace-2026-10-31.json`), 2 of 2 with replacement and the label signal (`evidence/agent-replace-2026-10-31-label.json`, the kurta re-run); on the 43 committed receipts resolved 0 of 43 |
| Replace the first photo on the 2 real pairs (live SAM 3.1 + Muse Spark 1.3, 31 Oct): polo asked (cropped, from the mask box), REFUSE → RELEASE; kurta not asked (the verifier's wording missed the fixed patterns), REFUSE; 3 live runs, 0.0756 USD (SUBMISSION) | proven | `evidence/agent-replace-2026-10-31.json`, receipts and agent sections in `evidence/agent-replace-2026-10-31/store/records/`. The polo RELEASE compares photo 1 with a stand-in render that is the same file; it shows the evidence path, not image fidelity |
| Kurta re-run with the label signal (photo 1 labelled `full_length_back`, 31 Oct): asked to replace (partial view), REFUSE → RELEASE; 2 live runs, 0.0433 USD; total across both runs 0.1189 USD (SUBMISSION) | proven | `evidence/agent-replace-2026-10-31-label.json` and its records; "replace 7" checks the label catches the 31 Oct receipt the note patterns missed. The RELEASE compares photo 1 with a stand-in render that is the same file |
| A new photo 1 equal to the image to publish cannot pass as a fidelity check (SC1, SUBMISSION) | proven | `src/tryon.ts` `selfComparisonReview`, applied in `src/recovery-gate.ts` `pipelineGate`; `test/agent-replace.test.ts` "replace 8" (REVIEW, plain receipt reason, no release, publish refused) and "replace 9" (only ever stricter). The polo and kurta RELEASEs above were self-comparisons and would be REVIEW if run today; their records are kept as they happened |
| The replace trigger reliably finds a bad first photo | **not claimed** | the note patterns missed the kurta on 31 Oct (they match the verifier's wording); the label signal only helps when the seller labels photo 1 honestly; a cropped front labelled `full_length_front` relies on the mask box. 2 pairs measured |
| On 2 real seller pairs (pink polo, mustard kurta; live SAM 3.1 + Muse Spark 1.3): 0 of 2 resolved; the gate refused on fidelity against the first (bad) photo, and adding the full-length photo changed no fidelity number while Muse Spark matched every attribute; 4 seller steps per garment; 0.106 USD (SUBMISSION) | proven | `evidence/agent-real-2026-10-30.json`, receipts and agent sections in `evidence/agent-real-2026-10-30/store/records/`; photos in `data/seller-pairs/shirt-pink`, `data/seller-pairs/kurta-mustard` (people and personal-data check noted in each `WHY.txt`) |
| Keyless demo: REVIEW → photo request → RELEASE (video, README) | proven as a demo of the mechanics | "agent 3"; the verifier is a labelled canned stand-in, so this shows mechanics, not accuracy (said on screen and in the docs). Since SC1 the demo's image to publish is a photo the seller never lists (before, it was the added front photo itself; the recorded video shows that earlier run) |
| OWASP LLM06 Excessive Agency | design guidance only | cited as guidance, not as a certification or audit |
| Scaling to a managed queue and more workers | **plan, not built** | `docs/AGENT_SCALING.md` |

## Try-on render run (31 Oct 2026)

Until this run, the shirt-pink and kurta-mustard RELEASEs above compared photo 1 with a stand-in render that is the
same file. Here every garment got a render that differs from every source photo: a guard refuses a render with any
source photo's sha256. The unchanged gate judged each render. Summary: `evidence/tryon/SUMMARY.md`.

| Claim (where) | Verdict | Evidence |
|---|---|---|
| On 5 real garments (pink polo, mustard kurta, pink patchwork kurta, red floral kurta, grey shirt), 10 jobs with Pruna try-on and composite v2 side by side: RELEASE 1 (the polo's composite), REVIEW 3 (composites whose garment touches the photo edge), REFUSE 6 (all 5 AI try-ons and the grey shirt's composite); 0.3028 USD (Meta 0.2277, Replicate 0.0750) | proven | `evidence/tryon/<garment>/<renderer>.json` and receipts; `evidence/tryon/run-2026-10-31T05-*.json` |
| A render is never judged against itself in this run | proven | `src/tryon.ts` `guardRenderer`; `test/tryon.test.ts` TRYON 1 to 3; no render's sha256 equals a source photo's (`self_comparison: null` in every job file) |
| An AI try-on can pass the gate | **not claimed** | 0 of 5 released in this run, 0 of 12 across all committed try-ons; the polo try-on looks close but was refused on fidelity (delta_e 37.95), cause not investigated, no threshold changed |
| The composite RELEASE shows image fidelity | **not claimed** | it is the seller's own pixels moved onto a plain background; it shows the judge passes an honest re-placement, not a generated image |
| No Meta image generator is used | proven | the only one on the key is `muse-image-1.0`, refused (`src/render.ts`, SPEC §8, not available in India); the try-ons are Pruna on Replicate, third-party and non-Meta |
