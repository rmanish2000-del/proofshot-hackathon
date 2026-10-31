# Try-on render run, 31 Oct 2026

Before this run, the RELEASEs on `shirt-pink` and `kurta-mustard` came from the stand-in renderer, so fidelity
compared photo 1 with itself. In this run every garment got a real render that is a different image from every
source photo, and the unchanged pipeline judged it against the seller's photos, full-length front first. The gate,
`src/fidelity.ts` and every threshold are unchanged.

- **Renderers, side by side (Manish's choice, 31 Oct):**
  - `pruna`: an AI try-on by Pruna p-image-try-on on Replicate (third-party, non-Meta). It dresses a committed synthetic model: `synthetic-02` (ankle-length slip dress) for the kurtas and `synthetic-01` for the shirts. `PROOFSHOT_TRYON_LONG=1` is set, so the long kurtas are tried on too.
  - `composite`: composite v2. The garment is cut out by SAM 3.1 and placed on the mannequin by deterministic code; no image model is used.
- **No Meta image model:** the only one on our key is `muse-image-1.0`. It is not available in India (Meta Geographic Use Policy §2.2), and `src/render.ts` refuses it. Fireworks serves no Meta image model to our key.
- **Judge:** SAM 3.1 masks and the Muse Spark 1.3 verifier on api.meta.ai, then fidelity and the gate.
- **Self-comparison guard:** `src/tryon.ts` wraps every renderer. If a render has the sha256 of any source photo, it is `render_failed` before any verifier call, and the batch exits 1. It never fired in this run: no render matched a source photo.
- **Script:** `npm run tryon` (`scripts/tryon-batch.ts`). The dry run was `--only shirt-pink` and cost 0.0750 USD; the other 4 garments followed.

## Garments

There are 5 distinct garments. 3 of the 6 handoff folders were byte-identical to garments already here, so they were
treated as the same garment and not taken in again:

| Handoff folder | Same as |
|---|---|
| `kurta-yellow-lotus` (front, back) | `kurta-mustard` (same two files, same sha256) |
| `shirt-01` | `shirt-pink` |
| `kurta-01` | `kurta-red-floral` (its first photo has the same sha256; its second is a smaller copy of the same view) |

`shirt-grey-mufti/back_HAS_PERSON_LEGS.jpg` shows a person, so it was excluded before intake and never copied.

## Verdicts

| Garment | Renderer | Render | Gate | Cited | Fidelity | Cost (USD) |
|---|---|---|---|---|---|---|
| shirt-pink | pruna | `shirt-pink/pruna/pruna-r0.jpg` | **REFUSE** | fidelity: delta_e 37.95, hist 0.978, texture 0.547, area 0.116 | REFUSE | 0.0448 |
| shirt-pink | composite | `shirt-pink/composite/composite-r0.png` | **RELEASE** | none; all 9 attributes match | RELEASE | 0.0302 |
| kurta-mustard | pruna | `kurta-mustard/pruna/pruna-r0.jpg` | **REFUSE** | fidelity: delta_e 85.00, hist 0.931, texture 0.422 | REFUSE | 0.0425 |
| kurta-mustard | composite | none | **REVIEW** | render_quality: the garment is cut off at the edge of the photo | not run | 0.0050 |
| kurta-pink-patchwork | pruna | `kurta-pink-patchwork/pruna/pruna-r0.jpg` | **REFUSE** | fidelity: texture 0.500, area 0.296 | REFUSE | 0.0413 |
| kurta-pink-patchwork | composite | none | **REVIEW** | render_quality: the garment is cut off at the edge of the photo | not run | 0.0050 |
| kurta-red-floral | pruna | `kurta-red-floral/pruna/pruna-r0.jpg` | **REFUSE** | fidelity: delta_e 54.29, hist 0.900, texture 0.516, area 0.032 | REFUSE | 0.0380 |
| kurta-red-floral | composite | none | **REVIEW** | render_quality: the garment is cut off at the edge of the photo | not run | 0.0050 |
| shirt-grey-mufti | pruna | `shirt-grey-mufti/pruna/pruna-r0.jpg` | **REFUSE** | fidelity: delta_e 41.15, hist 0.929, texture 0.453 | REFUSE | 0.0530 |
| shirt-grey-mufti | composite | `shirt-grey-mufti/composite/composite-r0.png` | **REFUSE** | fidelity: delta_e 60.81, hist 0.976, texture 0.438, area 4.558 | REFUSE | 0.0379 |

**Totals:** n = 10 jobs on 5 garments.
- RELEASE 1: shirt-pink, composite.
- REVIEW 3: each a composite, cut off at the photo's edge, with no render made.
- REFUSE 6: all 5 try-ons and the grey shirt's composite.
- AI try-ons released: **0 of 5**.

**Spend:** 0.3028 USD of the 15 USD cap, as recorded in the two run files.
- Meta (SAM 3.1 and Muse Spark): 0.2277 USD.
- Replicate: 0.0750 USD (5 try-ons at the 0.015 USD estimate).

The per-job figures are rounded to 4 places, so they add up to 0.3027 USD.

Each job's model id, prompt, input and output hashes, and cost are in `<garment>/<renderer>.json`. The full record is
in `<garment>/<renderer>/receipt.jsonl`. The redacted call logs are in `logs/`, with no keys.

## What the numbers say, and what they do not

- **The one RELEASE is a composite.** It is the seller's own pixels moved onto a plain background: a different file
  from photo 1, but not a generated image. It shows that the judge passes an honest re-placement of the garment. It
  does not show that an AI try-on can pass.
- **Every AI try-on was refused on fidelity.** The verifier (Muse Spark) called most attributes a match on all 5. It
  found 2 sleeve-length mismatches (kurta-mustard and kurta-red-floral), a button mismatch (kurta-red-floral) and a
  pocket mismatch (shirt-grey-mufti); the polo's buttons were uncertain. The shortening seen before (`CLAIMS_AUDIT.md`,
  7 of 7 try-ons) happened again:
  - kurta-mustard came out above the knee with short sleeves;
  - kurta-red-floral came out as a short top over a grey skirt;
  - kurta-pink-patchwork came out as a short dress.

  The source fronts of pink-patchwork and red-floral do not show the hem, so the try-on had no length to keep.
