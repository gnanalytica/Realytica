# Findings

Dated write-ups of defects that were found, root-caused and fixed — one file
per finding, named `YYYY-MM-DD-short-slug.md`.

A finding earns a file here when knowing about it would have saved the next
person time: a bug whose cause was not where its symptom was, a class of
mistake the codebase keeps making, or a fix whose reasoning is not obvious
from the diff. A routine bug fixed in the place it appeared does not need one
— the commit message is enough.

Write them for somebody who does not have the context. What was observed,
what actually caused it, how it was found, and what would stop the next one.
Keep the numbers: "the residual was 18% high" is a finding, "the residual was
wrong" is a note to self.

Open risks that have **not** been fixed live here too, marked as such in the
title, so they are visible to somebody reading the repo rather than only to
whoever last discussed them.
