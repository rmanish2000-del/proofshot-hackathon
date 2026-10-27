# ProofShot (hackathon build)

AI product photos where a wrong image cannot ship: a deterministic release gate
(RELEASE / REVIEW / REFUSE) and a hash-chained receipt anyone can verify offline.

**Written during the event.** Every file in this repository was written after the
hackathon kickoff (26 Oct 2026, 21:30 IST), with a new git history. ProofShot's
pre-existing code stays in a separate private repository and is not copied here;
the modules this build needs are rewritten from the written specification.
Config boilerplate (tsconfig.json, .gitignore) mirrors the pre-existing repo.

Work in progress. `npm install`, then `npm test` and `npm run typecheck`.
