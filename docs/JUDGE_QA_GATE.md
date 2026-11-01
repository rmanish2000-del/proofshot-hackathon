# Judge Q and A: the gate and the verifier

Five hard questions a skeptical judge could ask about who decides and what the
verifier did, with what the repo can and cannot back. Each answer cites the
README section it comes from. Numbers in a figure marker are written by
`npm run figures` (this file is in `FIGURE_DOCS`, so a test fails if they
drift); the other numbers are copied from README as of 1 Nov 2026 and a test
compares them with the figures.

## 1. Who actually decides RELEASE, REVIEW or REFUSE?

The gate: `decide()` in `src/gate.ts`, plain code. Its input is the verifier's
findings (`attribute`, `verdict`, `confidence`) and, optionally, the fidelity
result; no other field exists, so no prompt, note or model prose reaches the
decision. A duplicate or unknown attribute, a confident mismatch on a hard
attribute (`color`, `print_pattern`, `logo_text`, `collar`), or an attribute
with no finding is REFUSE; low confidence, a soft mismatch or `uncertain` is
REVIEW; otherwise RELEASE. Muse Spark 1.3 is the verifier only: it returns
findings and never decides. Source: README "How the gate decides"; "What each
Meta model does".

Weak spot: the gate is only as good as the findings it reads, and README
"Limits" says verifier accuracy is not measured in general. What was measured
is small: in the Muse Spark cross-check (MS4) the verifier refused
<!--f:ms4_wrong_refused-->153 of 153<!--/f--> wrong-garment runs and released <!--f:ms4_same_released-->24 of 30<!--/f--> same-garment runs, on
four garments only (README "Limits").

## 2. What happens when the verifier gives no answer or is cut off?

It fails closed. An attribute with no finding is REFUSE, and `NaN` confidence
counts as 0 (README "How the gate decides"). The answer limit has had three
settings over time: 1500, then 4096, then 8192 with one retry at 16384. On 28 Oct the first live job, `live-kurta-01`, ran
with `max_tokens` 1500 on Muse Spark Open (Baseten); the answer stopped at that
limit (`finish_reason` `length` in
`evidence/verifier-2026-10-28T03-55-00-289Z.json`), so the gate saw no findings
and said REFUSE. The limit then went to 4096, which also cut off a later answer
(`evidence/verifier-2026-10-28T12-30-54-012Z.json`), and since then the
verifier sends `max_tokens` 8192 and asks once more at 16384 when the answer
stops at the limit; a second cut-off answer is REFUSE (`verifier_truncated`),
never a pass (`src/verifier.ts`; the Muse Spark 1.3 client in
`src/verifier-meta.ts` uses the same two limits). Source: README "Seller
upload" (the `live-kurta-01` paragraph); "Built with Muse Spark";
`docs/HISTORY.md`.

Weak spot: a failed or cut-off call costs a RELEASE, not safety: all
4 false refusals in the calibration set are renders where the verifier gave no
answer.

## 3. How large is the calibration set, and how many false refusals did it find?

37 labelled renders (18 same, 19 different) at the shipped thresholds: 0 false
matches, 4 false refusals (all where the verifier gave no answer), 6
unmeasured; the recorded decisions were reproduced 37 of 37
(`evidence/calibration-jobs-2026-10-29.json`). Source: README "What is verified
and what is not", row Calibration; "Limits".

Weak spot: 37 renders of 4 garments, all the owner's own, support a self-check,
not a false-refusal rate.

## 4. Which verifier model ran, and where are its call logs?

Today Muse Spark 1.3 (`muse-spark-1.3`) on the Meta Model API (`api.meta.ai`):
226 logged calls in `evidence/verifier-*.json` and `evidence/ms4/`, plus 16 in
the 30–31 Oct run logs (`evidence/<run>/logs/`). The first verifier was Muse
Spark Open (`meta-models/muse-spark-open-1026`) on Baseten: 19 logged calls in
`evidence/verifier-*.json`. Two `npm run call:baseten` smoke calls
(`evidence/baseten-*.json`) asked for one word and are not verifier calls.
Every log has the key replaced and the images replaced by their size and hash.
Source: README "What each Meta model does"; "Built with Muse Spark".

Weak spot: the logs are written by our own code; the model id in a log is the
provider's claim, not proof of which weights ran, and no provider bill was
read.

## 5. What does the gate miss?

Two things. First, the receipt chain catches an edited, reordered or forged
entry and one deleted from the middle, but there is no signature or outside
witness, so a file rewritten from entry 0, or cut short at the end, still
verifies as a chain; a cut that removes the `release` entry makes the verify
page say NOT RELEASED for that image (or TAMPERED, in no entry, if its `render`
entry is cut too), never VALID (README "Receipt format").
Second, the verifier alone misses some length changes: in the Muse Spark
cross-check it passed 4 of 21 checks of try-ons that had shortened the garment
(3 checks each of the 7 committed kurta try-on jobs of 28–29 Oct). On those 7
jobs the measured fidelity check returned REVIEW or REFUSE on every one, so the
gate held them all (README "Limits", "What is verified and what is not").

Weak spot: fidelity measures only when SAM 3.1 masks exist; with no mask it is
unmeasured and gives REVIEW at best, so a length change then rests on the
verifier and a person.
