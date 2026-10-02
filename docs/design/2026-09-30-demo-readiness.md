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
- **Case dashboard (F02):** merged into the workspace's Overview on 2026-10-01 (see "One overview" below). `/projects/:id/dashboard` now opens the workspace.
- **Workspace:** eight tabs (Overview, Documents, Site, Value, Technical DD, People, Report, Graph), a Portfolio back link, and a narrow rail.
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
   - Optional: `VITE_GOOGLE_MAPS_BROWSER_KEY`, a second key restricted to the site's addresses and the Maps JavaScript API, for Google's map under the overlay.
   - Optional: `REALYTICA_MODEL_BASIC`, a free or cheap model the chat tries before the senior model (see "Chat: a free model first").
   - Optional: `UNBLOCKER_PROVIDER` (`zyte`, `brightdata` or `oxylabs`) and `UNBLOCKER_API_KEY`, a scraping service account for portal comparables. `UNBLOCKER_FALLBACK_PROVIDER` with that provider's own `UNBLOCKER_<PROVIDER>_API_KEY` adds a fallback. Bright Data also takes `UNBLOCKER_BRIGHTDATA_ZONE`, and Oxylabs `UNBLOCKER_OXYLABS_USER`. These are the same settings Valytica uses, so its account can serve both.

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
   - What each document states waits on the row it is already on. Review it on the canvas, value by value.
2. **Run the property screen** (⌘K, "Run property screen"). A re-screen closes what an earlier screen raised and no longer finds, and replaces untouched red flag drafts. Anything a person has taken up stays as they left it.
3. **Set up the engagement** on the workspace Overview ("Edit engagement"): stage, client, scope, lead and due date.

Besides the land instruments, the reader now knows these approvals, and flags a term that has lapsed:
- RERA registration certificates
- environmental clearances (SEIAA)
- utility, aviation (AAI height) and fire NOCs
- certificates of incorporation

Kannada EC scans don't OCR well enough to read on the server. A model that reads PDFs reads them, if one is configured.

## Reading on the canvas

*Added 2026-10-01.* A document being read is drawn on the canvas, and what it states is decided there:
- **The reading.** When documents are dropped in, read again, or loaded as samples, the canvas shows the real page with a scan line going down it, page by page. Each fact then types in below it with its page.
  - Ochre means a reader proposed the fact.
  - Green means a person accepted it, and it is on the file.
  - A text-layer document reads in milliseconds, so each one is shown for a second or two in the order it was read. Nothing is shown before it was actually read.
- **The source.** Pointing at a fact marks its words on the page: the quote is highlighted line by line and the value is ringed. This works on the canvas and in the Documents viewer.
  - Scans are marked too. The reader keeps where every word sat, from the text layer or from OCR's word boxes, and stores each fact's position with the fact.
- **Older documents.** Facts filed before 1 October 2026 have no positions; reading a document again gives it them. A model's reading of a scan still adds notes and quotes only, not facts.
- **When a model reads.** Only a document the app's own reader did not recognise, or read nothing from. A deed read with its facts is filed as read, so nine sample documents produce their cards in seconds rather than after nine model calls.

## Deciding where it lands

*Added 2026-10-01.* Nothing is approved in the chat any more. The chat answers questions, explains, and takes instructions; everything proposed waits where it would land, with two icons beside it: accept, or set aside.
- **Documents are filed as they arrive.** An upload no longer asks to file the person's own files. What each document states waits on its row, ochre, and the desk opens on it once it has been read.
  - Each value has accept, set aside and correct. A corrected value keeps the page's own reading beside it.
  - The keyboard walks the list: ↑↓ to move, Enter to accept, Backspace to set aside, E to correct. Decisions show at once and are sent in order, so nothing is lost at keyboard speed.
  - The double tick accepts what is left on a document, after it has been looked over.
  - When a document is settled, the desk offers the next thing waiting, usually the checks its values fill.
- **Values flow into the checks.** Accepting a value on a document records it on the check it answers, citing the page. A check shows what is still waiting on it, each value with the document and page it came from.
  - **When documents disagree** about a field, the check lays the values side by side with their words, and the person carries one. Each document still says what it says. Accepting a value on one document never overwrites a different value from another.
- **Suggestions wait in their registers.** A request waits under Risks and actions, a finding under Findings, a DD to start under Technical DD, a project detail on the Overview. Each register opens with a short "Waiting for you" list showing what it would change.
- **Finding what waits.** Each tab counts what waits under it, and the "to review" pill walks through all of it: documents first, then the checks, then the rest. A chat reply links to what it left waiting, and the chat says how much is still waiting from earlier.
- **Instructions run at once, with Undo.** "Accept all", "close the drainage risk" and the like are carried out immediately. For fifteen seconds the canvas offers Undo, which puts the file back exactly as it was. It is refused once anything else has changed the file, and the conversation keeps a line saying it was undone.
  - "Accept all" never chooses between documents that disagree. Those values stay on the check for the person to pick.

