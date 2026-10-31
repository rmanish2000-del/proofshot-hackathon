# Real seller photo pairs (evidence-checking agent)

Real photos for `npm run agent:real` (SUBMISSION.md, "Real seller photos, measured"). One folder per garment:
a deliberately bad photo (`1-...jpg`) and a full-length front (`2-full-front.jpg`), with `intake.json`,
`note.txt` and `WHY.txt` as in `data/garments/README.md`. The same intake removed the metadata; a test checks
it. Before intake, every photo was checked for people and personal data (none found; see each `WHY.txt`).

They live here rather than in `data/garments`, so the shop previews, calibration and the MS3/MS4 planners,
which read every garment folder, do not pick up the deliberately bad photos.

`kurta-pink-patchwork`, `kurta-red-floral` and `shirt-grey-mufti` (31 Oct) are for the try-on render run
(`npm run tryon`, `evidence/tryon/SUMMARY.md`). They have no deliberately bad photo, and each lists its full-length
front first. The same `WHY.txt` check for people was made; `shirt-grey-mufti`'s back photo showed a person and was
not taken in.
