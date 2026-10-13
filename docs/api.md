# API

Everything is under `/api`, JSON in and out, and needs `Authorization: Bearer <token>` — a Google ID token from the web app, or a device token (`rdt_…`) from the site app — except `GET /api/health`, `POST /api/devices/claim`, the timed routes under `/api/cron` (behind `CRON_SECRET`), the provider webhooks under `/api/outside/hooks` (each behind its provider's signature) and `/api/v1` (behind an API key; see [For other systems](#for-other-systems)). Errors are `{ "error": "…" }` written for a person to read.

Writes on a project need a role that allows them: workspace `write` capability for the API as a whole, then the department rule for department work (a lead, contributor or signer edits; a lead or signer decides). A project in another workspace is a 404, never a 403. Responses carrying a `project` are redacted to what the caller may see.

## Projects

| Method | Path | |
|---|---|---|
| GET | `/projects` | The projects the caller reaches, with stage, health, alerts and the current engagement |
| POST | `/projects` | Create one: name, type, location, city, `currentStage`, `departments`, optional first `engagement` |
| GET, PATCH, DELETE | `/projects/:id` | Read, change particulars, delete (with its documents and graph) |
| POST | `/projects/:id/stage` | Move the project or a phase to a step; the history keeps the reason |
| GET | `/portfolio` | The firm's projects, decisions waiting, requests out, the next 14 days. Each request row carries `open`: the Documents part of the department it belongs to (`{ pane, extra }`), or `{ firm: 'requests' }` for a request that belongs to no department |

## Departments and people

| Method | Path | |
|---|---|---|
| PUT | `/projects/:id/departments` | `{ departments: ["finance","legal",…] }` |
| PUT | `/projects/:id/team/:email` | `{ name?, departments: { legal: "lead", … }, signer?: { profession, registration?, firm? } }`. Someone outside the firm is invited as a collaborator and their grant follows. |
| DELETE | `/projects/:id/team/:email` | Takes them off the project |
| POST | `/projects/:id/workstreams/:key/checks` | Put a workstream's checks on the project record |
| POST | `/projects/:id/engagements` | `{ kind, title?, client?, fee?, lead?, dueDate?, scope?, workstreams? }` — kinds: `acquisition_screening`, `title_dd`, `technical_dd`, `lender_monitoring`, `valuation`, `custom` |
| PATCH | `/projects/:id/engagements/:engagementId` | Stage (`intake` … `issued`), client, due date, workstreams |

## Certified reports

| Method | Path | |
|---|---|---|
| POST | `/projects/:id/certified/read` | `{ evidenceId }` → `{ readout }`: title, signer, registration, date, scope, figure, conclusion and conditions read off the document, with the page each came from |
| POST | `/projects/:id/certified` | File it as the figure of record: `{ workstream, title, evidenceId, signer, issuedOn?, scope?, figure?, verdict?, conditions? }`. Needs a lead or signer in that department, and in the department that holds the document where filing it would move it. |
| POST | `/projects/:id/certified/:reportId/acknowledge` | The lead or signer has seen the revisit flag |

## Finance › Budget

Under `/projects/:id`. Entering needs a lead, contributor or signer in Finance; the rows marked *decides* need a lead or signer, and answer 403 naming the department for anybody else. Each answers with the `project` and, for a cost report, `report` and `totals`; for the register, `summary`.

| Method | Path | |
|---|---|---|
| POST | `/cost-reports` | Start a month's Cost Report: `{ month? }` (any day in it; this month when left out) or `{ from, to }`, `label?`, `note?`, `seedPackages?` (unless `false`, rows from the last report issued for an earlier period, or from the register's work packages when there is none) |
| PATCH | `/cost-reports/:reportId` | `{ note?, photoEvidenceIds? }`, or `{ issue: true }` or `{ reopen: true }` (*decides*). `reopen` opens a revision: a draft beside the issued report, which stays as it was issued. The answer's `report` is the draft, with `revises` naming the issued one; where a draft is open already it is that one. Issued in its turn, the revision takes the first's place and the first is `superseded` |
| POST | `/cost-reports/:reportId/packages` | A ledger row: `{ name, code?, workPackageId?, budget?, poIssued?, amountPaid?, anticipatedCost?, note? }` |
| PATCH, DELETE | `/cost-reports/:reportId/packages/:rowId` | Change or remove a row |
| PUT | `/cost-reports/:reportId/change-reasons/:workPackageId` | `{ reason }`: one line on why the package moved since the last issued report, or `null` to clear it. Draft only |
| POST, PATCH, DELETE | `/cost-reports/:reportId/variations`, `…/variations/:variationId` | The variation log |
| POST, PATCH, DELETE | `/cost-reports/:reportId/basic-prices`, `…/basic-prices/:lineId` | Basic price adjustments |
| POST | `/cost-reports/:reportId/import` | Multipart `file` (.csv or .xlsx, 4 MB) or `text`, a pasted table → rows added or updated by code or name, with `added` and `updated` |
| POST, PATCH | `/cost/contracts`, `/cost/contracts/:contractId` | `{ contractor, title, value, reference?, workPackageIds?, retentionPercent? }` |
| DELETE | `/cost/contracts/:contractId` | *Decides.* Only while it has no bills |
| POST | `/cost/bills` | `{ contractId, number, date, periodFrom?, periodTo?, statedTotal?, evidenceId?, lines? }` |
| PUT | `/cost/bills/:billId/lines` | Replace a bill's lines |
| POST | `/cost/bills/:billId/lines/:lineId/certify` | Pass an amount for one line: `{ amount, quantity?, note? }` |
| POST | `/cost/bills/:billId/certify` | *Decides.* Issue the certificate: `{ signer: { email, profession, name?, registration? }, certifiedOn, deductions?, note?, evidenceId? }` |
| POST | `/cost/bills/:billId/withdraw` | *Decides.* Withdraw the certificate: `{ reason? }` |
| POST | `/cost/bills/:billId/payments` | `{ amount, paidOn, reference? }` |
| POST | `/cost/bills/:billId/payments/:paymentId/void` | *Decides.* `{ reason }` |
| DELETE | `/cost/bills/:billId` | *Decides.* Only while nothing on it is decided, certified or paid |

