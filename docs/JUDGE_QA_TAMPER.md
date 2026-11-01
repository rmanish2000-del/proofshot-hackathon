# Judge Q and A: the tamper check and the receipt chains

Five hard questions a skeptical judge could ask about the receipts, with what the
repo can and cannot back. Each answer cites the section it comes from. Numbers
are copied from generated files (`evidence/pack/README.md`, written by
`npm run evidence:pack`, and the figure markers in `CLAIMS_AUDIT.md`, written by
`npm run figures`), as of 1 Nov 2026 after 4a511cb; this file is not wired into
figures, so if those files change, they win over the numbers here.

## 1. If I rewrite the whole receipt file, does your page notice?

No. The receipt is a SHA-256 hash chain, not a signature. It catches an edited
payload, a reordered or deleted line, or a forged entry, but not a file
rewritten from the first entry. Source: `docs/SPEC.md` §3 threat model;
`CLAIMS_AUDIT.md`, row "The receipt is a hash chain, not a signature".

Weak spot: there is no signature, append-only store or external witness, so a
VALID result shows the file is consistent with itself, not that nobody rewrote it.

## 2. You say one changed byte reads TAMPERED. Is that true for every byte in the file?

No, only for bytes in an entry's content: `seq`, `at`, `kind`, `payload`, `prev`
or `hash`. The page parses each line as JSON first, so whitespace, key order,
blank lines or an extra top-level field still read VALID. Source:
`evidence/pack/README.md` "Verify a receipt offline"; `CLAIMS_AUDIT.md`, row
"Change one byte" (scoped, CA1).

Weak spot: the recorded narration still says "Change one byte"; only the written
docs carry the scope.

## 3. Does VALID prove that this image is the one the seller published?

It proves the image's sha256 matches a `release` entry in a chain that
verifies. It does not prove the shop delivered that file. A hash not in a
release gets NOT RELEASED or TAMPERED. Source: `docs/SPEC.md` §9 image check
and §6 gap 1; `evidence/pack/README.md` "Verify a receipt offline".

Weak spot: "the hashed image is not provably the delivered image" (SPEC §6),
and the model id in a receipt is the provider's claim, not proof of which
weights ran.

## 4. How many receipts actually verify, and who checked them?

43 of 43 committed receipts verify; the evidence pack counts 42 of 42 chains,
one per job with a render (43 renders), because one receipt stopped before a
render. `npm run figures` and `npm run evidence:pack` recompute these counts
from the committed receipts, and a test fails if they drift.
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
