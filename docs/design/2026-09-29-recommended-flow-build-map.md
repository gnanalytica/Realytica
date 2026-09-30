# Row F build map: what exists, what changes, what is new

*2026-09-29. Maps the recommended flow (row F on the design canvas, F01–F11) against the code as it stands on `main`.*

The recommended flow is one visual language (Copilot Desk) with two dashboards outside the case and a chat-first workspace inside it:
- **F01 portfolio:** the engagements as a pipeline.
- **F02 case dashboard:** full width, no chat.
- **F03–F10 workspace:** chat beside a canvas with eight view tabs.
- **F11 phone site visit.**

The short version: most of the workspace already exists in a different layout. The dashboards, the request and engagement models, report export and the phone screen are new. Four integrity problems have to be fixed before any real client file goes in.

## Fix first: things that must not touch a real client file

| Problem | Where | Fix |
|---|---|---|
| **The project screen reads invented document fields.** `projectToScreenDocuments` fills every document with `extractFields`, which returns seeded random values (owner names, deed dates, registration numbers) labelled `'ocr'`. It never reads the real `EvidenceRecord.facts`. The title chain, `detectContradictions`, the graph's party, instrument and contradiction nodes, and the report's "Chain of title" block all rest on these values. | `packages/shared/src/operating-model/project-screen.ts`, `packages/shared/src/engine.ts:344`, `packages/shared/src/graph/contradictions.ts` | Feed the screen from `EvidenceRecord.facts`. Delete the `extractFields` path. Until then, hide every output built on it. |
| **Synthetic market data feeds valuations.** `reference.ts` holds 18 localities and 84 comparables. The file says they are not real market data, but each carries an IGR source string. `matchProjectLocality` falls back to `localities[0]` (Whitefield) for any unmatched city, so a Hosakote project silently gets Whitefield medians. | `packages/shared/src/reference.ts`, `capabilities.ts` (`computeIndicativeValuation`), `input-suggestions.ts` | Remove the pool and the medians from client paths. With no real comparables, the valuation reports "not enough evidence" rather than a median. |
| **Demo reset deletes the workspace.** `POST /api/demo/reset` (owners only) deletes every project in the workspace, its graph and its files, then reseeds. About exposes it as "Reset demo data". The API also auto-seeds two sample projects on boot. | `apps/api/src/routes/demo.ts`, `apps/api/src/app.ts`, `pages/About.tsx` | Remove the reset and the boot seed. Keep sample data, if at all, in a separate, labelled demo workspace. |
| **Audit actors come from the request body.** The revenue-map read and graph annotations record whatever `actor` or `author` the client sends. | `apps/api/src/routes/gis-overlay.ts`, `apps/api/src/graph/*` | Take the actor from the authenticated session. |

## Screen by screen

