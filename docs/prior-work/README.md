# Prior work: the specification before the event, and its 27 Oct update

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

What changed during the event: on 27 Oct 2026 at 10:33 IST, during the event
and 37 minutes before this repository's first commit, the private repository's
spec was brought up to date with its earlier code (private commit `04e207d`);
that update rewrote the §3 payloads and §4 validation and added §7 to §10,
describing that code. Its text is `SPEC-2026-10-27-update.md`, below. This
repository's `docs/SPEC.md` was first added from it in `89cc8ea` (27 Oct 2026,
13:06 IST) and edited after that; each change of substance made here is
marked *(event)*. To see every difference from the pre-event text:

```bash
git diff --no-index docs/prior-work/SPEC-pre-event.md docs/SPEC.md
```

To split that into the two steps, the 27 Oct private update and then the
changes made in this repository (the ones marked *(event)*):

```bash
git diff --no-index docs/prior-work/SPEC-pre-event.md docs/prior-work/SPEC-2026-10-27-update.md
git diff --no-index docs/prior-work/SPEC-2026-10-27-update.md docs/SPEC.md
```

## The 27 Oct update: `SPEC-2026-10-27-update.md`

Written during the event, before this repository's first commit, so it is not
pre-event work; it is published so the two steps above can be checked. Copied
unchanged.

| | |
|---|---|
| Source repository | `rmanish2000-del/proofshot` (private) |
| Path in the source | `docs/SPEC.md` |
| Commit | `04e207d`, committed 27 Oct 2026 10:33:07 IST ("SPEC.md brought up to date with the code, before the clean-room rewrite") |
| Blob SHA | `9651a5c` (`9651a5c5db49f5109fd7e40ea0a5a2aeb52e459b`) |

`git hash-object docs/prior-work/SPEC-2026-10-27-update.md` prints
`9651a5c5db49f5109fd7e40ea0a5a2aeb52e459b`.

The pre-event text names `src/` and test files of the earlier private
repository; none of that code is in this repository. The code here starts at
4aa99f9 and was written from the specification.