## One overview, phases, maps and a cheaper chat

*Added 2026-10-01.*
- **One overview.** The case dashboard and the workspace Overview showed the same six cards with the map on one and the stage history on the other. There is now one page: the workspace Overview, with the engagement editor, the lifecycle, the map, key facts, views, open items and the stage history. Old dashboard links land there, and the back link goes to the Portfolio.
- **Looking back by phase.** Changing stage never hid anything; now you can also look back by it. Click a phase the project has been in, on the lifecycle or in the stage history, to see what was done during it: documents filed, DDs started, checks recorded, and the findings, risks, actions, decisions and reports raised. Each item opens where it lives. The phase is read from when each record happened and the stage history, so records made before this change are placed too.
- **Completed and archived DDs stay reachable.** The DD list's filter shows as soon as any DD is closed, not only from four DDs up.
- **The map is back on the Overview**, as well as on the Site tab. "Show the map" opens the Overview and "open the site" opens Site. The map redraws when the conversation is resized or a phone switches tabs, instead of going grey.
- **Nearby places on the map.** The transit, schools, hospitals, markets and airport the place card already found are drawn on the map with their distances, as a layer you can turn off. This makes no extra calls.
- **Google's map under the overlay.** With `VITE_GOOGLE_MAPS_BROWSER_KEY` set, Satellite shows Google's imagery with its road and place labels, and Streets shows Google's map with the places it marks. Every layer on top (wards, lakes, revenue map, survey outline, planning sheet, nearby places) draws the same. Without the key, or if Google refuses it, the map uses its own imagery as before. Google gives 10,000 interactive map loads a month free, then $7 per thousand.
- **The revenue-map picker starts filled.** It uses the last read when there is one. Otherwise it matches the site address against the Karnataka village index, and says so ("Check it before reading"). The survey number comes from the project's parcel, else from a document accepted as stating one. A village name shared by several villages needs the hobli or taluk in the address before one is chosen, and a hobli's name is never read as the village.
- **Chat: a free model first.** With `REALYTICA_MODEL_BASIC` set (for example an OpenRouter `:free` model that supports tools), the chat asks that model first, with the same tools.
  - It hands the question to the senior model (the judgment tier) when it decides the question needs judgement. It also hands over when it fails or is rate limited, comes back empty, or states a figure the file does not support. Drafting goes straight to the senior model.
  - The turn says which answered ("Free model" or "Senior model — why"), and free models are priced at $0.
  - OpenRouter only serves most free models when "free endpoints that may train on inputs" is allowed in its privacy settings. Otherwise every question is handed over and answered by the senior model, as before.
  - Answers read off the documents are no longer reworded by a model, which kept their page references and saved a call.

## One Value tab: compliance, value and what moves it

*Added 2026-10-01.*
- **One tab, one action.** The property screen and the indicative valuation were two buttons on one tab, answering two halves of one question. The tab now opens on a single view. **Value this property** checks the title against the state's rules (the screen, without writing a red flag report each time) and starts the valuation DD when the file has none. It then fills every input the file holds.
- **The inputs fill themselves, one at a time, with their source.**
  - The plot area comes off the title deed, the survey sketch, the khata, the sanctioned layout or the surveyor's outline, with the page and the words.
  - The built-up area comes off the sanctioned plan, but only where a building stands. On a site bought to develop, the plan is what may be built and the site is valued on its extent.
  - The land rate is the guidance value the state's revenue map publishes, per square metre.
  - The building's age comes from its occupancy certificate. The expected life is the RCC convention of 60 years.
  - The rent and the area let come off a lease. Leases are now read for those, and for the date the lease starts.
  - A sale of the parcel itself registered in the last three years is offered as the comparable rate. An older one is shown as price history, not offered.
  - Each value is proposed (ochre) until accepted. "Accept all and record" records them, citing their documents, and records the valuation. A value can be set aside, or typed by hand with a document cited where the field needs one.
- **The figure moves as the inputs land**, and the page says where it stands: provisional, not recorded, or recorded with its sign-off. When the only rate on the file is the guidance value, the page says the figure is the guideline value, not yet a market value.
- **Summary of values, as panel valuations open.**
  - Fair market value, realisable (90%) and distress (75%), stated as the conventions they are.
  - The guideline value of the land beside them, with how far the figure sits above or below it.
  - The blend of approaches and what each one is still waiting on.
