# Reading eval

How well Realytica reads a paper it is handed, as numbers to compare before
and after the reading code changes.

```bash
pnpm eval:reading                      # from the repository root, about ten minutes
pnpm eval:reading -- --with-model      # the same, with the model reader; about 45 minutes and two dollars
```

It runs the reader an upload goes through (`readIngestLocally`: text layer,
then OCR, then the rules) with no model, no network and no key. It exits 0
whatever the scores and is not part of `pnpm check`: a measurement, not a gate.

## With the model reader

`--with-model` goes on as an upload does when a model is configured. The files
the reader's own router picks (`needsModelReading`: a page in Kannada, a page
OCR was unsure of, a page nobody read) are read by the model reader as well,
and the two readings are merged, by the same three functions the upload route
calls.

- **What it loads.** From `.env.local` at the repository root, only
  `REALYTICA_API_KEY`, `REALYTICA_BASE_URL`, every `REALYTICA_MODEL_*` and
  `REALYTICA_PRICING`. A name already set in the shell is left alone, so
  `REALYTICA_MODEL_EXTRACTION=<model> pnpm eval:reading -- --with-model` reads
  with another model. No value is printed: the run names what it loaded, and
  anything it prints has those values taken out.
- **What it sends.** The pages the router names, of these invented papers, as
  a PDF of those pages; then single pages, where a value has to be read a
  second time. Every scanned page a number, a date or an amount was read from
  goes that second time, alone, with the names of what to read from it and
  nothing of what the first reading said: such a value is never proved by
  words OCR read there, and a reader shown the words it is to confirm confirms
  them. Nothing else.
- **Where it stops.** Every request to the endpoint is counted where it
  leaves. After 200 (`--max-model-calls N`) none does, and a file refused there
  keeps its reading without the model. No single call is waited on for more
  than four minutes.
- **What it reports.** Calls made, pages sent, pages a value came back for
  that was found on the page, values nothing stands behind (a second reading
  differed or could not be made, or a value was not in the words quoted for
  it: kept apart as unverified, and in no score), and the cost: as the
  endpoint's answers gave it where they did, and by this app's own rates for
  the tokens.
- **If it is cut off.** What it had finished is in
  `node_modules/.cache/reading-eval/progress.with-model.json`, written after
  every file, with the calls made and the cost so far.

It writes `results.with-model.json` and prints the run without the model
beside it. A model does not answer the same way twice: between two runs a
rendering's score moved by up to three fields.

**The numbers in `results.with-model.json` are not of this code.** That run
is of 5 October 2026: 101 calls, $1.82, read with the build's default model
for the extraction tier. The reader has changed twice since, and neither
change has been measured with a model.

First, the run found four faults, which were mended after it:

- For a record of rights, a zoning certificate and a survey sketch the reader
  gave the paper's name where the kind of document goes, and the reading was
  refused whole: 13 files.
- A file this server found no legible text in came back from the reader still
  carrying that failure, and was taken for one the reader had failed on: the
  Kannada text PDFs, 5 files (the sixth is among the 13).
- Twice the reader left out its notes, and the reading was refused for it.
- On 17 files passages came back unchecked by the second look, most of them a
  page-full at once, and 93 values were left unverified. Five of those
  readings took 64 to 76 seconds, which is a reading and then the sixty
  seconds a check was allowed; the cause of the others was not seen. A check
  now has longer and more room to answer, and writes to the log why it
  returned nothing.

Each of those mends lets more of what a model reads through, wrong values as
well as right ones.

Second, what stands behind a model's value was made stricter, which lets less
through:

- The second reader is asked blind. In that run it was shown the passage it
  was to confirm, and confirmed a date and a road width that were each a digit
  out. It is now sent the page and the name of the thing to read, and the two
  readings are compared in code. A value under a key of the reader's own
  making has no name to be asked by, and on a scanned page is unverified.
- Every value that has to be exact is held to the words quoted for it: a date,
  an area, a width and a count as well as an amount and an identifier.
- A quote of words is found on a page only with the value's own words there,
  and only on a page that was sent.
- A kind of document the catalogue does not have is read as "other" and no
  longer refuses the reading whole.

So read the file as that run and no more: more will be read than it shows,
fewer wrong values should be filed than it shows, and how many of each is not
known until it is run again.

