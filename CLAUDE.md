# Contributor notes (Claude Code, DeepSeek, Grok, humans)

## Canonical repo rule (27 Oct 2026, 12:20 IST, from proofshot #23)

1. **All new hackathon code, docs and assets go only into this repository,
   private `rmanish2000-del/proofshot-hackathon`** (branch `master`, first commit
   4aa99f9). They are rebuilt from the spec (`docs/SPEC.md`), never copied from
   old code. The README states which code was written during the event and
   labels open-source dependencies and public datasets.
2. **The old repo `rmanish2000-del/proofshot` stays private.** It is only for
   coordination (the team board #23, issues, the autorun settings, the sync
   script) and is the pre-existing core called as a hosted service. No new
   product code goes there.
3. **Every spec, issue, board row, review and report names its target repo
   explicitly**: `proofshot-hackathon` or `proofshot (coordination)`.
4. **This repo goes public only after the secret scan passes on 3 Nov, by
   Manish's click.**

## Working here

- `npm install`, then `npm test` and `npm run typecheck`. Both stay green.
- Every change to the gate, the receipt or prior records ships with a test.
- No secrets anywhere: in files, commits, issues or replies, use variable names only.
- Clean room: do not open a pre-existing source file from `proofshot` in the
  same session you rewrite it here. Work from `docs/SPEC.md`.


## Coordination
This is the product repo. Status, ownership and blocked commands live in ../handoff/NOW.md (old repo folder). Read it before starting work, and append a Log line there when you start or finish an item.
