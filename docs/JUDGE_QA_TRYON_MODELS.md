# Judge Q and A: the try-on, the fidelity check and the models

Hard questions a skeptical judge could ask about the AI try-on and the models
ProofShot calls, with what the repo can and cannot back. Each answer cites the
README section (or file) it comes from. Counts are figure markers written by
`npm run figures` from committed evidence (this file is in `FIGURE_DOCS`, so a
test fails if they drift). Receipt and tamper questions are in
`docs/JUDGE_QA_TAMPER.md`; gate questions in `docs/JUDGE_QA_GATE.md`.

## 1. Which try-on model ran, how often, and what did it cost?

Pruna p-image-try-on (`prunaai/p-image-try-on`) on Replicate, a third-party,
non-Meta model: <!--f:pruna_all_calls-->12<!--/f--> calls, about <!--f:pruna_all_usd_est-->0.180<!--/f--> USD estimated. <!--f:pruna_calls-->7<!--/f--> were the kurta
calls of 28–29 Oct (<!--f:pruna_usd_est-->0.105<!--/f--> USD, the same as the Replicate spend ledger read on
29 Oct); the rest are in the 31 Oct try-on run, after that reading. The counts
come from the `replicate-pruna-tryon` render entries (`attempts`,
`cost_estimated_usd`, `prediction_id`). Source: README "What is verified and
what is not" (row "Live model calls") and "Providers"
(`PROOFSHOT_RENDER=replicate-pruna-tryon`).

Weak spot: the USD figures are estimates recorded per call and one ledger
reading, not a Replicate invoice.

## 2. Why was none of the try-on images released?

All <!--f:tryon_all_total-->12<!--/f--> committed try-on images were held by the gate: <!--f:tryon_all_refuse-->10<!--/f--> REFUSE, <!--f:tryon_all_review-->2<!--/f--> REVIEW,
none released. <!--f:tryon_total-->7<!--/f--> are kurta try-ons of 28–29 Oct (<!--f:tryon_refuse-->5<!--/f--> REFUSE, <!--f:tryon_review-->2<!--/f--> REVIEW); for the
long kurtas the try-on came back shorter. <!--f:tryon_run31_total-->5<!--/f--> are from the 31 Oct try-on run
(<!--f:tryon_run31_refuse-->5<!--/f--> REFUSE, `evidence/tryon/SUMMARY.md`). Source: README opening section
and "Providers".

Weak spot: <!--f:tryon_all_total-->12<!--/f--> images on few garments is a small sample; it shows the gate
held these outputs, not how often the try-on is wrong in general.

## 3. What does the fidelity check measure, and when does it measure nothing?

It compares the garment inside the SAM 3.1 mask of the render with the same
garment in the seller's photo (`src/fidelity.ts`, SPEC §10), against
`config/fidelity.json`: colour difference `delta_e` (REVIEW above 10, REFUSE
above 20), histogram distance `hist` (REVIEW above 0.35, REFUSE above 0.6),
`texture` similarity (REVIEW below 0.8, REFUSE below 0.65) and `area`, the
render's masked share of the frame over the source's (REVIEW below 0.4 or
above 2.5). With no mask it measures nothing, and in a live run that is REVIEW
at best, with the reason on the receipt. A fixture run's stub measures nothing
and returns RELEASE with `"metrics":null`, and its receipt says provenance
`fixture`. Source: the threshold numbers are `config/fidelity.json`, whose
`_note` marks them "Starting values, UNCALIBRATED (SPEC section 10)"; the
no-mask and fixture behaviour is README opening section and "Receipt format".

Weak spot: the thresholds are starting values marked UNCALIBRATED in
`config/fidelity.json`; `area` can only ask for REVIEW, never REFUSE, so a
shortened garment is held for a person, not refused, on that metric alone.

## 4. What did the fidelity check catch that the verifier missed?

