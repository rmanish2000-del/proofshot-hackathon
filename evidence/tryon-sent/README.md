# Garment image sent to the Pruna try-on (NR4d debug)

Made offline with `npm run composite:preview -- <sam log> <front photo> <out.png> tryon-garment`,
which runs the same `garmentCutout` the Replicate try-on sends (seller pixels inside the SAM mask,
white outside, with the NR4d white margin). No request was made. Debug only, not a product shot.
No person in frame.

| File | SAM log | Photo | Size |
| --- | --- | --- | --- |
| kurta-02-front-garment.png | evidence/sam-2026-10-28T17-36-59-141Z.json | data/garments/kurta-02/1-front.jpg | 792x1456 |
| kurta-01-front-garment.png | evidence/sam-2026-10-28T17-38-33-411Z.json | data/garments/kurta-01/1-front.jpg | 772x1387 |

Both cut-outs run the full length of the kurta, hem included (kurta-02 mask box y 0.1525 + h 0.8125,
bottom at 0.965 of the photo; kurta-01 full sleeves and hem lace present). The images sent in
9b3b226 and 4427c81 had the same mask with no margin, so the hip-length outputs were not caused by
a cropped garment input.
