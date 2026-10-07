# API

Everything is under `/api`, JSON in and out, and needs `Authorization: Bearer <token>` — a Google ID token from the web app, or a device token (`rdt_…`) from the site app — except `GET /api/health` and `POST /api/devices/claim`. Errors are `{ "error": "…" }` written for a person to read.

Writes on a project need a role that allows them: workspace `write` capability for the API as a whole, then the department rule for department work (a lead, contributor or signer edits; a lead or signer decides). A project in another workspace is a 404, never a 403. Responses carrying a `project` are redacted to what the caller may see.

## Projects

| Method | Path | |
|---|---|---|
| GET | `/projects` | The projects the caller reaches, with stage, health, alerts and the current engagement |
| POST | `/projects` | Create one: name, type, location, city, `currentStage`, `departments`, optional first `engagement` |
| GET, PATCH, DELETE | `/projects/:id` | Read, change particulars, delete (with its documents and graph) |
| POST | `/projects/:id/stage` | Move the project or a phase to a step; the history keeps the reason |
| GET | `/portfolio` | The firm's projects, decisions waiting, requests out, the next 14 days |

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

## Construction › Progress and the site app

| Method | Path | |
|---|---|---|
| POST | `/projects/:id/milestones` | `{ template: true }` for the usual nine, or `{ rows: [{ name, weight, plannedFinish? }] }` |
| PATCH, DELETE | `/projects/:id/milestones/:milestoneId` | `{ percent?, name?, weight?, plannedFinish? }` |
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

Checks and their fields (`/checks/:checkId`, `/checks/:checkId/fields`), assessments (`/assessments`), the registers (`/evidence`, `/findings`, `/risks`, `/actions`, `/decisions`, `/requests`), site visits and placed sheets (`/visits`, `/sheets`), the Value tab (`/value`, `/value/accept`, `/value/set-aside`, `/valuation`, `/comparables`, `/screen`), reports and their blocks (`/reports`), the chat (`/chat`, `/chat/files`, proposals, undo), AI drafts and the orchestrator, the map (`/site-context`, `/gis-overlay`) and people on the project (`/people`). Each route file names its endpoints at the top: `apps/api/src/routes/`.

Deciding where a value read off a document stands needs a lead or signer in the department the value belongs to, and answers **403** with the department's name for anybody else, with nothing changed:

| Method | Path | |
|---|---|---|
| POST | `/projects/:id/evidence/:evidenceId/facts/review` | `{ keys, decision: "accept" \| "reject" \| "reopen", edit?, take? }`. The department whose function holds the document. |
| POST | `/projects/:id/proposals/:proposalId/fields` | `{ keys, decision: "accept" \| "reject", values? }` on a card of check values. The check's department. |
| POST | `/projects/:id/checks/:checkId/fields/:key/pick` | `{ proposalId }`, or `null` to keep what the check holds. The check's department. |
| POST | `/projects/:id/proposals/:proposalId/accept`, `/set-aside` | The check's department when the card is check values. Any other card: anybody who may write. |
| POST | `/projects/:id/value/accept`, `/value/set-aside` | `{ ids, record? }`. Finance. |
| POST | `/projects/:id/comparables/decide` | `{ ids, decision: "accept" \| "reject" }`. Finance. |
| PUT | `/projects/:id/evidence/:evidenceId/workstream` | `{ workstream }` or `null`, where it moves a document out of the function that holds it. The department that holds it now. |
| POST | `/projects/:id/evidence/:evidenceId/document-type/confirm`, `/correct` | Where the kind would move a document a function already holds, or the row holds a value somebody has decided. The department that holds it now. |
| POST | `/projects/:id/certified` | Where it files a document another function holds. The department that holds it now. |

The chat takes only what the caller may decide and says in its reply what it left, and for which department; it does not answer 403. That holds for an approval typed or pressed, for a step of a plan that accepts, and for "File … under …". What is covered and what is not: [auth.md](auth.md#who-decides-what-a-document-states).

## Workspace

| Method | Path | |
|---|---|---|
| GET | `/health` | Up, auth mode, graph store, upload limits — no sign-in |
| GET, POST, PATCH | `/members` | Who is in the workspace; invite; the auto-join domain |
| GET | `/work` | What waits for me across projects |
| GET | `/libraries` | The check library |