- **Compliance.**
  - The state's title checks from the screen.
  - A lender's own checks: the extent across the documents, the built-up area against the sanction, FAR against the permitted, charges on the EC, the prohibited register, the value against the guideline, and whether the approaches cross-check.
  - IBBI Rule 8(3), N of 12, item by item.
  - What needs a person is listed; what is not established and what is clear fold into a line each.
- **What moves the value.** What the figure already carries (externalities, depreciation) is kept apart from what the file records that the market prices: the revenue map's own factors with their bands, B-khata, Gram Panchayat, no OC, tenure, the plot's road, facing, shape and layout, and nearby transit. Each shows its rate and where it came from.
- **Not used:** no locality medians or invented rates. A cap rate or a replacement cost the file does not hold waits for a valuer, and the page says so.

## Comparables, and searching the portals for them

*Added 2026-10-02.*
- **A comparables register on the Value tab.** It sits in the Comparables card. Each comparable carries:
  - its source: a 99acres or MagicBricks listing with its link, a registered sale with its document, or one added by hand;
  - its distance, its area and what the area is measured on (carpet, built-up, super built-up or plot);
  - the price, asking or paid, and the rate per sqm;
  - the five CMA adjustments: time, size, location, condition and listing discount;
  - a weight.

  The weighted adjusted rate is proposed as the comparable rate, with the net adjustment beside it. Accepting it files a comparable schedule on the evidence register (every comparable, its link and its adjustments), records the rate citing that schedule, and accepts the comparables.
- **Portal search.** With a scraping service configured, **Value this property** also searches 99acres and MagicBricks near the site, at most once a week, and **Search again** runs it on demand. The pipeline is Valytica's, ported:
  - the portal's own name for the locality, from MagicBricks' autosuggest;
  - each (locality, city) page both portals answer, including Bangalore's zone pages on 99acres;
  - builder adverts and the same property listed twice dropped, and a mistyped area kept out of the rate;
  - a ranking by distance, size, type, area basis and recency, within 3 km for land and 4 km for buildings, widened only when results are thin;
  - automatic failover when a vendor is out of credit or down.

  Found listings land as proposed. Only a locality name and a city leave for the vendor, never an owner, survey number or address line, and a poster's name is never read. A search costs about twenty vendor requests (around ₹2 at Zyte's rate).
- **Asking prices are said to be asking prices.** A schedule of listings with no listing discount is flagged on the comparable, in the offer and as a lender check, and one field applies a discount to every listing. Nothing guesses the discount.
- **An empty search says why.** It distinguishes the vendor failing, the portals not knowing the locality, listings that were all too far away (with the nearest distance), and a market with nothing listed.
- **Not configured:** without a scraping service the search button is off and says what it needs. Comparables added by hand count the same.


## A five-minute walkthrough

1. **Portfolio:** the pipeline, what needs a decision, and what is overdue.
2. **Overview (Whitefield sample):** the lifecycle, the map and the key facts. Click Acquisition on the lifecycle to see what was done in that phase. Ask "Does the extent on the sale deed match the khata?"
3. **Workspace:** the answer cites each document's page and opens the survey sketch at its fact. Documents shows the deed's 15 facts, each with its words on the page.
   - *The reading, live:* on the Koramangala sample, which has no documents, press **Use the sample documents**. The nine documents are scanned on the canvas and their facts type in.
   - Point at a value to see its words marked on the page. Accept a few with Enter, correct one with E, then follow **Next** to the checks they fill.
4. **Technical DD:** the three rulings, a check with document-filled values, and the computed extent mismatch. Read the revenue map for Sy. 118/2 on the Site tab.
   - *The value, live:* on Value, press **Value this property**. The plot area types in from the sale deed, then the guidance rate from the revenue map, and the figure moves with each. Accept all and record.
5. **People:** record a request with a due date. It appears on the Overview and the portfolio.
6. **Report:** approve a section, export to Word, and open the PDF view. Issue with a named sign-off.
7. **Graph:** pick a finding, then "Why is this here?"

## Not done yet

- **F11 phone site visit:** a checklist, camera capture and offline save. The workspace does work at phone width.
- **One proposal model** merging chat cards and AI drafts, with a source recorded on each. AI drafts are still their own tab under Report.
- **A true as-of graph:** nodes carry no created time.
- **Revenue map into valuation externalities and the graph.**
- **Registered sale data as comparables.** Kaveri and IGRS transaction records are not searched yet; a registered sale is added by hand with its document.
- **Firm report template:** The client firm's Word template is not yet in hand, so export uses a generic one.
- **Email invites and access changes as proposals.**
