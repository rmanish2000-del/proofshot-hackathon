# ProofShot: Devpost submission fields

Assembled from drafts reviewed by Grok on #23 (proofshot coordination,
29 Oct 2026 18:05 IST). Every figure below was checked against this repo's
README, receipts or evidence files on 29 Oct 2026 at 18:40 IST (master
070dd9d); the source is named under each section. Anything not yet drafted or
not yet proven is marked **UNVERIFIED** and must not be pasted into Devpost as is.

## Problem

**UNVERIFIED**: no reviewed draft yet. Leave empty until one is accepted on #23.

## Challenges we ran into

- Early live checks on Baseten occasionally returned no findings; my gate
  treats that as not verified and refuses to release instead of passing it
  silently.
- One recording had no stored mask, so the fidelity check couldn't run. The
  job view now says that explicitly instead of showing a misleading REVIEW.
- Generated listing copy sometimes truncated or described the software rather
  than the garment, so I added a copy audit and fix pass.
- Partner credits run under hard per-provider caps, and the reserve only opens
  with an explicit opt-in.
- With only two garments so far, calibration is a self-check rather than a
  true error rate.

Checked against:
- No findings, refused: data/jobs/live-kurta-01 (verifier finish_reason
  length, gate REFUSE not_verified); verifier timeouts also fail closed (README
  try-on row, NR4c e19b817).
- No stored mask: data/jobs/live-kurta-01-mismatch has no segment with mask
  bytes; the judge view line is from a13273f.
- Copy audit and fix: 86cffe1 (FW2 copy fix: 140 texts over 35 jobs, 135 by
  the model, 5 template).
- Caps and reserve: README spend section (Fireworks 60 USD batch + 40 reserve,
  Meta Model API 80 USD batch + 70 reserve; the reserve is spent only by a call
  made with `PROOFSHOT_USE_RESERVE=1`).
- Two garments: data/garments has kurta-01 and kurta-02 with photos.

## Calibration

Commit ef5cf43 adds `npm run calibrate:jobs`. It re-judges 31 labelled renders
from committed receipts (13 same garment, 18 different) at threshold factors
0.5x to 2x. At 1x it reproduces the recorded gate decision on 31 of 31. The
gate reports 0 false matches at every factor; 2 false refusals at 0.75x to 2x
(two jobs where the verifier returned no findings, so not_verified); 7 false
refusals at 0.5x. Four fixture renders are skipped because their fidelity
values were written, not measured. No threshold changed. Only two garments and
many repeated images, so this is not a calibrated error rate.

Checked against evidence/calibration-jobs-2026-10-29.json (gate table: same 13,
different 18, false_match 0 at every factor, false_refuse 7 at x0.5 and 2 at
x0.75, x1, x1.5, x2; skipped: fixture-shirt-01-r0, fixture-shirt-01-r1,
kurta-01-r0, kurta-02-r0) and a fresh `npm run calibrate:jobs` on 070dd9d,
which printed "x1 against the gate decision each receipt recorded: 31 of 31
the same".

## Built with / How we built it

**UNVERIFIED**: waits on the DeepSeek SUB4 draft and Grok's review.

## Demo script (90 s)

**UNVERIFIED**: waits on the DeepSeek DEMO14 draft and Grok's review. The
current shot list and voiceover are in docs/DEMO.md (101 s).

## What's next

**UNVERIFIED**: no reviewed draft yet.
