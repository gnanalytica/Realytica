# Realytica — product

Realytica is one workspace for a property's whole life — land, design, approvals, construction, sales and handover, then running the finished building — and for every profession that works on it. Engineering and due-diligence firms are the first users; developers, lawyers, valuers, chartered accountants, architects and site teams join the same project.

## How a project is organised

**Stages (when).** Four stages, each made of finer steps. The timeline sits at the top of every page; clicking a stage shows what happened in it.

| Stage | Steps |
|---|---|
| Pre-development | Opportunity · Feasibility · Acquisition |
| Design & Tender | Design · Approvals · Tender & procurement |
| Construction | Pre-construction · Construction · Testing & commissioning · Completion (OC) |
| Operations | Handover · Operations (property management) |

A phased project can have each phase at its own step; phases show as markers on the timeline.

**Departments (what kind of work).** Six departments, each a separate module that links to the others. A firm switches on its usual set; each project can override it.

| Department | Workstreams | Status |
|---|---|---|
| Finance & Investment | **Valuation** · Feasibility & underwriting · Budget & cost to complete · Funding & escrow · Tax | Live |
| Legal & Compliance | **Title & land records** · **Approvals & NOCs** · RERA · Contracts & disputes · Handover & society | Live |
| Engineering & Construction | **Progress & schedule** · **Technical due diligence** · **Site record** · Safety & environment | Live |
| Design & Architecture | Drawings & versions · Design compliance · RFIs · Coordination | Coming soon |
| Procurement & Supply Chain | BOQ & tenders · Purchase orders · Vendors · Deliveries | Coming soon |
| Commercial & Operations | Market & pricing · Sales & leasing inventory · Buyers & collections · Handover & defects · Property management | Coming soon |

Bold workstreams are built; the rest are listed with what they will produce.

A project's departments are chosen when it is made and changed from **Overview › Departments on this project** (a workspace admin's control). Switching one off hides it and deletes nothing. A new project starts from the departments the firm's last project used.

**An engineering-only project.** A firm doing only the technical work runs Engineering & Construction alone. Its technical due diligence is one screen in five steps, each showing its own count: **Documents**, **Questions**, **Site**, **Observations**, **Report**. Four figures sit above them: documents in hand, checks answered, open findings and the cost to remedy.

- **Observations and mitigations** (step 4) is the table the report is read for: area by area, what was seen, its risk category, the mitigation, the code it is judged against, and the photographs that show it. An observation is a finding — the same record a check raises or the chat proposes — so nothing is entered twice. Below the table sit the photographs nothing cites yet, from the document register and from the phone's site log, each with what a model saw in it and any finding it suggested; one press starts an observation from a photograph or attaches it to one. A site-log photograph is filed onto the register the first time it is used.
- **Report** (step 5) creates the **technical due diligence report** and opens it. It starts with the sections an engineer's report has — the property, scope and basis, building information, observations and mitigations, remedial cost, the inspection record, documents reviewed and outstanding, limitations, opinion — and three of them are tables that read the steps before: the answered questionnaire (a suggestion nobody confirmed is printed as not answered, and answers resting on the seller's word alone are counted), the observations with their risk, mitigation and reference, and the document sheet with what was not received. The photographs each observation cites print under the table, captioned with the row, the date and the coordinates. The tables print the same on screen, on paper and in the Word file, and an issued report keeps them as they stood. The three tables also export on their own.

The pieces under the other steps:

- **The requirement sheet** (step 1): every document the checks expect, by discipline — Architecture, Structural, MEP, Statutory — each one not asked, asked for or in hand. Tick the ones to chase, name who is asked and by when, and a tracked request goes out for each. A line turns to in hand on its own when the paper is filed. It copies as a list and exports as a spreadsheet.
- **The charts** under Observations: findings and checks by discipline, and what the remedies cost by how soon they are needed.
- **Supporting documents**: the client's deeds, approvals and valuation still arrive. They are read and citable, and show on the department page as supporting documents; one can be given to a workstream here. Switching Legal or Finance on later puts each where it belongs.

