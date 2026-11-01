# Judge Q and A: the tamper check and the receipt chains

Five hard questions a skeptical judge could ask about the receipts, with what the
repo can and cannot back. Each answer cites the section it comes from. Counts
are figure markers written by `npm run figures` from the committed receipts
(this file is in `FIGURE_DOCS`, so a test fails if they drift). The model and
try-on questions are in `docs/JUDGE_QA_TRYON_MODELS.md`.

## 1. If I rewrite the whole receipt file, does your page notice?

No. The receipt is a SHA-256 hash chain, not a signature. It catches an edited
payload, a reordered line, a line deleted from the middle, or a forged entry,
but not a file rewritten from the first entry, and not lines cut off the end:
deleting the last entries leaves a shorter file that still verifies, and only
the git history shows it. If the cut removes an image's `release`
entry, the page says NOT RELEASED for that image (or TAMPERED, in no entry, if
its `render` entry is cut too), never VALID (`test/check.test.ts` RV2 8). Source: `docs/SPEC.md` §3 threat model;
`CLAIMS_AUDIT.md`, row "The receipt is a hash chain, not a signature";
README "Receipt format".

Weak spot: there is no signature, no enforced append-only store and no external
witness ("append-only" in the README is a write convention: the code only
appends, but nothing stops a later rewrite), so a VALID result shows the file
is consistent with itself, not that nobody rewrote it.

## 2. You say one changed byte reads TAMPERED. Is that true for every byte in the file?

No, only for bytes in an entry's content: `seq`, `at`, `kind`, `payload`, `prev`
or `hash`. The page parses each line as JSON first, so whitespace between JSON
tokens, key order, blank lines or an extra top-level field still read VALID;
`test/claims-wording.test.ts` "CA1 1" checks each of the four on a committed
receipt. Source:
`evidence/pack/README.md` "Verify a receipt offline"; `CLAIMS_AUDIT.md`, row
"Change one byte" (scoped, CA1).

Weak spot: the recorded voiceover still says "Change one byte"; only the written
docs carry the scope.

## 3. Does VALID prove that this image is the one the seller published?

It proves the image's sha256 matches a `release` entry in a chain that
verifies. It does not prove the shop delivered that file. A hash not in a
release gets NOT RELEASED when a matching `render` entry exists, and TAMPERED
otherwise (`checkImageWith` in `src/core.js`). Source: `docs/SPEC.md` §9 image check
and §6 gap 1; `evidence/pack/README.md` "Verify a receipt offline".

Weak spot: "the hashed image is not provably the delivered image" (SPEC §6),
and the model id in a receipt is the provider's claim, not proof of which
weights ran.

## 4. How many receipts actually verify, and who checked them?

As in the README Receipts row: <!--f:jobs-->42<!--/f--> jobs with a render, <!--f:renders-->43<!--/f--> renders, <!--f:chains-->42 of 42<!--/f--> hash
chains verify (fixture-shirt-01 has more than one render). With the <!--f:receipts_no_render-->1<!--/f--> job
that stopped before a render, <!--f:receipts-->43<!--/f--> receipts are committed and <!--f:receipt_chains-->43 of 43<!--/f--> verify;
the pack has no row or chain count for that one. `npm run figures` and
`npm run evidence:pack` recompute these counts from the committed receipts,
and a test fails if they drift.
Source: `CLAIMS_AUDIT.md`, rows "Every step ... hash-chained receipt" and
"42 jobs, 43 renders"; `evidence/pack/README.md` "Receipts".

Weak spot: our own code checks our own receipts on one team's machines and CI;
no outside party has re-run the check.

## 5. Can I trust the timestamps, the approver and the gate inputs in the chain?

The chain fixes their order and content once written. Timestamps come from the
local clock, so they order events but do not date them credibly; the approver
is a name, not a logged-in identity. Listing copy is written after the gate,
outside the chain. Source: `docs/SPEC.md` §6 gaps 3 and 4; `CLAIMS_AUDIT.md`,
row "Listing copy ... outside the chain".

Weak spot: anything wrong before it entered the chain (a wrong clock, a source
photo of a different garment, SPEC §6 gap 5) is recorded faithfully, not caught.
