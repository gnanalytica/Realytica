# What survives a proxy hop, measured

**2026-08-28.** The agent layer carried two provider implementations so it
could reach vendors other than Anthropic. The second one could not carry a
scanned deed, which is the only document input this product has. It is gone,
and vendor choice now sits in a LiteLLM proxy in front of the app.

## What was observed

Nothing was broken. The question was whether to keep a second provider or put
a proxy in front, and it turned on a claim neither side could settle by
reading: does a document survive translation from Anthropic's wire format to
another vendor's?

## The measurement

A real LiteLLM proxy, run locally, configured with three model entries whose
`api_base` pointed at a stub HTTP server that recorded whatever it received
and answered in the dialect its path implied. No vendor keys, no spend — the
stub is the vendor. The same Anthropic-format request went to each: one
`document` block (a one-page base64 PDF), `citations: { enabled: true }`, and
one text part.

| Routed to | Path the proxy called | PDF arrives as | Citation request |
| --- | --- | --- | --- |
| `anthropic/…` | `/v1/messages` | `document` block | carried |
| `gemini/…` | `…:generateContent` | `inline_data` | **dropped** |
| `openai/…` | `/v1/responses` | **not at all** | dropped |

The OpenAI row is the one worth remembering. The forwarded payload was
`{model, input: [{content: [{type: "input_text", …}]}], max_output_tokens}` —
the text part alone. No error, no warning, no field left behind. A model asked
to read a document it was never sent will answer anyway, and the answer will
look like every other answer.

## What it decided

Two vendors reachable through one format, and the format that reaches them is
Anthropic's. So:

- `providers/openai.ts` was deleted — 892 lines, including a hand-rolled PDF
  text extractor written precisely because that path could not send a PDF.
  `ProviderId` is now one member and names the **wire format**, not the
  company.
- `REALYTICA_BASE_URL` points at a proxy that speaks that format.
  `litellm/config.yaml` is where a tier name becomes a vendor.
- Do not point a document-reading tier at an `openai/…` model. The table above
  is why, and nothing downstream can detect it.

## Two things the measurement forced

**Citations are now read off the answer, not declared.** The provider's
declared `documentCitations: true` describes the format, which does carry
them. Whether a given call got them depends on which vendor the proxy chose,
which is not knowable from here. So `citationGap()` compares what the request
asked for against what came back, and a document read that wanted citations
and got none records `citations_unavailable` on its result — into the evidence
and the telemetry. A page reference nothing verified must never render like
one that was.

**A proxied model with no declared rate is unpriced, not ceilinged.** Pointed
straight at Anthropic, a model missing from the rate table is a new Anthropic
model and Opus rates bound it — a real ceiling. Behind a proxy the same name
could be Gemini Flash, where Opus rates over-report by roughly fifty times.
That is not a ceiling; it is a number someone would act on. It now warns
naming `REALYTICA_PRICING` (a fix an operator can apply) instead of telling
them to edit our source for a model we have never heard of.

Consolidating that rule also merged two rate resolutions that had drifted:
`client.ts` billed an unknown model at the Anthropic ceiling while
`telemetry/pricing.ts` reported the same call as unpriced, so the cost
breakdown and the coverage report described one call two ways.

## What would have caught it sooner

Nothing in the repo could have. The claim was about someone else's translation
layer, and the only way to settle it was to run that layer and watch what came
out the far side. `pnpm probe:litellm --model <name>` is that experiment made
repeatable: it sends a real one-page PDF through your proxy and reports, as
three separate verdicts, whether the document reached the model, whether
citations came back, and whether they were verified. Run it after pointing a
tier at a new model — the three fail independently, and the middle one failing
quietly is the expensive case.

Incidental: writing the probe revealed that `scripts/` was never type-checked.
Its first draft omitted a required field on `LlmRequest` and the gate stayed
green. `tsconfig.test.json` now covers `scripts/**`.
