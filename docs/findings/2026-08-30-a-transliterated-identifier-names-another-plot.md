# A transliterated identifier names another plot

*2026-08-30 — found by building the measurement, fixed in code.*

## What was observed

The extraction prompt has carried this rule since multilingual support was
written:

> For an IDENTIFIER — a survey number, document number, khata number,
> registration number — copy the characters exactly and do NOT romanise them.
> Indic digits are fine to write as Latin digits, because ೧೨೩ and 123 are the
> same number. Letters are not: there is no English spelling of an identifier,
> only the identifier.

Measured against a synthetic Telugu deed, `minimax/minimax-m3:free` returned:

```
సర్వే నంబరు (Survey No.): ౨౧౪/అ     →     "214/A"
```

It converted the digits, which is asked for, and transliterated the letter,
which is forbidden one clause later in the same paragraph.

## Why it is the worst shape of failure this product has

`214/A` is a **well-formed survey number**. It is not malformed, not empty,
not low-confidence, and not flagged by anything. It simply names a different
plot.

Every other extraction failure announces itself. A missing field is a gap
somebody chases. A hallucinated value is caught by the grounding gate, or by
a reader who knows the case. A wrong identifier that looks exactly like a
right identifier is caught by nobody, travels into the schedule of property,
and can put a valuation on the wrong land.

## How it was found

By writing the thing that measures it. `pnpm eval:multilingual` runs three
synthetic Indic deeds — Kannada, Telugu, Devanagari — and scores each language
rule **separately**, because "read the Kannada name" and "did not romanise the
survey number" are different questions with different fixes: the first is a
capability limit you report, the second is a correctness bug you must stop.

The code path had been covered by `test/script.test.ts` since it was written.
That test proves `prepareValue` does the right thing with a value; it cannot
prove a model hands it the right value, and those are not the same claim.

Three of the first failures were **the scorer's**, not the model's, and each
is worth knowing:

- `\b` is defined against Latin word characters, so `\bश्री\b` matched nothing
  and honorifics survived the comparison.
- A regex alternation takes the first branch that matches, not the longest, so
  `श्री` listed before `श्रीमती` left `मती` attached to the name.
- The fixture demanded "Ramaiah" where the model said "Ramayya". Both are
  valid readings of ರಾಮಯ್ಯ. That was measuring transliteration taste, not the
  rule — the rule is that the page's own text survives, which is exactly what
  makes the spelling not matter. Rule 1 now scores the original strictly and
  the reading loosely.

An eval that over-reports is worse than none, so those were fixed before the
number was believed.

## The fix

`recoverIdentifierFromSource` in `packages/shared/src/script.ts`, wired into
`prepareValue` and called from the extraction shaping path with the field's
own **quote** as the page.

A prompt could not fix this: it already said so, in the imperative, and the
model did it anyway. This repo has learned that twice before — the
off-registry key drop and the ungrounded-suggestion drop both had to move from
the prompt into code before they held.

It is conservative in three ways, because a wrong correction would be the same
failure with our name on it:

- **Ambiguity abstains.** Two candidates on the page and the model's value
  stands.
- **Digits must match exactly.** Only letter positions may differ, so it can
  never turn 214 into 216.
- **It only moves toward the page.** A page whose own form is Latin offers
  nothing to recover.

The quote is used rather than the whole document because it is narrower — two
identifiers elsewhere on the page cannot force an abstention — and because it
is the text the model itself said it read.

## The numbers

| | Overall | identifier-verbatim |
|---|---|---|
| Raw model (`--raw`) | 18/19 | 4/5 — 1 romanised |
| As shipped | **19/19** | **5/5** |

Both reproduce. `pnpm eval:multilingual` fails the run on any romanised
identifier, and on any fixture that did not execute — a free-tier 429 once
dropped a fixture from the denominator and reported a better score by not
asking one of the questions.

## What is still not measured

These fixtures are **text**. Production input is a scanned, often Indic-script
PDF, and OCR is where this degrades — the sibling project measured a 5-point
drop and its only hallucination on the scanned path. A scanned Indic fixture
set is the next thing worth building, and until it exists no accuracy claim
here should be made about photographed deeds.
