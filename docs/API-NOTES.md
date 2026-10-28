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

### The verifier with images (P6, `src/verifier.ts`)

Same endpoint. One system message (instructions + the SPEC §4 schema + "Return
only JSON matching this schema, no prose") and one user message with seven
content parts: a text part naming each image, then its `image_url` data URL
(`detail: "auto"`), three seller photos of kurta-01 and the render (the
stand-in, the same bytes as the first photo), then the instruction. Every image
is a 715×1600 JPEG of 258 to 274 KB, sent unresized. `temperature: 0`, no
`response_format`. The logs replace each data URL with the byte count and
sha256 and the header with a placeholder (`scripts/verifier-log.ts`).

| Log | max_tokens | HTTP | finish_reason | content | prompt tokens | completion tokens | reasoning tokens | latency |
|---|---|---|---|---|---|---|---|---|
| `evidence/verifier-2026-10-28T03-55-00-289Z.json` | 1500 | 200 | `length` | cut off inside the second finding | 6885 (0 cached) | 1500 | 1338 | 24680 ms |
| `evidence/verifier-2026-10-28T03-59-30-015Z.json` | 4096 | 200 | `stop` | one JSON object, 9 findings, all `match`, confidence 0.96 to 1.0 | 6918 (0 cached) | 1808 | 1022 | 15483 ms |

What the two calls show:

- Four images cost about 6900 prompt tokens; `usage` has no per-image count
  for this model (the receipt records each image's bytes and pixel size from
  the file headers instead).
- The reasoning before the answer is long for this task (1338 and 1022
  tokens), so 1500 was not enough: the JSON was cut off and the gate refused
  the render as `not_verified` (`data/jobs/live-kurta-01`). At 4096 the whole
  answer arrived in 1808 completion tokens (`data/jobs/live-kurta-01-2`).
- The model read the schema's bbox as `[x, y, w, h]` in the second call after
  the instructions said so; in the first it used corner coordinates. Bboxes
  are evidence on the receipt, not gate input, so neither changes a decision.
- The render was the first photo itself, so `match` everywhere is the right
  answer and says nothing about mismatch detection.

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
  carries `w=715;h=1600`, the frame the pixel coordinates refer to: the JPEG's
  own frame header says 715×1600 too (`test/sam-parser.test.ts`). One
  confidence is repeated on both tokens.
- Decoded with `@meta-sam/parser` 0.1.0 (`src/sam-parser.ts`, test against
  this log): the box record is half-open, left 27, top 169, right 651, bottom
  1408; the mask raster is 516×1024 (the `1024,516,` prefix of `data`), its
  own resolution, and covers those bounds, so the glue stretches it into the
  624×1239 box by nearest neighbour before writing the full-frame PNG. The
  garment pixels fill a sensible share of the box and none fall outside it.
- `usage` reports `images_processed: 1` and zero input, output and total tokens.
  Cost is not in the response and no rate card was read, so no figure is written.
- Latency is one sample and is not a benchmark.

## Meta Model API (Muse Wonder)

No real call has been made from this repository. Nothing to report.