## Construction › Progress and the site app

| Method | Path | |
|---|---|---|
| POST | `/projects/:id/milestones` | `{ template: true }` for the usual nine, or `{ rows: [{ name, weight, plannedFinish? }] }` |
| PATCH, DELETE | `/projects/:id/milestones/:milestoneId` | `{ percent?, name?, weight?, plannedFinish? }` |
| POST | `/projects/:id/milestones/import` | A schedule: multipart `file` (CSV, TSV or .xlsx, 4 MB) or `{ text }`, a header row then a row a milestone → `{ project, added, updated, unchanged, skipped: [{ line, name, reason }] }`. A milestone named again keeps its recorded progress. |
| GET | `/cron/alerts` | The daily timer, outside sign-in: needs `Authorization: Bearer <CRON_SECRET>`, else 401. Brings every project's alerts up to date, then runs every other timed job; see [Timed routes](#timed-routes). Safe to call twice. |
| GET | `/projects/:id/site` | The site app's whole view: project, role, milestones, progress, construction gate, recent log, construction alerts |
| POST | `/projects/:id/site-log/photos` | Multipart `photos` (up to 6, 4 MB each) → `{ photos: [{ storageKey, fileName, mimeType }] }` |
| POST | `/projects/:id/site-log` | `{ clientId, date, weather?, manpower?, workDone?, milestoneUpdates?, issues?, photos?, point? }`. Idempotent on `clientId`: a resend answers 200 with `duplicate: true`. |
| GET | `/projects/:id/site-log/:entryId/photos/:index` | A photograph's bytes |

## Pairing phones

| Method | Path | |
|---|---|---|
| POST | `/devices/pair-code` | Signed in on the web → `{ code, expiresAt, ttlSeconds }` |
| POST | `/devices/claim` | No sign-in. `{ code, name?, platform? }` → `{ token, device, person, workspace }`. Ten tries a minute per address. |
| GET, DELETE | `/devices/me` | The phone's own pairing; DELETE signs it out |
| POST | `/devices/push-token` | `{ token }`, the phone's Expo push token, or `null` |
| GET | `/devices` | Your phones (every phone, for an admin) |
| DELETE | `/devices/:id` | Revoke one |

A device token reaches only `GET /projects`, `GET /projects/:id/site`, the site log and its photos, milestone progress, alert reads and its own pairing; anything else is a 403.

## Alerts, links, documents, the graph