| Screen | Exists today | Change | New |
|---|---|---|---|
| **F01 Portfolio** | `ProjectList.tsx` (stat tiles, cards by portfolio: stage, health, counts); `MyWork.tsx` (my items across projects); `GET /api/projects`, `GET /api/work` | Rebuild the page around a pipeline | An engagement stage (Intake, Documents, Site visit, Analysis, Review, Issued) with client, fee, lead and due date; a cross-project "Needs your decision" inbox; a "Waiting on others" list; a 14-day due strip; a "since your last visit" digest (no last-seen tracking exists) |
| **F02 Case dashboard** | `Overview.tsx`: status strip, `GisOverlayCard` with `RevenueMapPicker` and `RevenueMapBrief`, material findings, overdue actions, DD progress, lifecycle history; it always renders beside the chat | Make it a full-width route with no chat; reuse the map, findings and lifecycle cards | A 9-stage stepper, the key-facts card (exists only in the unused `WorkPane`), view tiles, waiting-on and proposals cards, an "Ask Copilot" entry, "Open workspace" |
| **F03 Workspace shell** | `ProjectCockpit.tsx` with `CopilotPanel.tsx` (chat 520px, resizable) and the two-level pane strip in `cockpit/rail.tsx` | Replace the two-level strip with the eight tabs; add a back link to the dashboard; point the global rail at Portfolio, Projects, Requests and People | Nothing structural |
| **F04 Documents** | `EvidenceRegister` in `Registers.tsx`; `EvidenceProof.tsx` opens PDFs at the cited page with a highlight; OCR is English plus Kannada; `parseDocumentText` covers 15 document types; model extraction with verified page citations reaches chat as proposal cards | Add a per-document extraction panel to the Documents tab | Kannada originals shown beside the English. `DocumentFact` has no `originalValue`, and `ingest-intelligence.ts` drops the model's originals and keeps 4 quotes. Page and quote on check values: `CheckFieldValue` keeps only `sourceEvidenceId`. Contradictions computed from real facts |
| **F05 Site** | Map, picker and brief on Overview; `SiteRecord.tsx` (visits, sheets); `readRevenueMap` with real Kaveri and IGRS snapshots; the `'record'` standing and "not evidence" wording | Move the map and readings into the Site tab | A "File as evidence" action (the API returns `notEvidence: true`, with no path to evidence); the revenue map feeding valuation externalities, the graph and reports (today only the overlay reads it) |
| **F06 Value** | `Valuation.tsx` (summary, inputs, working, market, compliance, costs, evidence); `valuation-run.ts` with four approaches and tagged input sources; Rule 8 | Relabel as drivers, evidence stack and band; strip synthetic inputs (see above) | A firm comparables register, portal asking-price capture labelled "asking", an optional licensed-data connector |
| **F07 Technical DD** | `Diligence.tsx`, `DdWorkspace.tsx`, `ScopeWorkspace.tsx`, `FindingRegister`; 14 scopes, 67 checks (5 technical); RICS rating derived from severity; photo reads that never diagnose | Group checks by discipline in the tab | Photos on findings (only a count exists); more technical checks; clause citations on findings (`codeCitation` lives only on the dead `TechnicalFinding`); editable templates (today they are code constants) |
| **F08 People and requests** | `ProjectPeople.tsx` grants (role, scopes, areas, expiry); server-side redaction in `project-guard.ts`; `ActionRecord` of kind `evidence_request` with free-text owner and due date | Show access by domain (`dd-domains.ts` is unused by the UI) | A request record on `DdProject`: who owes it, sent, due, answered-by document. The only full model is the dead `CaseRequest`. Also needed: professional roles (CA, advocate, architect, valuer), invites sent by email (today they are rows claimed at next sign-in), access changes as proposals |
| **F09 Report** | `Reports.tsx` (8 kinds); `ReportEditor.tsx` with live, authored and detached blocks; issue freezes the blocks; `edit_report` proposal cards | Merge the Drafts tab into the report as tracked suggestions | Per-section states and named sign-off (issuing sets `reviewer` to the issuer); **Word and PDF export** (nothing generates either); the firm's own template; `report_section` AI drafts (declared, never created) |
| **F10 Graph** | `ProjectGraphCanvas.tsx`; routes `/graph/stored?asOf=`, `/graph/trace/:nodeId`; `why.ts`, `chain.ts` | Wire trace, why and as-of into the tab (the API client methods exist but nothing calls them) | A true as-of read: nodes and edges have no created time, so a past read includes later additions. Revenue-map nodes |
| **F11 Phone site visit** | `VisitModal` (desktop); photo upload with no camera `capture`; the condition-rating check field | – | A phone checklist screen, camera capture, a measurement and rating flow, offline save |

## The chat workspace underneath

Most of what the workspace needs already exists:
- **The chat route:** `POST /api/projects/:projectId/chat` (`apps/api/src/routes/projects.ts:984`) runs `runProjectCopilot` with 21 tools.
- **Proposals:** the model proposes through `propose_update`, which covers 18 kinds (`project-tools.ts:77`). People accept or reject them through `/chat/proposals/:id/commit` and `/reject`, with edits applied by `proposal-review.ts`.
- **Citations:** answers cite record ids, and `verifyAttribution` flags figures that no register holds.

Gaps:
- **Proposals don't record who proposed them.** `ChatProposal` has no source field; model-made cards carry the human as `createdBy`. `AiDraft` is a second, parallel model.
- **Missing proposal kinds:** none changes access or drafts a request message. Only the retired `diligence-planner.ts` drafted request messages.
- **No digest:** there is no "since your last visit" summary. `lastSeenAt` exists only on workspace members.
- **Prompts page:** it does not reach project chat, whose prompts are hard-coded (`project-copilot.ts:21`, `project-orchestrator.ts:17`, `projects.ts:1190`). Only document and photo reading use the registry.
- **Per-turn cost leaves some calls out:** the fallback call, web search, photo reads and orchestrator passes.

