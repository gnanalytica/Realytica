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
3. On the Portfolio, an admin presses **Load the samples** (or **Refresh the samples**). This gives three labelled engagements, and removes only projects marked as samples, never client projects:
   - **SAMPLE-1, Whitefield site (Analysis).** Its nine demo PDFs are read on the server through the real upload path, with no model. It arrives with document facts, cited check values, three check rulings, a subsisting-mortgage finding, a valued run from a labelled sample land rate, three requests (one answered) and a report under review.
   - **SAMPLE-2, Harohalli township (Review).** Several assessments, an overdue request and an issued red flag report with a named sign-off.
   - **SAMPLE-3, Koramangala infill (Documents).** An acquisition screen waiting on documents, with a sent request and a drafted one.

## Stored data from before the release

On its first start, the API takes out anything the illustrative reference tables left on stored projects. Each project is done once and gets an audit entry.
- **The stored screen:** its value range, comparables and market drivers go.
- **Valuation runs priced on locality medians:** removed, unless someone issued one.
- **Evidence filed from the locality pack:** rejected, with the reason.
- **What those tables raised:** findings are rejected, and risks, actions and the old screen's verdict are closed or withdrawn with the reason. Nothing a person wrote is deleted.
- **The two engagements the old boot seed created:** marked as labelled samples, so a refresh replaces them.

## Bringing an older file up to date

A project filed before the reader existed has its documents on file and nothing read out of them.
1. **Read the filed documents.** The workspace chat offers this as a chip whenever a filed document has nothing read. The stored files go back through the reader:
   - Scanned pages are OCR'd at about 10–40 seconds each, so a long set takes a few turns of up to five minutes.
   - Each turn says how many files are left.
   - The cards land on the rows the files are already on. Review them and approve.
2. **Run the property screen** (⌘K, "Run property screen"). A re-screen closes what an earlier screen raised and no longer finds, and replaces untouched red flag drafts. Anything a person has taken up stays as they left it.
3. **Set up the engagement** on the case dashboard: stage, client, scope, lead and due date.

Besides the land instruments, the reader now knows these approvals, and flags a term that has lapsed:
- RERA registration certificates
- environmental clearances (SEIAA)
- utility, aviation (AAI height) and fire NOCs
- certificates of incorporation

Kannada EC scans don't OCR well enough to read on the server. A model that reads PDFs reads them, if one is configured.

## A five-minute walkthrough

1. **Portfolio:** the pipeline, what needs a decision, and what is overdue.
2. **Case dashboard (Whitefield sample):** the lifecycle, the key facts and the map. Ask "Does the extent on the sale deed match the khata?"
3. **Workspace:** the answer cites each document's page and opens the survey sketch at its fact. Documents shows the deed's 15 facts, each with its words on the page.
4. **Technical DD:** the three rulings, a check with document-filled values, and the computed extent mismatch. Read the revenue map for Sy. 118/2 on the Site tab.
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