On the <!--f:tryon_total-->7<!--/f--> kurta try-ons of 28–29 Oct, the Muse Spark verifier on its own passed
<!--f:ms4_changed_passed-->4 of 21<!--/f--> checks of those shortened try-ons (the 21 checks are over those <!--f:tryon_total-->7<!--/f--> jobs).
The fidelity check returned REVIEW or REFUSE on every one; the gate's cited
reason was fidelity for 4 of the 7 and the verifier for 3 (two timeouts, one
soft mismatch). Source: README opening section and "Limits" ("The verifier
misses length changes").

Weak spot: this is <!--f:tryon_total-->7<!--/f--> jobs on two kurtas, not a measured verifier error rate.

## 5. What does a seller see when an image is held?

The result card shows the badge (the page's own badge text, `badge` in
`web/upload.html`: "REVIEW: a person must look first", "REFUSE: not
released"), the gate's reasons in words under "Why", and, when an image was
made, "View receipt", which opens `verify.html` with the image hash filled in. "Publish to shop" is made
only on RELEASE, and the server refuses to publish anything else
(`UploadServer.publish` in `src/serve.ts`; `test/serve.test.ts`, "was REVIEW,
not RELEASE"). Source: README "Seller upload (built during the hackathon)";
`web/upload.html` for the badge text.

Weak spot: the page runs on the seller's own machine (`npm run serve`, on
127.0.0.1); nothing in this repo measures whether sellers understand the
reasons.

## 6. Which Meta models ran, and where are the logs?

SAM 3.1 (`meta/sam-3.1`, Meta Model API) segments the garment: <!--f:sam_calls-->130<!--/f--> logged calls in
the evidence pack (`evidence/sam-*.json`) plus <!--f:sam_calls_runs-->47<!--/f--> in the 30–31 Oct run logs
(`evidence/<run>/logs/`), <!--f:sam_calls_all-->177<!--/f--> in all. Muse Spark 1.3 (`muse-spark-1.3`, Meta
Model API) is the verifier: <!--f:muse13_calls-->226<!--/f--> in the pack (`evidence/verifier-*.json`,
`evidence/ms4/`; only the logs whose model is `muse-spark-1.3`: `src/figures.ts` reads the pack stage
`verify: muse-spark-1.3 (meta)` in `evidence/pack/summary.json`, which is split by logged model) plus <!--f:muse13_calls_runs-->16<!--/f--> in the run logs, <!--f:muse13_calls_all-->242<!--/f--> in all. muse-spark-open on
Fireworks writes listing copy after the gate (<!--f:fireworks_calls-->293<!--/f--> calls,
`evidence/fireworks-*.json`), and Muse Spark Open on Baseten was the first
verifier (<!--f:baseten_calls-->19<!--/f--> verifier calls in `evidence/verifier-*.json`; the two
`npm run call:baseten` smoke calls in `evidence/baseten-*.json` are not among
them; the 19 are the pack stage `verify: meta-models/muse-spark-open-1026 (baseten)`,
so none of them is among the <!--f:muse13_calls-->226<!--/f-->, README "What each Meta model does", Baseten row). The <!--f:sam_calls-->130<!--/f--> and <!--f:muse13_calls-->226<!--/f--> are evidence-pack counts, the ones
the deck and rendered videos quote. Source: README "What each Meta model does".

Weak spot: a model id in a log is the provider's answer, not proof of which
weights ran.

## 7. Did you use a Meta image generator?

No. Muse Image is refused on every provider before any request, because Meta's
Geographic Use Policy excludes India; the renderer is checked when it is built
and again before each request (`src/render.ts`; `test/render.test.ts`, "a Muse
Image model is refused on every provider before any request"). The candidate
images in the committed runs come from the composite (the seller's own pixels cut out by a SAM 3.1 mask, placed
by deterministic code) or from the Pruna try-on. Source: README opening section
and "Providers".

## 8. Was this built during the event?

Work in this repository starts with its first commit, `15658a4`, on 27 Oct 2026
at 11:10 IST, after the hackathon opened on 26 Oct 2026 at 21:30 IST. On 30 Oct
the history was re-authored to replace a personal email with a GitHub noreply
address; dates, messages and file contents are unchanged, but every hash
changed (the first commit was 4aa99f9 before). Source: README "Built during
the event"; `docs/HISTORY.md`.

Weak spot: the prior work used, `docs/SPEC.md`, the config boilerplate and
the synthetic-01 model image (generated 23 Oct 2026), predates the event, and
so does an earlier private prototype (`rmanish2000-del/proofshot`, 24–26 Oct
2026), code not copied; README "Prior work used" lists them.

## 9. Are the spend caps real money limits?

They are enforced in code, one ledger per account, and a call over its limit is
refused before it is sent. But "spent" is the sum of the ledger's per-call
estimates, not a provider bill. Source: README "Providers", the spend
caps paragraph (CAP1 / CAP1b).

Weak spot: the ledgers live in `%LOCALAPPDATA%\ProofShot`, outside the repo,
so a judge cannot read them; only the per-call estimates in committed files
can be checked.