| Method | Path | |
|---|---|---|
| POST | `/projects/:id/alerts/read` | `{ ids: [...] }` or `{ ids: "all" }` |
| POST, DELETE | `/projects/:id/links`, `/projects/:id/links/:linkId` | A link a person draws: `{ from: { kind, id }, to: { kind, id }, type, note? }` |
| PUT | `/projects/:id/evidence/:evidenceId/workstream` | `{ workstream }`, or `null` to read it from the document again. Moving a document a function already holds needs a lead or signer in the department that holds it now. |
| POST | `/projects/:id/uploads` | Start a large upload: `{ fileName, contentType, size }` → `{ uploadId, partBytes, parts }` |
| PUT | `/projects/:id/uploads/:uploadId/parts/:n` | One part's bytes as the body (4 MB) |
| POST | `/projects/:id/uploads/:uploadId/complete` | `{ evidenceId?, title? }` → files it in the vault and reads it |
| POST | `/projects/:id/evidence/files` | Small documents against register rows, one request. A file put on a row that already has a kind never renames it: what the file reads as is left as an offer to confirm or correct. |
| GET | `/projects/:id/graph` | The projection |
| GET | `/projects/:id/graph/stored` | What the graph store holds, optionally `?asOf=` |
| GET | `/projects/:id/graph/impact?node=` | What a change to one record reaches — answered by Neo4j, with the projection as fallback. For somebody working from a grant: from their own copy of the project only, and 404 for a record that is not on it. |
| GET | `/projects/:id/graph/neighbourhood?query=&hops=` | The neighbourhood the chat reads, cut to what the caller can reach |

## The rest of a project

Checks and their fields (`/checks/:checkId`, `/checks/:checkId/fields`), assessments (`/assessments`), the registers (`/evidence`, `/findings`, `/risks`, `/actions`, `/decisions`, `/requests`), site visits and placed sheets (`/visits`, `/sheets`), the Value tab (`/value`, `/value/accept`, `/value/set-aside`, `/valuation`, `/comparables`, `/screen`), reports and their blocks (`/reports`), the chat (`/chat`, `/chat/files`, `/chat/voice` for whether a voice note can be put into words here, proposals; an undo is a message to `/chat`), plans (`/plans`, `/plans/:planId`, `/plans/:planId/stop`), a meeting's notes (`/meetings/:meetingId/notes`), questionnaires and observations (`/questionnaires`, `/observations`), a department's checklist of papers (`/checklist`, `/checklist/import`, `/checklist/requests`), reading a photograph (`/photographs/read`), the review table (`/review`), letters and minutes (`/outgoing`), the project's memory (`/memory`, `/memory/lint`), AI drafts and the orchestrator, the map (`/site-context`, `/gis-overlay`) and people on the project (`/people`). Each route file names its endpoints at the top: `apps/api/src/routes/`.

The owner pack's page (`/projects/:id/owner-pack/print?month=YYYY-MM`, or `?from=&to=` as two days) reads `GET /projects/:id` and builds the pack in the browser with `ownerPack` from `packages/shared`, on request, from the project as the caller is handed it; `?pack=<id>` opens a kept pack exactly as it was prepared or issued. Keeping, issuing and the report day are under [Report day and kept owner packs](#report-day-and-kept-owner-packs).

Deciding where a value read off a document stands needs a lead or signer in the department the value belongs to, and answers **403** with the department's name for anybody else, with nothing changed:

