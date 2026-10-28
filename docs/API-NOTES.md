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

## Meta Model API, SAM 3.1 (`sam-3.1`)

Endpoint: `POST https://api.meta.ai/v1/responses` (Responses API, `stream: true`,
`metadata: {mask_encoding: "one_bit", include_confidence: "true"}`). The log
leaves out every header and replaces the image data URL with its byte count and
sha256 (`scripts/sam-call.ts`).

| Log | prompt | image | HTTP | latency | output |
|---|---|---|---|---|---|
| `evidence/sam-2026-10-28T03-04-30-778Z.json` | `kurta` | `data/garments/kurta-01/1-front.jpg`, 258218 bytes, sha256 `12c00767…` | 200 | 3412 ms | one `<\|box;x1=27;y1=169;x2=650;y2=1407;w=715;h=1600;c=0.957\|>` and one `<\|mask;x=0;y=0;c=0.957;data=1024,516,…\|>` token |

What the one call shows:

- The stream is server-sent events: `response.created`, `response.in_progress`,
  `response.output_item.added`, `response.content_part.added`, one
  `response.output_text.delta`, then the `done` and `completed` events and
  `data: [DONE]`. The whole mask arrived in a single delta.
- The text starts with `<0f>0` and then the box and mask tokens. The box token
  carries `w=715;h=1600`, which reads as the frame the pixel coordinates refer
  to (the intake record does not store the image size, so this is not checked
  against the file), with one confidence repeated on both tokens. The mask `data` field begins
  `1024,516,` then a run-length-looking string; `@meta-sam/parser` is not
  installed here, so it is logged and not decoded.
- `usage` reports `images_processed: 1` and zero input, output and total tokens.
  Cost is not in the response and no rate card was read, so no figure is written.
- Latency is one sample and is not a benchmark.

## Meta Model API (Muse Wonder)

No real call has been made from this repository. Nothing to report.
