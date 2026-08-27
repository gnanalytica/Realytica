# Built, plumbed, never fed — and its sibling, keyed off the wrong attribute

2026-08-27

Six defects found in one sitting, five of them the same two shapes. Recording
the shapes, because the individual fixes are unremarkable and the pattern is
not.

## Shape 1 — built, plumbed, never fed

A capability is written, wired through a type, and nothing ever calls it. It
typechecks, it has tests, and it does nothing. Nobody notices because the
absence looks identical to the feature simply being quiet.

| Found | Symptom | Cause |
| --- | --- | --- |
| Document preview | A case could cite `EC_30Year_2025.pdf` in the evidence ledger with no way to open it | `StorageAdapter.getDocument` existed from the start; no HTTP route ever reached it, and the web client had no method for it |
| `ExtractedField.sourcePage` | Never read anywhere | Stamped `sourcePage: 1` on every field by a deterministic extractor that locates nothing. A hardcoded 1 is a fabricated citation that reads exactly like a real one — now left `undefined` |
| Boundary card | Unreachable in the default configuration | Rendered below `LocationTab`'s early return for "no mapping provider", which is the default |
| Eval harness | Printed a ranking and exited 0 whatever the models scored | No threshold. A prompt change halving extraction accuracy passed CI as loudly as one improving it |

**What catches it:** ask of every new field and method, "what reads this?" —
and answer with a file and a line, not an intention. A `Record<Kind, …>` that
forces every case to declare a value catches the type half; nothing but the
question catches the call-site half.

## Shape 2 — keyed off the wrong attribute

The code runs, produces a number, and the number answers a different question
from the one asked. Strictly worse than a crash: it looks like an answer.

| Found | Symptom | Cause |
| --- | --- | --- |
| Residual valuation | Primary anchor at 45% weight overstated land by **18%** (₹59.7 Cr where ₹48.8 Cr was right) | Priced `plotArea × zoning FAR` while the yield card on the same screen said the abutting road caps FAR below it. Now scaled by the share the yield says survives |
| Parking norms | A 114-unit scheme reported zero spaces | Keyed on `PropertyType`, which is always `land_parcel` on a development site. Rekeyed to `ProjectKind` |
| Compliance filter dropdown | "All verdicts" conveyed nothing | The control showed the filter's state, not the data's. Replaced by a proportional bar that does both |

**What catches it:** two views of the same quantity on one screen. The
residual bug was invisible for as long as the envelope was a number in a
sentence; it became obvious the moment the yield funnel drew the same
envelope four inches above it. Drawing a thing twice from two code paths is
a cheap consistency test.

## How they were found

Not by reading code. A Playwright sweep over every case view, asserting three
things per page:

- no horizontal overflow,
- no element whose text is clipped by its own box (`scrollWidth > clientWidth`),
- no console errors.

That single sweep surfaced a literal unrendered `Per {unitLabel} — low` in the
report (a template literal missing its `$`), invalid DOM nesting that silently
dropped a flex layout, an unbounded statute chip squeezing a table row into a
one-word column, and stat tiles clipping the figure they exist to show. None
of these fail a typecheck or a unit test, and all of them are visible in one
screenshot.

## Open risk — storage is public and the API has no auth

**Not fixed.** Recorded here so it is visible to whoever reads the repo.

`apps/api/src/storage/blob.ts` writes with `access: 'public'` and
`addRandomSuffix: false`. The case store lives at the deterministic pathname
`store/realytica.json`, and uploaded documents at `uploads/<caseId>/<key>`.
The API itself has no authentication of any kind — no session, no cookie, no
API key check anywhere in `app.ts`.

So the entire case database is one guessable path away from anybody who
learns the Blob store's hostname. That hostname carries a random component,
which is obscurity, not access control.

The document preview route added on this date deliberately proxies bytes
through the API rather than linking to storage, so that at least the
application is not itself handing out the storage address. That is a
mitigation of one path, not a fix.

The fix is authentication plus a private bucket, in that order — a private
bucket without auth just moves the open door. Both are product decisions
rather than cleanups, which is why this is a recorded risk and not a commit.
Do not put real client data in a deployment until they are made.
