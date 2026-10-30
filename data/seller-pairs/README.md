# Real seller photo pairs (Evidence Recovery Agent)

Real photos for `npm run agent:real` (SUBMISSION.md, "Real seller photos, measured"). One folder per garment:
a deliberately bad photo (`1-...jpg`) and a full-length front (`2-full-front.jpg`), with `intake.json`,
`note.txt` and `WHY.txt` as in `data/garments/README.md`. The same intake removed the metadata; a test checks
it. Before intake, every photo was checked for people and personal data (none found; see each `WHY.txt`).

They live here rather than in `data/garments`, so the shop previews, calibration and the MS3/MS4 planners,
which read every garment folder, do not pick up the deliberately bad photos.
