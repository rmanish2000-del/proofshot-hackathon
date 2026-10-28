# ProofShot demo script v3 (proofshot-hackathon)

Status: v3, moved here from `handoff/DEMO_DRAFT.md` in `proofshot (coordination)` on
27 Oct 2026 23:10 IST for #25 (Grok's review of DeepSeek draft e6ae, fixes 1-8 applied).
"What exists today" and the shot list updated to master after c4feb75 (28 Oct, N14). Anything not yet true or not
yet known is `[TBD]`; a `[TBD]` is never read out or shown on screen.

Length at or under 2:48 (168 s). Screen recording only, burned-in captions. Voice:
Manish's own (an AI voice is UNVERIFIED against the rules). Word cap per beat =
seconds x 2.5 (150 wpm).

## What exists today (28 Oct 2026, master after c4feb75), so the script claims nothing else

Every row is something README.md already states; the commit is where it landed.

| Thing the video could show | State | Where |
|---|---|---|
| Gate, receipt chain, verify page, intake | built, tested; `npm test` 214 pass, 0 fail on c4feb75 (read 28 Oct 18:26 IST); CI run [40687065062](https://github.com/rmanish2000-del/proofshot-hackathon/actions/runs/40687065062) on 6ae5c28 reported green by Grok, not re-read here | `npm test` |
| Gate fails closed | absent or undefined verifier findings are `REFUSE not_verified` (56def45); a verifier answer cut off twice at max_tokens is `REFUSE verifier_truncated` (8d0b72b) | SPEC §2, §4 |
| Live Muse Spark Open verifier on Baseten | text call with content "ready" (ba9bb08); image calls with 9 per-attribute findings (fc31a99); call logs with the key replaced and images as size and hash | `evidence/verifier-*.json`, `docs/API-NOTES.md` |
| Live SAM 3.1 segmentation (`api.meta.ai`) | one logged call (4c5df28); live jobs `live-kurta-01-sam-2` (189f87c) and `live-kurta-02-sam` (1e05d38) with logged SAM calls; their render is the stand-in, so a RELEASE is **photo-vs-itself**: it shows the measured path runs, not accuracy | `data/jobs/`, `evidence/sam-*.json` |
| Deliberate mismatch | `live-kurta-01-mismatch` (9a765b4): kurta-02's front photo as kurta-01's render, REFUSE `hard_mismatch` on colour. One job (n=1), not an accuracy figure | `demo/recordings/live-kurta-01-mismatch` |
| Composite render | SAM-cut garment from the seller's front photo placed on the code-drawn `mannequin-01` template (6beed3a, 6ae5c28); `generative: false`, no image model, no person. `live-kurta-02-composite` RELEASE, `live-kurta-01-composite` REFUSE (answer cut off at 4096) (0e12a5e), re-run `live-kurta-01-composite-r2` RELEASE after NR2 (9e08fee). Composite v2 (ghost mannequin, no template) is built, but both kurta fronts REVIEW on its quality pre-check (clipped photo), so no v2 image exists and none may be shown before Manish signs one off | `data/jobs/live-kurta-0*-composite` |
| A generated on-model image | **none**: no generative render transport exists (SPEC §8) | — |
| Calibration | fidelity only, two garments, 20 of 20 pairs measured, per-metric values (d836ec3); a small sample, **not** a calibrated false-match rate; thresholds unchanged | `evidence/calibration-sam-20261028-1515.json` |
| Replay of a recorded run (`demo:replay`) | built (bd28f78): canned `refuse`, `review`, `release`, plus `live-kurta-01-2` and `live-kurta-01-mismatch` recorded from live jobs | `demo/recordings/` |
| Shopper preview | `fixture-shirt-01` (synthetic), `kurta-01`, `kurta-02` (owner's photo stands in for the render, 4aa4738) and the committed live jobs; stand-in cards tagged "owner's photo, stands in for render", composite cards "Composite: your garment photo on a mannequin. Not AI-generated." | `web/shop.html`, SPEC §11 |
| Seller upload page | built (00df7ae), local only (`npm run serve`); **not checked in a real browser** yet | `web/upload.html`, SPEC §12 |
| Judge quickstart | `npm ci`, `npm test`, `npm run serve`, `demo:replay` (448e081, 9e08ca3) | README |
| First commit of this repository | `4aa99f9` | — |
| `LICENSE` | MIT | `LICENSE` |
| Hosted service, public deploy | **none** | — |

Claims rule from the #23 audit (PS-C1): name a model only with its call log in the
receipt on screen. Muse Spark Open and SAM 3.1 now have committed logs with content
(`evidence/`); no other model does.

## Rules for record day

1. Name a model on screen or in the voiceover only if its call log is in the receipt
   being shown. SAM 3.1 and Muse Spark Open via Baseten have logs in the live jobs'
   receipts and `evidence/`; a canned recording has none, so no model is named over it.
   No log: cut the model from the video. Never an `UNVERIFIED` tag on screen.
2. Never name Muse Image, anywhere.
3. No price clause unless a sourced cost per image exists (fix 6).
4. Licence on the end slide only if `LICENSE` exists in this repository (MIT today).
5. Gate input fields shown in beat 5 are read from SPEC §2 of this repository on
   record day. Today: `attribute`, `verdict`, `confidence` per finding, plus the
   fidelity result (`decision`, `reasons`) as a second input that can only make the
   decision worse.
6. Any image of a garment that is the owner's photo is captioned as such on screen:
   the shop card's tag "owner's photo, stands in for render" (from the receipt's
   `stand-in` render entry) and the panel's "nothing was generated".

## Timecode table

| # | Timecode | Screen | Voiceover | Words / cap | Caption | Judging criterion |
|---|---|---|---|---|---|---|
| 1 | 0:00-0:05 | Title card (S1), plain text, showing the voiceover line | A wrong image can sink a seller. ProofShot proves what was checked. | 12 / 12 | same as voiceover | Eligibility (staff rule, Kai \| CV) |
| 2 | 0:05-0:19 | The three phone photos of kurta-01 (`data/garments/kurta-01`) on its judge page (S2), then the shop grid, `web/shop.html`, every card with its badge and tag per rule 6 (S3) | A boutique shoots three phone photos of a kurta. ProofShot's job is to turn them into on-model product images, and every image ships with a receipt that proves what was checked. | 31 / 35 | Phone photos in. Every image with a receipt. Preview: owner's photos stand in for renders. Nothing generated. | Impact 30% |
| 3 | 0:19-0:31 | Replay log page for the recorded job `live-kurta-01-2` (S4): the "Replay of a recorded run" label, then one line per receipt entry | This is a replay of the recorded job live-kurta-01-2. Each receipt entry is one line, and every line is chained to the one before it. | 25 / 30 | Replay of a recorded run. Each check chained into the receipt. | Meta tooling 25%, Demo 25% |
| 4 | 0:31-0:49 | The bytes of the kurta-01 receipt around the byte that will change (S5), then `web/verify.html` opened from disk with that receipt and image: VALID, then the one-byte copy: TAMPERED with the entry number (S6) | A buyer drops the receipt and the image onto the verify page. The page recomputes every hash in the browser, with no server and no account. The chain holds and the image is the released one: VALID. | 37 / 45 | No server. Every hash checked in the browser. VALID. | Technical depth 20%, Demo 25% |
| 5 | 0:49-1:05 | The changed byte, before and after (S7), then the gate section of the judge page for `live-kurta-01-2`: REVIEW, its one reason ("fidelity not run on this job: no mask was stored"), and the top of the receipt list (S8) | Now change one byte of the receipt. The page says TAMPERED and names the entry that broke. The gate decides from recorded checks alone: here REVIEW, because no mask was stored. | 31 / 40 | One byte changed: TAMPERED. Gate decision: REVIEW. | Technical depth 20% |
| 6 | 1:05-1:21 | The seller's kurta-01 photos beside a different kurta (kurta-02's front photo) as the image to publish (S9a), then the gate: REFUSE `hard_mismatch`, "fidelity not run on this job: no mask was stored" (S9b) | Here the image to publish shows a different kurta. The verifier flags a hard mismatch, and the gate refuses it. A wrong image cannot ship. | 25 / 40 | Colour changed. REFUSE. | Meta tooling 25%, Impact 30% |
| 7 | 1:21-1:33 | The canned `review` recording replayed on the judge page (S10): a soft mismatch on the hem (side slits gone), gate result REVIEW; synthetic findings, no model named | Not every difference is a refusal. Here the hem changed, a soft attribute, so the gate sends it to a person for REVIEW. Every outcome lands in the receipt. | 29 / 30 | Soft change: hem. Sent to REVIEW, not the shop. | Technical depth 20% |
| 8 | 1:33-1:41 | End slide (S11): name, one line, `github.com/rmanish2000-del/proofshot-hackathon`, "Licence: MIT" (`LICENSE` exists) | ProofShot. A wrong image cannot ship. The code written this week is at github dot com slash rmanish2000-del slash proofshot-hackathon. | 20 / 20 | github.com/rmanish2000-del/proofshot-hackathon | Demo 25% |

