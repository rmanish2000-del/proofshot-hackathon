# ProofShot demo script v3 (proofshot-hackathon)

Status: v3, moved here from `handoff/DEMO_DRAFT.md` in `proofshot (coordination)` on
27 Oct 2026 23:10 IST for #25 (Grok's review of DeepSeek draft e6ae, fixes 1-8 applied).
Updated to what this repository holds at commit 4aa4738. Anything not yet true or not
yet known is `[TBD]`; a `[TBD]` is never read out or shown on screen.

Length at or under 2:48 (168 s). Screen recording only, burned-in captions. Voice:
Manish's own (an AI voice is UNVERIFIED against the rules). Word cap per beat =
seconds x 2.5 (150 wpm).

## What exists today (27 Oct 2026, 4aa4738), so the script claims nothing else

| Thing the video could show | State | Where |
|---|---|---|
| Gate, receipt chain, verify page, intake, shop preview | built, tested | `npm test`: 120 pass, 0 fail, read in this session; CI run [40549673953](https://github.com/rmanish2000-del/proofshot-hackathon/actions/runs/40549673953) reported green by Grok, not re-read here |
| Shop preview rows | 3: `fixture-shirt-01` (synthetic image), `kurta-01`, `kurta-02` (the owner's own front photo stands in for the render; nothing generated, no person) | `web/shop.html`, `web/shop/catalog.json`, SPEC §11 |
| A generated on-model image | **none**: no render transport exists (SPEC §8) | — |
| Replay of a recorded run (`demo:replay`) | **not rebuilt** (SPEC §7); assigned 27 Oct 23:00 | — |
| Live Muse Spark Open call on Baseten | first call HTTP 200, `content` null, model use **UNVERIFIED** | `evidence/`, #16 |
| SAM 3.1 segmentation | **not built**; the fidelity check exists in code but no checker decodes SAM masks in the pipeline yet | SPEC §10 |
| First commit of this repository | `4aa99f9` (checked with `git rev-list --max-parents=0 HEAD`) | — |
| `LICENSE` | **none** in this repository | — |
| `PREEXISTING_VS_HACKATHON.md` | lives in `proofshot (coordination)`; this repo's README has "Built during the event" | README |

Claims rule from the #23 audit (PS-C1): the video must not say any Meta model was used
until a call log with non-null model content is committed under `evidence/`.

## Rules for record day

1. Name a model on screen or in the voiceover only if its call log is in the receipt
   being shown. Expected: SAM 3.1 after #22, Muse Spark Open via Baseten after #16.
   No log: cut the model from the video. Never an `UNVERIFIED` tag on screen.
2. Never name Muse Image, anywhere.
3. No price clause unless a sourced cost per image exists (fix 6).
4. Licence on the end slide only if `LICENSE` exists in this repository (none today).
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
| 1 | 0:00-0:08 | Title card, plain text | [TBD: one line, verbatim from `PREEXISTING_VS_HACKATHON.md` (proofshot, coordination): what was pre-existing, what was built this week] | [TBD] / 20 | same as voiceover | Eligibility (staff rule, Kai \| CV) |
| 2 | 0:08-0:22 | Three phone photos of one kurta (`data/garments/kurta-01`), then [TBD: the on-model images from a live run, once a render transport exists; until then the shop grid, `web/shop.html`, three cards with the badge, captioned per rule 6] | A boutique shoots three phone photos of a kurta. ProofShot's job is to turn them into on-model product images, and every image ships with a receipt that proves what was checked. | 30 / 35 | Phone photos in. Every image with a receipt. [if shop grid: Preview: owner's photos stand in for renders. Nothing generated.] | Impact 30% |
| 3 | 0:22-0:48 | Terminal: [TBD: `npm run demo:replay` once SPEC §7 is rebuilt here], the "Replay of a recorded run" label visible, receipt entries scrolling | This is a replay of a recorded run, and the screen says so. [TBD: one sentence naming only the models with a call log in this receipt, at most 15 words; today there is none, so the sentence is cut] Every check is written into the receipt, and each entry is chained to the one before it. | 30 + [TBD, at most 15] / 65 | Replay of a recorded run. Each check chained into the receipt. | Meta tooling 25%, Demo 25% |
| 4 | 0:48-1:18 | Wi-Fi icon switched off, then `web/verify.html` opened from disk: `receipt.jsonl` and the image dropped in, VALID | Wi-Fi is off. A buyer drops the receipt and the image onto the verify page. The page recomputes every hash in the browser, with no server and no account. The chain holds and the image is the released one: VALID. | 40 / 75 | Offline. Every hash checked in the browser. VALID. | Technical depth 20%, Demo 25% |
| 5 | 1:18-1:41 | Edit one byte of the receipt in a text editor, drop it again: TAMPERED, with the entry number and reason the page prints. Then the gate input, one line per attribute | Now change one byte of the receipt. The page says TAMPERED and names the entry that broke. The gate itself only ever sees three fields per attribute: attribute, verdict and confidence. No prompt or model note can reach the decision. | 40 / 57 | One byte changed: TAMPERED. The gate sees attribute, verdict, confidence. Nothing else. | Technical depth 20% |
| 6 | 1:41-2:06 | Original garment beside a recoloured render, the garment mask, the colour mismatch, REFUSE [TBD: needs the fidelity checker wired into the pipeline with real masks] | Here the generator changed the garment's colour. [TBD if a SAM 3.1 call log is in this receipt: "SAM 3.1 cuts out the garment,"; otherwise: "The garment is cut out,"] the fidelity check finds the colour changed, and the gate refuses it. A wrong image cannot ship. | 30 / 62 | Colour changed. REFUSE. | Meta tooling 25%, Impact 30% |
| 7 | 2:06-2:31 | A render with different buttons, gate result REVIEW, then the three outcomes side by side [TBD: a recorded REVIEW job] | Not every difference is a refusal. Here the buttons changed, a soft attribute, so the gate sends the image to a person for REVIEW instead of to the shop. RELEASE, REVIEW, REFUSE: every outcome lands in the receipt. | 38 / 62 | Small difference: a person decides. RELEASE / REVIEW / REFUSE. | Technical depth 20% |
| 8 | 2:31-2:48 | End slide: name, one line, `github.com/rmanish2000-del/proofshot-hackathon` [licence line only if `LICENSE` exists; none today] | ProofShot. A wrong image cannot ship. The code written this week is at github dot com slash rmanish2000-del slash proofshot-hackathon. | 20 / 42 | github.com/rmanish2000-del/proofshot-hackathon | Demo 25% |

Beat 3 (0:22) and beat 4 (0:48) replace the draft's two VALID beats with one (fix 4);
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
| S3 | 2 | [TBD: on-model renders from a live run] or the shop grid with three badges | `web/shop.html` served from `web/` (`npm run shop` first) |
| S4 | 3 | Terminal running the replay, label visible | [TBD: SPEC §7 rebuilt here] |
| S5 | 4 | System tray showing Wi-Fi off | OS |
| S6 | 4, 5 | Verify page: VALID, then TAMPERED with the entry number | `web/verify.html` opened from disk; receipt and image from `web/shop/kurta-01/` |
| S7 | 5 | Text editor changing one byte of the receipt file | any editor, on a copy |
| S8 | 5 | Gate input printed for one job | [TBD: command in this repo; today the `verifier` entry of the receipt shows the findings] |
| S9 | 6 | Original vs recoloured render, mask, REFUSE | [TBD: fixture or recording in this repo] |
| S10 | 7 | Buttons-changed render, REVIEW | [TBD: recording in this repo] |
| S11 | 8 | End slide | slide |

## Recording checklist

- [ ] Opening line copied verbatim from `PREEXISTING_VS_HACKATHON.md` (proofshot, coordination).
- [ ] Every model named has its call log in the receipt on screen; none named otherwise. No Meta model is said to have been used until `evidence/` holds a call with non-null content.
- [ ] No Muse Image anywhere, no `UNVERIFIED` on screen, no price without a source.
- [ ] Every owner's-photo card on screen carries the tag "owner's photo, stands in for render", and its panel says "nothing was generated".
- [ ] Gate fields in beat 5 match SPEC §2 of this repository.
- [ ] The verify page really shows the broken entry for TAMPERED (check before recording).
- [ ] Wi-Fi off before beat 4 and visibly so.
- [ ] No terminal shows a key, a token, `.env`, an email address or a home path.
- [ ] Captions burned in; each beat under its word cap; total at or under 2:48.
- [ ] End slide URL is `github.com/rmanish2000-del/proofshot-hackathon`; licence only if `LICENSE` exists.
- [ ] Test count and CI claims in the video or README link the exact CI run.
- [ ] Manish's own voice.
