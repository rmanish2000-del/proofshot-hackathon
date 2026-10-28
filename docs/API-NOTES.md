# API notes (real calls only)

Every number here is read from a call log committed under `evidence/`. Nothing
is estimated. The key is never in a log: the client replaces it with
`[BASETEN_API_KEY]` before writing (`src/baseten.ts`).

## Muse Spark Open on Baseten (`meta-models/muse-spark-open-1026`)

Endpoint: `https://inference.baseten.co/v1/chat/completions` (OpenAI-compatible).
Prompt in both calls: one user message, "Reply with exactly one word: ready".

| Log | max_tokens | HTTP | finish_reason | content | prompt tokens | completion tokens | reasoning tokens | total | latency |
|---|---|---|---|---|---|---|---|---|---|
| `evidence/baseten-2026-10-27T13-23-37-385Z.json` | 64 | 200 | `length` | null | 152 (128 cached) | 64 | 61 | 216 | 8069 ms |
| `evidence/baseten-2026-10-28T00-51-41-996Z.json` | 1024 | 200 | `stop` | `ready` | 152 (128 cached) | 60 | 49 | 212 | 1788 ms |

What the two calls show:

- The model reasons before it answers and returns that text as
  `message.reasoning_content`, which counts against `max_tokens`. With a budget
  of 64 the reasoning used the whole budget and `content` came back null.
- With 1024 the same prompt finished in 60 completion tokens (49 of them
  reasoning) and the answer was the single word asked for. `max_tokens` is a
  ceiling, not a spend: the second call used fewer tokens than the first.
- Latency is one sample each and is not a benchmark. The second call was
  warmer (same cached prefix, 128 tokens) and 4.5x faster; one pair of calls
  cannot say why.

Cost: not logged. Baseten's response carries no price field, and no rate card
was read during these runs, so no cost figure is written here.

## Meta Model API (Muse Wonder)

No real call has been made from this repository. Nothing to report.
