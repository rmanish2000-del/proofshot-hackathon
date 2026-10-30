# Evidence Recovery Agent: scaling path (a plan, not built)

**Built and tested today (local only):** the agent is stateless between jobs: each step reads only its own
job's photos and receipts and writes its next action and result to its own job record (`src/agent/store.ts`).
Photos (`blobs/<seller>/<job>/`) and records (`records/<seller>/<job>/`: job record, gate receipts, the
hash-chained agent section) are separate trees. A file queue (`src/agent/queue.ts`) runs N workers in one
process (config `workers`, default 1); a task is claimed by an atomic rename, and per-seller limits (image size,
concurrent jobs, model calls, spend) are enforced in code. `test/agent.test.ts` "agent 12" runs two sellers' jobs
at the same time without mixing files or receipts and keeps one seller to one running job. One bounded agent
step per queue run; a job is queued again only after the seller acts. Metrics (queue time, processing time,
failures, cap hits, re-runs, spend, cost per completed listing) go to a local `metrics.jsonl`
(`npm run agent:metrics`). The deterministic gate stays the final decision-maker throughout.

**Not built (plan):**

1. Move the queue from a folder to a managed queue (one message per job step, visibility timeout instead of the
   rename claim), keeping the same task shape `{seller, job, enqueued_ms}`.
2. Run more workers, in more processes or machines; nothing changes in the agent, because each step already
   reads and writes only its own job's keys.
3. Move `blobs/` to object storage and `records/` to a database or an append-only store keyed by seller and job;
   gate receipts and the agent section stay hash-chained, so their integrity does not depend on the store.
4. Ship `metrics.jsonl` lines to the operator's existing monitoring instead of reading the file.
5. Keep the per-seller limits server-side (they are in code today, not trusted from the client).

No external infrastructure, deploy or hosted service exists for this today.