## What it reads

Nine invented papers (`papers.ts`): sale deed, encumbrance certificate, khata,
property tax receipt, conversion order, plan sanction, zoning certificate,
survey sketch, RTC. Nobody in them is real and their district does not exist.
All nine are in English. The six Karnataka issues in Kannada are also in
Kannada, with the names, numbers and dates left in Latin so that one answer
key serves both.

| Row | What the reader is handed |
|---|---|
| as typed | the page's own words, straight to the rules: the ceiling |
| text PDF | a text layer and no picture |
| clean scan | an image-only PDF, 200 dpi, square and sharp |
| ruled scan | the clean scan of a page ruled into columns: three rules the height of the page, beside the writing. Upright; a reader that goes by a page's strokes takes it for one fed sideways, which is why the reader turns a page only when it reads badly as shown |
| poor scan | skewed 2.6 degrees, blurred, grey on grey, grainy, a stamp over the text; a person still reads it easily |
| turned 90 | the clean scan fed sideways |
| long scan | first page, eight pages of conditions, last page: ten pages, of which this server's reader reads eight |

## How it scores

Each field the page states is **correct**, **missed**, **invented** (a value
returned that is not the true one, or for something the page does not state),
or **contested**: two readers returned different values, both are held for a
person to choose between, and one of them is the true one (`Two offered`).
Where neither is, it is invented.

It is the value that is scored. A value read off a Kannada page may carry the
page's own words beside it; a wrong reading with the right original beside it
is wrong. A value under one of the rules' own keys that the answer key does
not have (an applicant returned as `owner`) is wrong too; only a value under a
key the reader made up is left unscored (`Other keys`). The results file lists
every wrong value and every contested one (`wrongValues`, `contestedValues`),
not only how many. `Right` is correct over fields stated. `Pages read` is pages some reader
got words from (this server's, or in a run with the model, the model's) over
pages in the file; `s/page` is seconds per page sent to OCR. `Latin words` and `Kannada words` are how many of each page's own words
are in the text read from it: the rules know English labels, so on a Kannada
page only the words say how well it was read. Every file is read as
`document.pdf`, because the reader takes a hint from a file's name.

## Comparing runs

The numbers go to `evals/reading/results.json`. A run that finds it prints the
earlier `Right` beside its own, then replaces it, and says so when the papers
or the scoring have changed since. `results.baseline.json` is the run of
5 October 2026 from before a paper was routed by how it was read: the numbers
that change was made against. It has no ruled scan and was scored as the
scoring then was, which for a run without the model comes to the same. The files, and the text read
from each, are in `node_modules/.cache/reading-eval/`; open them before
believing a surprising number. Compare runs from one machine.

Everything repeats exactly except one file. The poor Kannada sale deed ends on
a two-line page; OCR reads the grain as text for about two minutes, and whether
its Kannada pass ends inside the reader's 75-second limit decides which text
comes back. `Slowest files` names it.

`--only sale-deed,khata`, `--rendering typed,text,clean,ruled,poor,turned,long`
and `--script en` run a part, which writes no results unless `--out <file>`.

## Not covered

Telugu and Hindi (no font named, and no OCR data in the reader); papers wholly
in Kannada, handwriting, photographs; a Kannada text PDF with a sound text
layer (the canvas's PDF engine gives conjuncts no Unicode; `as typed` stands
in); approvals, NOCs, leases and opinions on title; a page turned upside down
(only a quarter turn is rendered).

## Fonts and what is borrowed

Nothing is downloaded and no font is in the repository. Latin is Liberation
Sans from the installed `pdfjs-dist` (`standard_fonts/`); Kannada is Noto Sans
Kannada from the machine (macOS ships it; `fonts-noto-core` on Debian and
Ubuntu; or `READING_EVAL_KANNADA_FONT`). Both are SIL OFL 1.1. Without the
Kannada font those papers are left out and the run says so. Pages are drawn
with `@napi-rs/canvas`, which pnpm installs as an optional dependency of pdf.js.

## Adding a paper

Invent everything. Write both scripts from the same values, and list in
`truth` what the page states, in the reader's keys and forms. Run
`--only <id> --rendering typed` and read the result before scoring a scan.