## Data model changes

1. **Engagement** on `DdProject`: `engagementStage`, `client`, `fee`, `lead`, `dueDate`. Add the stage and the DD types to `ProjectSummary`.
2. **Request**: recipient (a person or an outside party), `sentAt`, `dueAt`, `status`, `answeredByEvidenceId`. Age is derived from it.
3. **One proposal model**: merge `ChatProposal` and `AiDraft`, adding `source` (model, rule or person), `decidedBy`, `decidedAt` and `reason`.
4. **Facts carry their origin**: `DocumentFact.originalValue` and `originalScript`; `CheckFieldValue.page` and `quote`.
5. **Report sections**: `state` (drafted, checked, approved) and `signedBy`/`signedAt` per section; an export pipeline.
6. **Graph time**: `createdAt` on nodes and edges.
7. **People**: a professional role on grants; domain-based reach; an invite email.
8. **Lifecycle**: the model has 12 stages and the design shows 9. Either keep 12 and group procurement, pre-construction and testing into Construction for display, or cut to 9. This is a product decision; see below.

## Remove or hide (decided on 2026-09-29)

- **Automations:** hide the `/flows` routes and the sidebar item. Stop `startScheduler` (`index.ts`), `initCredentialSealing` (`app.ts`) and the four `fireAndForget` calls in `projects.ts`. Keep the code in `packages/shared/src/flow/`, `apps/api/src/flows/` and `routes/flows.ts`.
- **Netherlands:** remove `NETHERLANDS_PACK`, the 4 NL localities, the 16 NL comparables, the EUR paths in `projectToIdentity`, `lib/units.ts` and `lib/format.ts`, the Kadaster, WOZ and energy-label document kinds, and the About callout.
- **AI activity and AI instructions:** remove `Observability.tsx`, `Prompts.tsx`, `components/prompts/*`, their routes in `App.tsx` and the `Members.tsx` callout. Keep `/api/telemetry` and `/api/prompts` for admins.
- **Demo:** remove the boot seed, "Load sample township", "Reset demo data", the sample-documents chip and the Landing copy "Harohalli is the sample".
- **Dead code:** the old case copilot, orchestrator and case tools; the `PropertyCase` modules (`requests.ts`, `rfi.ts`, `technical-diligence.ts`, `playbooks`, `dd-dossier`, `dd-review`); `apps/api/src/schemas.ts`.
- **Not in row F, needs a call:**
  - Probably keep, reachable from Technical DD and Report: the Risks, Decisions and Assets registers.
  - Probably hide: Auto-run, Libraries, the Tolerance and Capabilities cards, the unused panes in `cockpit/panes.tsx`.

## Proposed order to 15 November

The milestone is three real reports for the first client firm, screening plus technical DD, with two of their engineers working in the workspace together. The order serves that milestone and puts everything else after it.

| By | Work |
|---|---|
| 6 Oct | The four "fix first" items. Hide Automations and the AI pages; remove the Netherlands pack and the demo paths |
| 13 Oct | Workspace shell (eight tabs, back link, rail); F02 case dashboard assembled from existing cards plus key facts and tiles |
| 20 Oct | Documents: the extraction panel, Kannada originals, page and quote on check values, contradictions from real facts |
| 27 Oct | Report: section states and sign-off; Word export in the client firm's own template; AI section drafts as tracked proposals |
| 3 Nov | People and requests: the request record, waiting-on with age, invites for outside professionals, professional roles |
| 10 Nov | Dry run on one real assignment for the client firm; fix what breaks |
| 15 Nov | Three real reports |
| After | F01 portfolio pipeline and digest; F11 phone site visit; the firm comparables register and asking-price capture; revenue map into valuation and graph; true as-of graph |

## Decisions needed

1. **Lifecycle stages:** keep 12 and show 9, or cut to 9?
2. **The client firm's report template:** the Word file their clients receive today, needed for export by 27 Oct.
3. **Sample data:** keep a labelled demo workspace for showing prospects, or none?