Timecodes are the cumulative shot seconds of `DEMO_SHOTS` (`src/demo-capture.ts`,
`shots.json`): 11 shots, 101 s, so the cut ends at 1:41. Word caps follow from those
seconds. Every beat's voiceover is within its cap (test/demo-capture.test.ts, DEMO1h).

Beat 3 (0:19) and beat 4 (0:31) replace the draft's two VALID beats with one (fix 4);
beat 7 uses the freed time for REVIEW so all three outcomes appear. Beat 5 drops the
banned-model half (fix 3). Beat 6 resolves the fix 1 / fix 2 conflict in favour of
fix 1: the model name is spoken only with a call log in the receipt on screen.

What the verify page shows for TAMPERED today (`src/core.js`, `checkChain`): the index
of the first entry that fails and one reason (`seq is ...`, `prev does not match the
previous hash`, `hash does not match the entry`). Check it in the browser before
recording (checklist).

## Shot list

| Shot | For beat | What to capture | Source |
|---|---|---|---|
| S1 | 1 | Title card with the opening line | slide |
| S2 | 2 | Three phone photos of one garment | `data/garments/kurta-01` (owner's own garment, no person, metadata stripped by intake) |
| S3 | 2 | The shop grid with badges, every card captioned by its tag (no generated on-model image exists) | `web/shop.html` served from `web/` (`npm run shop` first) |
| S4 | 3 | Terminal running the replay, label visible | `npm run demo:replay -- demo/recordings/live-kurta-01-2 out/replay` |
| S5 | 4 | The kurta-01 receipt bytes around the byte that will change | `web/shop/kurta-01/` receipt (the tamper bytes page of `npm run demo:capture`) |
| S6 | 4, 5 | Verify page: VALID, then TAMPERED with the entry number | `web/verify.html` opened from disk; receipt and image from `web/shop/kurta-01/` |
| S7 | 5 | Text editor changing one byte of the receipt file | any editor, on a copy |
| S8 | 5 | Gate decision for one job and the top of its receipt (no per-attribute gate input is on screen) | the gate section of `/judge?job=live-kurta-01-2` (`npm run serve`) |
| S9 | 6 | Seller's photos of kurta-01 beside a different kurta (kurta-02's front photo) as the image to publish, REFUSE `hard_mismatch` on colour. Not a recoloured render: none exists | `demo/recordings/live-kurta-01-mismatch` |
| S10 | 7 | A soft mismatch, REVIEW | `demo/recordings/review` (canned: synthetic findings, no model named) |
| S11 | 8 | End slide | slide |

## Recording checklist

- [ ] Opening line copied verbatim from `PREEXISTING_VS_HACKATHON.md` (proofshot, coordination).
- [ ] Every model named has its call log in the receipt on screen; none named otherwise. No Meta model is said to have been used until `evidence/` holds a call with non-null content.
- [ ] No Muse Image anywhere, no `UNVERIFIED` on screen, no price without a source.
- [ ] Every owner's-photo card on screen carries the tag "owner's photo, stands in for render", and its panel says "nothing was generated".
- [ ] Gate fields in beat 5 match SPEC §2 of this repository.
- [ ] The verify page really shows the broken entry for TAMPERED (check before recording).
- [ ] verify.html opened from disk (file:// URL visible), no server running.
- [ ] No terminal shows a key, a token, `.env`, an email address or a home path.
- [ ] Captions burned in; each beat under its word cap; total at or under 2:48.
- [ ] End slide URL is `github.com/rmanish2000-del/proofshot-hackathon`; licence only if `LICENSE` exists.
- [ ] Test count and CI claims in the video or README link the exact CI run.
- [ ] Manish's own voice.