| Method | Path | |
|---|---|---|
| POST | `/projects/:id/evidence/:evidenceId/facts/review` | `{ keys, decision: "accept" \| "reject" \| "reopen", edit?, take? }`. The department whose function holds the document. |
| POST | `/projects/:id/proposals/:proposalId/fields` | `{ keys, decision: "accept" \| "reject", values? }` on a card of check values. The check's department. |
| POST | `/projects/:id/checks/:checkId/fields/:key/pick` | `{ proposalId }`, or `null` to keep what the check holds. The check's department. |
| PUT | `/projects/:id/fields/values` | `{ set, record?, period?, values }`. What a person types into a function's sheet. All or nothing. A role that edits in the function's department. A record that is an issued period answers **400**: it is revised, not edited. `period` names a period of a sheet kept by period whose revision is open: the values go to the revision, and the sheet itself is not touched. |
| POST | `/projects/:id/fields/period` | `{ set, act, record?, period?, name?, field?, reason? }` on a set kept by period. `act: "open"` opens the period today falls in, or `period` (`2026-09`, `FY2026-Q2`, `2026-W41`, `FY2026`, `evt:<record>`), from the last with what the set carries, and answers `recordId`; asked twice it makes nothing twice. `"issue"` issues `record`, or for a sheet the period that last ended (or `period`), under the caller's name, or `name` where the set's issuer is an outside party. `"revise"` opens a revision of an issued `record`, or of a sheet's `period`. `"reason"` picks from the set's list why `field` moved beyond what its rows explain, or with `null` takes the pick back. Opening and picking need a role that edits in the function's department; issuing and revising a lead or signer, and the signer alone where the set says so. **404** where the caller's grant does not reach the function. |
| POST | `/projects/:id/fields/decide` | `{ address, decision, value?, pick?, reason?, note? }`. `decision` is `accept`, `keep`, `set_aside`, `dispute`, `not_applicable` or `reopen`. A lead or signer of the function's department, but for `dispute`. |
| POST | `/projects/:id/fields/accept-paper` | `{ fn, evidenceId }`. Accepts every value one paper offered to a function's sheets, but for the ones a person has to name. |
| POST | `/projects/:id/fields/records` | `{ set, values }` adds a record to a set that repeats; `{ set, remove }` takes one off its list. |
| PUT | `/projects/:id/fields/situation` | `{ fn, key, on }`. Puts a situation in play or takes it out. |
| PUT | `/projects/:id/fields/snooze` | `{ fn, key, until }`, `until` a day as `YYYY-MM-DD` or `null`. Puts a line under Due soon off until that day, at most 90 days ahead, or brings it back. A lead or signer of the function's department; only a Due-soon line can be put off. |
| PUT | `/projects/:id/fields/section` | `{ set, section, reason, note? }`. Marks a section not applicable with one of five reasons, or with `null` asks it again. |
| POST | `/projects/:id/proposals/:proposalId/accept`, `/set-aside` | The check's department when the card is check values. Any other card: anybody who may write. |
| POST | `/projects/:id/value/accept`, `/value/set-aside` | `{ ids, record? }`. Finance. |
| POST | `/projects/:id/comparables/decide` | `{ ids, decision: "accept" \| "reject" }`. Finance. |
| PUT | `/projects/:id/evidence/:evidenceId/workstream` | `{ workstream }` or `null`, where it moves a document out of the function that holds it. The department that holds it now. |
| POST | `/projects/:id/evidence/:evidenceId/document-type/confirm`, `/correct` | Where the kind would move a document a function already holds, or the row holds a value somebody has decided. The department that holds it now. |
| POST | `/projects/:id/certified` | Where it files a document another function holds. The department that holds it now. |

`POST /projects/:id/fields/decide` on a check's address settles the card the value waits on, and settling the card settles the field: there is one store. `GET /projects/:id/checks/:checkId/fields` also returns `shown` (each key as `shown`, `folded` or `hidden`), `notInPlay`, `situations` and `fn`, so a check screen asks only what its approach brings into play.

Reports: `POST /projects/:id/reports` takes `kind: "function"` with `template`, the id of a function's report template (listed in [departments.md](departments.md)); **400** for a template that does not exist. With `period: { from, to }` as well, a function's report is made for that period: every section that reads fields is read as the project stood when the period's last day ended in India (`asAt` on its source), says "Figures as at 30 Sep 2026.", and prints "as now" beside anything the record's history does not reach. A report block's source may be `fields` (`addresses`, `layout`), `field_table` (`address` or `records`, `columns`) or `field_chart` (`address` or `records`, `x`, `y`, `mark`; or `periods`, the id of a set kept by period, with `y` its field and `moved` to draw what each period added), each with `asAt?`, a day as `YYYY-MM-DD`. Editing the text of a block frozen from fields, or a note past its cap of 2,000 characters, answers **400**.

Photographs: `PUT /projects/:id/photographs/note` `{ evidenceId, fileId, text }` keeps a person's own capped note on a photograph, beside what was picked for it.

A chat result's `assistantTurn` may carry `card`: the rows a model picked, each with its label, the value as the record holds it, where it stands (`worked_out` for a figure nobody accepted because it is worked out), its source, and for a figure read from the rule table the rows it read with `verified` for each.

