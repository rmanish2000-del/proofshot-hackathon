# Prior work: the specification as it was before the event

`SPEC-pre-event.md` is the written specification of ProofShot as it stood
before the hackathon opened (26 Oct 2026, 21:30 IST). It is copied unchanged;
judges can compare it with the code built from first commit 4aa99f9.

| | |
|---|---|
| Source repository | `rmanish2000-del/proofshot` (private) |
| Path in the source | `docs/SPEC.md` |
| Tag | `pre-hackathon-baseline` |
| Tagged commit | `1485431`, committed 26 Oct 2026 19:44:34 IST |
| Tag object | created 26 Oct 2026 23:48:02 IST, after the opening; it points at the commit above |
| Blob SHA | `b666be9` (`b666be96eda263ffa0cf05cbadb1d38685e38fc8`) |

Check the copy:

```bash
git hash-object docs/prior-work/SPEC-pre-event.md
```

prints `b666be96eda263ffa0cf05cbadb1d38685e38fc8`, the blob at
`pre-hackathon-baseline:docs/SPEC.md` in the source repository.

What changed during the event: this repository's `docs/SPEC.md` was first
added in `89cc8ea` (27 Oct 2026, 13:06 IST) and edited after that. To see every
difference from the pre-event text:

```bash
git diff --no-index docs/prior-work/SPEC-pre-event.md docs/SPEC.md
```

The pre-event text names `src/` and test files of the earlier private
repository; none of that code is in this repository. The code here starts at
4aa99f9 and was written from the specification.
