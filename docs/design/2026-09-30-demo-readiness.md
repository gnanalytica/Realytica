# Demo readiness: what changed, how to run it, what is left

*2026-09-30. Follows the row F build map (`2026-09-29-recommended-flow-build-map.md`). Branch `demo-ready`.*

## What changed

**Integrity fixes (the four "fix first" items)**
- **The project screen reads real facts.** Each filed document's `facts` (page and quote) feed the screen and the title graph. Documents nobody has supplied are left out, and a document with no facts is never given invented ones.
- **No synthetic market data on a client file.** The screen runs without the comparable pool and strips everything built on the illustrative locality tables: the value range, anchors, drivers, liquidity, zoning and FAR, flood grade, and costs charged on a guidance value. It no longer writes a valuation run. The valuation run uses recorded rates only and says which inputs are missing. The Whitefield fallback is gone, and the chat no longer files the "locality pack" as evidence.
- **Nothing deletes a workspace.** `POST /api/demo/reset` and the About button are removed, and the API no longer seeds on boot. The two sample engagements load on request, are flagged `sample`, and carry a "Sample data" badge everywhere. "Use the sample documents" only works on a sample project.
- **Audit actors come from the session.** This covers the revenue-map read, the survey boundary and graph annotations.

**Removed or hidden**
- **Automations:** off unless `REALYTICA_AUTOMATIONS=on`. The scheduler, flow hooks and `/api/flows` are gated, and the code is kept.
- **AI activity and AI instructions pages:** no longer routed. The admin APIs stay.
- **The Netherlands pack:** its localities, comparables, fixtures and data sources are removed, and the app is India only.

**Row F in the app**
- **Global rail:** Portfolio, Projects, Requests, People.
  - **Portfolio (F01):** a pipeline by engagement stage, with decisions waiting, requests outstanding, the next 14 days, and a "since your last visit" line.
- **Case dashboard (F02):** full width, no chat, at `/projects/:id/dashboard`. It shows a nine-stage lifecycle, the map, key facts, "Ask Copilot" (opens the workspace with the question asked), view tiles, open items, waiting on others, and decisions waiting.
- **Workspace:** eight tabs (Overview, Documents, Site, Value, Technical DD, People, Report, Graph), a Dashboard back link, and a narrow rail.
  - **Documents:** the viewer lists what a document states, each fact with its page and its own words. Picking a fact jumps to its page, and a Kannada or Telugu original shows beside the reading. Check values filled from a document keep their page and quote.
  - **Site:** the map and revenue-map picker, "File as evidence" for a revenue-map read, the place card and visits.
  - **People:** requests, meaning who owes what and by when. A request closes itself when its document is filed. Grants carry a professional role (advocate, CA, architect and so on).
  - **Report:** each section can be Drafted, Checked or Approved, and editing a section puts it back to Drafted. Issuing asks for a named sign-off. **Word** export uses a plain firm template, and **PDF** comes from a print view.
  - **Graph:** clicking a node stays in the graph. "Why is this here?" traces a node down to its filed documents, and "Open" goes to its register.
- **New engagement form:** asks for client, scope, lead and due date, then opens the workspace.

Checks run on 2026-09-30: typecheck, lint and the production build pass, and all 1,468 tests pass.

## Running the demo locally

1. Put the keys in `.env.local` or the shell:
   - `REALYTICA_API_KEY` (Anthropic) for model answers and model document reading.
   - `REALYTICA_GOOGLE_MAPS_API_KEY` for the place card.

   Without them, document reading, file answers, the revenue map and every register still work. Only model chat and the map pin do not.
2. Run `pnpm dev` and open `http://localhost:5173/portfolio`.
3. To show a full file, press **Load the labelled samples** on an empty portfolio. In the Harohalli sample's workspace, **Use the sample documents** reads nine demo PDFs through the real upload path.

## A five-minute walkthrough

1. **Portfolio:** the pipeline, what needs a decision, and what is overdue.
2. **Case dashboard:** the lifecycle, the key facts and the map. Ask "Does the extent on the sale deed match the khata?"
3. **Workspace:** the answer cites each document's page and opens the survey sketch at its fact. Documents shows the deed's 15 facts, each with its words on the page.
4. **Technical DD:** a check with document-filled values, and the computed extent mismatch.
5. **People:** record a request with a due date. It appears on the dashboard and the portfolio.
6. **Report:** approve a section, export to Word, and open the PDF view. Issue with a named sign-off.
7. **Graph:** pick a finding, then "Why is this here?"

## Not done yet

- **F11 phone site visit:** a checklist, camera capture and offline save. The workspace does work at phone width.
- **One proposal model** merging chat cards and AI drafts, with a source recorded on each. AI drafts are still their own tab under Report.
- **A true as-of graph:** nodes carry no created time.
- **Revenue map into valuation externalities and the graph.**
- **A firm comparables register:** rates are recorded on the valuation input sheet.
- **Firm report template:** The client firm's Word template is not yet in hand, so export uses a generic one.
- **Email invites and access changes as proposals.**