**What a collaborator's copy leaves out of the fields.** `GET /projects/:id` for somebody working from a grant omits every buyers' set (`commercial.inventory.buyers`), the party records one of them names or that carry the role customer, and, on a shared record, the fields a department added whose function is out of the grant's reach. A report in that copy carries no section naming any of those, and no list of parties kept as it read one day.

The chat takes only what the caller may decide and says in its reply what it left, and for which department; it does not answer 403. That holds for an approval typed or pressed, for a step of a plan that accepts, and for "File … under …". What is covered and what is not: [auth.md](auth.md#who-decides-what-a-document-states).

## Report day and kept owner packs

Under `/projects/:projectId/report-day`. The firm's own people only: a collaborator is answered 404.

| Method | Path | |
|---|---|---|
| GET | `/` | The report day setting, the kept owner packs, what waits to be issued, whether email is set up, the firm's people, and whether the caller may prepare or issue |
| PUT | `/` | `{ day: 1-31, reports: ['status','owner_pack'], every: 'month'\|'quarter', quarters?: 'financial'\|'calendar', tell: [emails of the firm's own people, at most 12] }` or `{ clear: true }`. Lead or signer in a department of the project |
| POST | `/packs` | Keep the owner pack for one period: `{ month: 'YYYY-MM' }` or `{ quarter: 'FY2026-Q2' \| '2026-Q3' }` or `{ from, to }`; with `{ issue: true, name? }` it is issued in the same step. Keeping needs lead, contributor or signer; issuing needs lead or signer. A project keeps at most 60, and none can be deleted |
| POST | `/packs/:packId/refresh`, `/issue`, `/reopen` | Read a waiting pack from the record again (lead, contributor or signer); issue it under the caller's name, body `{ name? }`; reopen an issued pack, which stays as issued, and answer with the copy kept beside it, waiting, or the one already waiting for that period (lead or signer for both) |

## Procurement › Tenders

Under `/projects/:projectId/procurement`. Stages, bidders and the estimate need a lead, contributor or signer in Procurement. The recommendation, the letter of acceptance, taking the letter back and removing a tender need a lead or signer in Procurement. Accepting or declining the offer needs a lead or signer in Finance. Refusals are 403 and name the department. The whole path is 404 to somebody working from a grant that does not name Procurement. Every write answers `{ project, ... }` with the caller's own copy of the project.

| Method | Path | |
|---|---|---|
| GET | `/` | Tenders with standing and comparison, what waits on Finance, the flag limits, and what the caller may do |
| POST | `/tenders` | `{ workPackageId, estimate? }`. One tender a work package |
| PATCH, DELETE | `/tenders/:tenderId` | `{ estimate: number or null }`; remove while it has no letter of acceptance |
| PUT | `/tenders/:tenderId/stages/:stage` | `{ dueOn?, owner?, doneOn?, notNeeded? }`, `null` clears |
| POST | `/tenders/:tenderId/bidders` | `{ name, quoted?, revised?, qualifications?, exclusions?, lines?: [{ item, amount }] }` |
| PATCH, DELETE | `/tenders/:tenderId/bidders/:bidderId` | Change or remove a bidder |
| PUT | `/tenders/:tenderId/recommendation` | `{ bidderId, text }` |
| POST, DELETE | `/tenders/:tenderId/letter-of-acceptance` | `{ bidderId, value, letterOn, evidenceId? }` offers the value to Finance; DELETE takes it back while Finance has not accepted |
| POST | `/tenders/:tenderId/offer/accept` | Writes PO issued, in place of what stood, on the newest draft Cost Report holding the package; refused when there is none |
| POST | `/tenders/:tenderId/offer/decline`, `/offer/again` | `{ reason }`; offer a declined value again |
| POST | `/variations/:variationId/offer/accept` | A lead or signer in Finance takes an approved variation onto the newest draft Cost Report holding its package: PO issued and the anticipated cost move by the amount and the variation log gains the line. `{ forecast: 'already_in' }` moves PO issued alone. 404 where no approved variation by that id waits; 400 where no draft holds the package |
| POST | `/variations/:variationId/offer/decline` | `{ reason }`. The Cost Report is left as it is; the variation is offered again only if its approved amount changes |

## Templates

Under `/projects/:projectId/templates`. The firm's own people only (a collaborator is answered 404). Reading and downloading need a place in the template's department; uploading and deciding need a lead, contributor or signer; removing needs a lead or signer.

| Method | Path | |
|---|---|---|
| GET | `/` | `?department=` — the templates this person may read, with counts, and whether a model is set up |
| POST | `/` | Multipart: `file` (.docx or .xlsx, 4 MB at most), `department`, `title`. Finds the blanks. 201 `{ template, model }`. 413 when the file unpacks to more than may be opened (for a workbook, its sheets past 4 MB, or what it carries beside them past 16 MB); 400 when no blank is found or the file is another kind |
| GET | `/:templateId` | `{ template: { rows: [{ field, status, offers }], summary }, model, mayEdit, mayDecide }` |
| PUT | `/:templateId/fields` | `{ decisions: [{ fieldId, decision: accept \| type \| blank \| reopen, value? }] }`, 200 at most |
| GET | `/:templateId/file?kind=filled \| sources \| original` | The same file filled, the PDF list of sources, or the file as sent. Taking the filled file out is noted on the audit trail, and a department viewer may |
| DELETE | `/:templateId` | Remove it |

## A connected folder

Under `/projects/:projectId/connector`. The firm's own people only; a collaborator gets 404. The changing routes need a firm role that may write and a lead, signer or contributor role in at least one of the project's departments; otherwise 403.

| Method | Path | |
|---|---|---|
| GET | `/` | How the connected folder stands: `{ configured, kind, address?, connector?, mayChange }` |
| PUT | `/` | Body `{ link }`. Connects the folder the link names after checking the service account can see it. 400 for a link that names no folder or a folder not shared; 503 where not set up |
| POST | `/sync` | Reads the whole folder now, up to 10 files and 60 s. Answers the same shape plus `run: { takenIn, changed, skipped, waiting, failed, error? }`. 409 where no folder is connected or a read is under way |
| DELETE | `/` | Disconnects. The papers taken stay |

## The daily review

Under `/projects/:projectId/daily-review`. Firm members only; 404 to a collaborator.

| Method | Path | |
|---|---|---|
| GET | `/` | The suggestions nobody has decided, whether a model is set up, when the project was last reviewed, and the departments this person decides in. A suggestion says whether a rule or a model's nomination found it (`by`), the fields it is about (`subjects`) and the two things set against each other; its line is worded by code. The run's counts carry `byRule`, and `noModel` means only that the two kinds that need a model did not run |
| POST | `/:suggestionId/accept` | Body `{ as?: "finding" \| "risk" }`. Lead or signer of the suggestion's department; 403 otherwise, 409 if already decided. Answers with the project and `{ record: { type, id } }` |
| POST | `/:suggestionId/dismiss` | Body `{ reason }` (3 to 300 characters). Same role. A later proposal about the very same entries is not raised again |

## Requests to outside parties

Under `/outside`. The firm's own people: collaborators get 404, writes need the write capability, and a request raised from a checklist needs an editor in that department.

| Method | Path | |
|---|---|---|
| GET | `/outside/status` | Which channels are set up |
| POST | `/outside/projects/:projectId/requests/:requestId/send` | `{ channel: 'email' \| 'whatsapp', to }`. 409 naming the missing setting where the channel is not set up |
| POST | `/outside/projects/:projectId/requests/:requestId/replies/:replyId/confirm`, `…/set-aside` | A person confirms a reply, or sets it aside. Nothing is marked received before |
| GET | `/outside/tray`, `/outside/tray/:itemId/papers/:attachmentId` | Mail that named no open request, or came from anywhere but the address or number the request was sent to or a member of the firm, or by email from a sender whose domain did not pass DMARC. At most 500 items for a firm and 20 from one sender |
| POST | `/outside/tray/:itemId/file`, `/outside/tray/:itemId/discard` | `{ projectId, requestId? }` files it to a project; or discard |

Ahead of sign-in, each behind its provider's signature: `POST /outside/hooks/resend` (Resend `email.received`, Svix signature, five-minute tolerance), `GET /outside/hooks/whatsapp` (Meta's handshake) and `POST /outside/hooks/whatsapp` (`X-Hub-Signature-256`). A channel not set up answers 503. One delivery is taken once. A reply is taken onto a request only from the address or number the request was sent to or one of the firm's own members, and by email only where the sender's domain passed DMARC; anything else goes to the tray. A message past 20 in the tray from one sender is answered 200 and dropped, and a full tray (500 for a firm) answers 500 so the provider sends the message again. A request holds five replies waiting; a sixth goes to the tray. Caps: 10 papers a message, 25 MB each, 50 MB a message, 1 MB webhook body. No link in a message is fetched. There is no rate limit on these routes beyond the signature check and the body cap.