- **The questionnaire** (step 2): the client's own list of questions about the building, imported as written from a Word file, a spreadsheet saved as CSV, or pasted text. Answers already in the sheet come in as the seller's. Each answer records where it came from — the seller said so, a document states it, it was seen on site, or it is the engineer's view — and the documents or photographs that stand behind it, with the page. The chat can answer from the documents on file; its answers arrive as suggestions and wait for a person to confirm them, one by one or all at once. The answered sheet copies as text and exports as a spreadsheet, in the order the questions came in.

The chat does all of this too: it reads the requirement sheet, the questionnaire and the technical summary, and proposes asking for documents, moving a document, or changing the departments (the last for an admin to approve).

**Workstreams (the work inside).** Each workstream holds, stage by stage:

- a **quick assessment** — a living estimate, built from the project's own findings and data with AI help, following the official method for that kind of assessment, re-read whenever anything changes;
- **certified reports** from named professionals — the figure of record;
- its **checks** and **records** (approvals, milestones, site entries, comparables…);
- the **documents** it owns, from the one shared vault.

**Engagements (who it's for).** A piece of work a client commissions — acquisition screening, title due diligence, technical due diligence, a lender's independent engineer, an indicative valuation. An engagement draws on workstreams and produces one deliverable. Checks live once, in their workstream, so the same title check serves every engagement that needs it.

## Quick assessments and certified reports

A quick assessment fills its inputs in this order, and a higher source always overrides a lower one:

1. Verified data on the file
2. The project's own documents
3. Government records, laws and policies (registered sales, guidance values)
4. Regulatory and professional standards (IBBI, RICS, IS codes, NBC)
5. Licensed transaction data
6. Portal listings (asking prices)
7. Reputable published sources
8. Standard assumptions

Every input shows its source. Assumptions are labelled; a figure resting more than half on them shows only as a rough range. Two sources at the same level that disagree are shown side by side for a person to pick.

A certified report — a title opinion, a valuation, a progress certificate — is uploaded by its signer and read for its figures, signer, registration, date and scope. It becomes the figure of record. The quick assessment keeps running beside it, and the report is flagged **for revisiting** when later evidence moves the estimate:

- a figure more than 10% from the certified one;
- progress more than 5 points from the certified progress;
- any new blocker, or a new condition where the report was clear.

The flag goes to the department's lead and the professional who signed.

## People and access

Roles per department: **Lead** (runs it, accepts proposals, owns deadlines), **Contributor** (adds documents, records, site entries), **Signer** (certifies its reports; their registration is recorded), **Viewer**. A person can hold different roles in different departments. Firm roles set the default; outside collaborators reach only the departments they are given.

## One chat, and what it may do

One chat on every project, aware of which department you are in. The chat and the links between departments **propose**; a person **approves** where the proposal lands. Anything that leaves the system — an email, an invoice, a filing, money — needs a named approver. Internal alerts fire on their own.

## Links between departments

Live now: title and approvals feed the valuation's drivers and lender checks; approvals gate construction (work logged without a commencement certificate is flagged); progress feeds the as-is value and the cost to complete. Procurement ⇄ Finance, Legal ⇄ Design, Design ⇄ Construction, Construction ⇄ Commercial and Commercial ⇄ Finance arrive with their departments.

## Alerts

In the web app, the site app and by email: approvals expiring or lapsed, certified reports to revisit, work logged before it is allowed, late milestones, serious issues from site.

## The site app

A native app for Android and iOS, for site work only: the daily site log (manpower, work done, progress against milestones, weather), geo-tagged photos, issues and snags. It works with no signal and syncs when it can. It signs in by scanning a pairing code from the web app.

## Integrations

Read-only public lookups — the state revenue map and guidance values, RERA registration, land records — and file exports (PDF, Word, Excel). Nothing is written to government portals or banks.

## First release

Legal (title, approvals), Construction (progress, quality, site) and Finance (valuation), with three reports: title and approvals status, technical due diligence, and screening with an indicative value. The other departments are visible as "Coming soon" with what they will hold.
