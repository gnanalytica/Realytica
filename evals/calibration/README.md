# Judge calibration labels

`pnpm eval:calibration` measures how often the critic (or any model judge)
agrees with a person reading the same transcript. The critic and the agents it
grades share a model family, so self-preference bias is structural here — the
only defence is this measurement.

## How to build `labels.jsonl`

1. Pull 20–50 transcripts from **real runs**, biased toward runs that went
   wrong. A label set where every human verdict is `pass` calibrates nothing,
   and the tool will say so.
2. For each, record your own pass/fail verdict *before* looking at the
   critic's, then the critic's verdict, one JSON object per line:

   ```jsonl
   {"id":"run_2026-08-30_rytr-0001","human":"fail","judge":"pass","note":"cited the K-RERA circular as if it were the Fire NOC"}
   ```

   `pass` means: two domain experts reading this transcript would
   independently let it ship. If you and a colleague would argue about it,
   the case is ambiguous — sharpen it or leave it out.
3. Run `pnpm eval:calibration`. Read every named disagreement — the notes on
   disagreements are the raw material for the next prompt or rubric revision.
4. Re-grade periodically. Criteria drift — your standards firming up as you
   read outputs — is expected, which is why this is a file you edit and not
   state the app owns.

`labels.jsonl` is gitignored: verdicts about real runs may describe real
properties and real parties. The example file is the only thing committed.