## For other systems

`GET /api/v1/projects`, `GET /api/v1/projects/:id`, `GET /api/v1/projects/:id/alerts` (`?state=all`), `GET /api/v1/projects/:id/reports`, `GET /api/v1/projects/:id/papers-owed` — API key only (`Authorization: Bearer rlk_…`), read-only, scopes `projects:read` / `reports:read` / `documents:read`; 401 unknown, revoked or expired key, 403 missing scope, 404 project not reachable, 429 over the key's limit or the caller's address, which is counted before any key is looked up. A key is refused with 401 on every other route. Reports are issued generated reports as metadata only. See [integrations.md](integrations.md).

The firm's side, for an owner or manager (403 otherwise): `GET /api/integrations`, `POST /api/integrations/keys` (`projectIds`, when given, names at least one project and at most 200; no list is every project), `DELETE /api/integrations/keys/:id`, `POST /api/integrations/endpoints`, `DELETE /api/integrations/endpoints/:id`, `POST /api/integrations/endpoints/:id/test`.

## Timed routes

Outside sign-in, each needing `Authorization: Bearer <CRON_SECRET>`, else 401. Vercel calls them (`crons` in `vercel.json`); each is safe to call twice. Every job answers under its own key with its counts, `{ error }` when it threw or outlasted its time, or `{ notRun }` when the run had no time left to start it; one job failing never stops the next.