- **The polo try-on looks right to the eye but was REFUSED.** Delta E 37.95 is far above what the picture suggests.
  The fidelity check compares the masked garment in the render with photo 1. Why the masks differ this much was not
  looked into in this run. No threshold was changed to see whether it would pass.
- **Three composites were REVIEW before any render.** In each, the garment touches the edge of the seller's front
  photo (`render_quality`), so the composite would show a cut-off garment.
- **The grey shirt's composite was REFUSE.** Its intake front photo lies sideways: the photo's Exif, which held the
  orientation, was removed at intake. The composite stood the shirt up wrongly, and the area grew 4.6 times.

## Good enough to show a client as samples

| Render | Show? | Why |
|---|---|---|
| shirt-pink composite | **yes, as a composite** | Released by the gate, clean flat-lay on white, garment unchanged. Say that it is the seller's own photo cut out, not an AI image. |
| shirt-pink pruna | **only as an example the gate held** | The closest-looking try-on, but the gate refused it. Do not present it as an approved listing image. |
| kurta-mustard pruna | no, except as a "caught" example | The length and sleeves are wrong; this is the failure ProofShot exists to stop. A good before/after with the REFUSE. |
| kurta-red-floral pruna, kurta-pink-patchwork pruna | no | Wrong garment length; the source photos do not show the hem. |
| shirt-grey-mufti pruna and composite | no | The try-on adds matching trousers and a pocket; the composite is sideways. Fixing the photo's rotation at intake comes first. |

Every try-on image shows the synthetic model (AI-generated, licence in `data/models/*/LICENSE.md`), not a real person.
Nothing here was deployed, uploaded or submitted.