| Method | Path | |
|---|---|---|
| GET | `/cron/alerts` | Once a day, 01:30 UTC. In order: `alerts` `{ projects, changed, raised, resolved, failed }`, `tell` `{ projects, messages, notices, mailed, pushed, failed }`, `drive` `{ projects, read, takenIn, changed, skipped, waiting, failed, busy, notReached, notSetUp }`, `reportDay` `{ projects, prepared, told, failed }`, `webhookRetry` `{ due, delivered, failed, gaveUp, endpointsFailing, told }`, `lawWatch` `{ firms, looked, changed, failed }`, `fileSweep` `{ projects, due, swept, raised, dropped, repeats, overCeiling, deferred, failed, tokens, noModel }`. The law watch writes to no project |
| GET | `/cron/often` | Every ten minutes: `tell` and `webhookRetry` |
| GET | `/cron/hourly` | Every hour: `drive` |

## Workspace

| Method | Path | |
|---|---|---|
| GET | `/health` | Up, the version, how many projects the instance holds, auth mode, graph store, upload limits — no sign-in |
| GET, POST, PATCH, DELETE | `/members`, `/members/:email` | Who is in the workspace; invite; change a role or remove somebody; the auto-join domain |
| GET | `/work` | What waits for me across projects |
| GET | `/tell` | The caller's own notices across every project they reach, newest first (at most 200), with unread, the projects they have quieted, and `channels { email, push }`. A notice of a paper owed or a request carries `open`, the same place a request row does |
| POST | `/tell/read` | `{ ids: string[] (1 to 500) \| 'all' }` — marks the caller's own notices read; 404 when ids are named and none is theirs |
| PUT | `/tell/quiet/:projectId` | `{ quiet: boolean }` — quiets a project's mail and push for the caller, or stops; 404 for a project they cannot reach |
| GET | `/analytics/portfolio` | The firm's projects side by side: forecast against budget from each project's last issued Cost Report with the movement since the one before, planned against projected completion and extension-of-time flags, papers owed by party, open alerts by kind, and what waits on the owner. Every figure carries the rows it counts (at most 200, with a `more` count), each with its source and where it opens |
| GET | `/analytics/departments?project=<id>` | One project by department: decisions waiting for acceptance and the oldest's age, actions open and overdue, requests out and their age. 400 without a project id, 404 for a project that is not the firm's |
| GET | `/analytics/people` | `{ generatedAt, people }`: for each person the caller may read, open work, overdue work, what they accepted in the last 30 days, and the median days a thing waited. People are listed by name; nothing ranks or scores them. All three analytics routes answer 403 to a collaborator, and a viewer gets an empty `people` list |
| GET | `/setup` | Read-only. Everything that can be connected or scheduled, as it stands: `{ firm: SetupRow[], projects: [{ id, name, reference, rows: SetupRow[] }] }`, a row being `{ key, label, standing: 'working' \| 'not_set_up' \| 'failing' \| 'not_used', says, needs?, settings?, error?, open? }`. The firm's rows are mail, requests by email and by WhatsApp, Google Drive, the timer, the AI model and the law sources, and for a firm admin API keys and webhooks; a project's are its Drive folder and its report day. Firm members only; a collaborator gets 403 |
| GET | `/law-watch` | The firm's watched sources, changes waiting and lately decided, the rule rows offered (`offeredRows`), and what the caller may do. Firm members only; a collaborator gets 403 |
| POST, PUT, DELETE | `/law-watch/sources`, `/law-watch/sources/:sourceId` | Add, change or pause, and remove a source. Admin |
| POST | `/law-watch/sources/:sourceId/look` | Read one source now. Admin |
| GET | `/law-watch/changes/:changeId/pages` | The page's words before and after a change |
| POST | `/law-watch/changes/:changeId/confirm` | Body `{ fields, projects: [{ projectId, actions: [{ department, next, about? }] }] }`: `fields` is the change as fields (instrument, reference, dated, effective from, kind of change, the figure before and after, what it affects), `next` a step off a fixed list, `about` a field, an approval or a row of the rule table. There is no summary and no title to write. Puts the actions on those projects, and where the change moves a rate offers a new rule row, unverified. A firm admin, or a department's lead for the departments they lead; 403 otherwise, 409 if already decided. A lead decides only for the projects they lead: the change waits for the rest until their leads decide or an admin closes it, and a project decided once is refused a second decision (409), for admins too |
| POST | `/law-watch/changes/:changeId/dismiss` | Body `{ why? }`; nothing reaches a project |
| POST | `/law-watch/rule-rows/:offerId/verify` | Marks an offered rule row verified under the caller's name. Admin; 404 for no such offer, 409 once verified. From then the row is the firm's: every figure on its projects that reads the rule reads this row from the day it takes effect |
| GET | `/law-watch/rule-rows` | `{ groups, total, verified, mayCheck }`: every rule row the firm's projects read, by the department whose fields read it, each with its citation, its source, the fields worked out from it and whether it is verified. The firm's own people only |
| POST | `/law-watch/rule-rows/check` | `{ row, clause, readOn, page?, url? }`, `row` as the list gave it (`ref`). Marks the row checked against its instrument under the caller's name, as the firm's own row. Admin; 404 for no such row, 409 once verified |
| GET, PUT | `/firm-fields` | GET, for anybody who can read: `{ pack, sets, mayManage, ruleRows }`, the firm's own fields, the built-in sets they may be added to, and the rule rows the firm has verified. PUT `{ optionSets, add, demote }`, a firm admin's: saved whole, or refused with every fault named |
| GET, PUT | `/report-settings` | GET `{ modelWording, maySet }`. No model rewords a report: `modelWording` is true only for a firm that turned it on before, PUT `{ modelWording: true }` answers 400, and PUT `{ modelWording: false }` (admin) takes a model's earlier wording off every status report not yet issued |
| GET | `/libraries` | The check library |
| GET, POST, PUT, DELETE | `/libraries/review`, `/libraries/review/:itemId` | The workspace's saved asks and playbooks for the review table |

## The model's tools for fields

- `get_fields({ fn })` or one field set: each field with its address, kind, unit, choices and state, read through the firm's catalog. It also returns the five need counts (`decide`, `accept`, `failing`, `due_soon`, `missing`), `waitingOn`, and for each field its depth sheet, `notDueBefore` and `owedBy`. It covers every function that keeps sheets.
- `propose_field_values({ values: [{ address, value, origin }] })`: a value with a paper's page and exact words, or a named public source and the day it was read. Refused without a source, for a choice not on the list, for a link to nothing on the project, and for a field that is worked out, a standing, a mirror or a person's words. On a check's field it makes one card for each check and source, none for a value already held, waiting or set aside, and takes a public source except where the field's proof is required.
- `answer_with_fields`: the one way a model answers in the chat. It names fields, records, memory lines and passages, an outcome, and where to look when the record does not answer. It has nowhere to put a sentence.
- `propose_update` kind `edit_report` carries only a source: what a section reads. A model writes no word of a report.
