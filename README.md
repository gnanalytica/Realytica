# Realytica — Property Intelligence

> Understand a property **before** you commit money, professional effort, financing or acquisition
> resources.

Realytica is an AI-powered property intelligence platform. This repository contains the MVP release —
**Realytica Property Screen** — as a local-first, installable `pnpm` application. It answers one
question end to end: *should I pursue this property?*

The product definition this build implements is transcribed in
[`docs/SOURCE_SPEC.md`](docs/SOURCE_SPEC.md).

---

## Quick start

```bash
pnpm install
pnpm dev
```

Then open **http://localhost:5173**.

`pnpm dev` runs both processes:

| Process | Port | What it is |
| --- | --- | --- |
| `@realytica/web` | 5173 | Vite + React UI |
| `@realytica/api` | 5174 | Express API, JSON-file store, screening engine |

The API auto-seeds six demo cases (four Bengaluru, two Amsterdam) on first boot, so the app is
populated the moment it opens. Wipe them from **About → Reset demo data**.

**Requirements:** Node 20.10+ and pnpm 10+. Nothing else — no database, no cloud account, no API key.
Everything runs on your machine and all state lives in `apps/api/data/`.

### Deploying it for someone to try

**On one server.** The API serves the built web app from the same process, so
this is one service on one port — no second host, no CORS setup:

```bash
pnpm install && pnpm build && pnpm start   # http://localhost:5174
```

Attach a persistent disk and point `REALYTICA_DATA_DIR` at it, and that is a
complete deployment.

**On Vercel.** `vercel.json` builds the repo root. Push it, and you get the web
build on the CDN and the whole Express API as one function.

Serverless has no writable disk, so persistence goes through a
`StorageAdapter` (`apps/api/src/storage/`) instead. Attach a Vercel Blob store
— that sets `BLOB_READ_WRITE_TOKEN`, which is what selects the Blob adapter —
and cases, screens and uploaded documents survive. **Without it the app still
runs**, on temporary storage that is wiped between instances: fine for a look
at the demo cases, not fine for a trial where someone enters real work.

The deployment is assembled by `scripts/build-vercel-output.mjs` rather than by
Vercel's `api/` directory convention. That file explains why; the short version
is that this codebase is written for a bundler and Vercel does not bundle
function sources.

**Environment variables**, all optional — the screening engine is deterministic
and needs none of them:

| Variable | Effect |
| --- | --- |
| `BLOB_READ_WRITE_TOKEN` | Set automatically by attaching a Vercel Blob store. Switches storage from the filesystem to Blob, which is what makes a serverless deployment durable. |
| `ANTHROPIC_API_KEY` | Turns on the agent layer. Without it every agent route answers `503 no_credentials` and the rest of the app is unaffected. |
| `REALYTICA_AGENT_WEB_SEARCH=1` | Lets the research and explorer agents reach the public web. Off by default: enabling it is a permission, and only external-safe case context is ever sent. |
| `REALYTICA_DATA_DIR` | Filesystem adapter only. Where the JSON store and uploaded documents live. |

Every `REALYTICA_*` variable in this README is also read under the older
`VALYTICA_*` prefix the product shipped with, so an existing deployment keeps
working untouched. `REALYTICA_*` wins where both are set. The same applies to
persisted state: the store file is now `realytica.json` and browser
preferences use a `realytica.` prefix, with the previous names read as a
fallback so no case data and no saved preference is orphaned by the rename.

### Other commands

```bash
pnpm dev:web      # UI only (expects the API on 5174)
pnpm dev:api      # API only
pnpm build        # production build of the web app
pnpm start        # serve the production build alongside the API
pnpm typecheck    # strict typecheck across the whole workspace
pnpm clean        # remove node_modules and build output
```

**Evaluating a route before you tier it:**

```bash
pnpm eval --routes anthropic:claude-haiku-4-5-20251001,anthropic:claude-sonnet-5 --dry-run
pnpm eval --routes openai_compatible:llama-3.3-70b --task document_extraction
```

Runs the 43-case corpus against one or more routes and ranks them. `--dry-run`
reports the corpus, what each task stands in for, and how many model calls a
real run would make, without spending anything — use it first, because a sweep
costs routes x cases.

It is a CLI rather than a page for that reason. The ranking gates on
fabrication rather than weighting it: a route that invents a value the source
does not contain ranks below every clean route regardless of price, because
that is the one failure this product cannot ship. Evaluations run against the
shipped grounding preamble, so editing it in **Prompts** and re-running is the
way to check those rules are doing anything.

---

## What Property Screen does

Create a property case, upload whatever documents you have, and run a screen. Realytica produces:

- **A property snapshot** — what this property is, in a paragraph.
- **An indicative value range** — a low/mid/high band, never a single fake-precise number, blended
  from **multiple independent anchors**: comparable sales, statutory reference (circle rate in
  India, WOZ in the Netherlands), income capitalisation, depreciated replacement cost, an adjusted
  asking price, and an index trend. Each anchor carries its own range, weight, confidence and
  written rationale, so you can see where the methods disagree.
- **Market comparables** with the adjustments applied to each one shown line by line.
- **Value drivers** — what is pushing this property above or below the locality median, and by how
  much, with the reasoning attached.
- **Material risk flags** — title, planning, structural, financial, market, tenancy, environmental
  and data risks, each with an impact and a mitigation, and a status you can move to
  *mitigated* or *accepted*.
- **Planning position** — zoning, permitted uses, FAR used against FAR allowed, and the buildable
  headroom that remains.
- **Document completeness** — what the country pack expects, what you have, and what is missing.
- **A confidence score** with the factor-by-factor arithmetic that produced it, and a statement of
  the single change that would raise it most.
- **An evidence ledger** — every figure in the app traces back to a document, an external dataset, a
  comparable, your own input, or an explicitly-labelled model inference.
- **Recommended actions** grouped into *now*, *before offer* and *before completion*.
- **A Property Screen report** — the whole thing as one print-ready document.

You can also **compare 2–4 cases** side by side.

## What it explicitly does not do

Straight from the product definition, and enforced in the UI copy: this is **not** a certified
valuation, a legal title certificate, a formal legal opinion, an engineering inspection, a lending
approval, a formal mortgage valuation, a full project feasibility, or an automated purchase
recommendation without explanation.

---

## Product principles, and where you can see them

| Principle | Where it shows up |
| --- | --- |
| **Evidence Before Assertion** | Every number carries an evidence chip that opens the ledger entry behind it |
| **Range Before False Precision** | Values are bands; the range widens visibly when confidence is low |
| **Explain the Why** | Anchors, drivers, risks and the verdict all carry written rationale |
| **Uncertainty Must Be Visible** | Confidence scores, spread percentages, low-confidence extraction flags, and a "what we could not verify" panel on the snapshot |
| **Drive Action** | Every screen ends in a prioritised, owned, checkable action list |

---

## Architecture

```
realytica/
├── apps/
│   ├── api/                 @realytica/api  — Express + JSON-file store
│   │   ├── src/routes/      cases · documents · screen · reference · demo
│   │   └── data/            your local state (gitignored)
│   └── web/                 @realytica/web  — Vite + React + Tailwind
│       └── src/
│           ├── components/  UI kit, layout, hand-written SVG charts
│           ├── lib/         API client, formatters, theme tokens
│           └── pages/       dashboard · new case · case workspace · compare · about
├── packages/
│   ├── agents/              @realytica/agents — the agentic layer (optional)
│   │   └── src/
│   │       ├── agents/      document intelligence · proof pathways · copilot
│   │       │                market research · diligence planner
│   │       ├── knowledge/   Karnataka proof-route corpus
│   │       └── orchestrator.ts
│   └── shared/              @realytica/shared — domain contract + screening engine
│       └── src/
│           ├── types.ts     the frozen domain model both apps build against
│           ├── engine.ts    classification, extraction, valuation, scoring
│           └── reference.ts country packs and locality market data
└── docs/SOURCE_SPEC.md      the transcribed product definition
```

**Global Core + Country Pack**, with per-locality market data. The core engine is
country-agnostic; India and the Netherlands each supply a country pack (currency, parcel identifier,
expected documents, statutory rate basis, transaction taxes, registry names), and each locality
supplies market data (median price per m², statutory rate, yield, liquidity, zoning, FAR,
replacement cost, an eight-quarter trend).

### The Karnataka / Bengaluru State Pack

All three tiers of the specified architecture are implemented — Global Core, Country Pack and
**State / Municipality Pack**. Karnataka is the first state pack, and it is where a Bengaluru title
screen actually lives:

| What | Karnataka pack |
| --- | --- |
| Statutory value | **Guidance value** (Kaveri Online Services) — not "circle rate" |
| Property register | **Khata (BBMP)**, with the A / B / e-khata distinction as a first-class field |
| Transaction tax | Banded stamp duty, cess and surcharge computed **on the duty**, registration fee on value — charged on the **higher of consideration and guidance value** |
| Title checks | Khata classification · e-khata issuance · DC land conversion (KLR Act s.95) · PTCL Act 1978 granted land · rajakaluve and lake buffers · occupancy certificate · 30-year EC continuity · K-RERA · BDA/BMRDA acquisition · quoted area basis |
| Documents | 14 Bengaluru-specific documents, weighted so the five title-chain deal-breakers dominate completeness |

The **Compliance** tab surfaces these as pass/attention/blocker findings, each with its statute, the
commercial consequence, and the next step. Blockers — a B-khata classification, unconverted
agricultural land — render above everything and cannot be filtered out of view, because they are the
findings that should stop someone before they spend money on lawyers.

Areas display in **square feet** and rates in **₹/sq ft** for Indian cases, with a toggle. The domain
model stores square metres throughout; a Dutch case keeps m² and €/m².

### Starting a case: the conversation

**Start a case** in the sidebar is a chat. It asks where the property is,
what it is, and roughly how big — and on the third answer puts a real
indicative range, a verdict and the list of documents that decide the rest in
front of you. Everything after that sharpens the answer rather than gating it.

That is not a shortcut. It is what the screening engine actually needs: with a
locality, a property type and an area it returns a range, six risks,
twenty-one evidence items and the critical-document list. The form at **New
case (form)** demands six required fields first, three of which (address,
postal code, survey number) the engine does not read at that stage. Both are
in the nav; the form is still there for anyone who would rather fill one in.

The draft sits beside the conversation at all times, and every particular
shows where it came from. Something you said is marked as such. Something the
concierge worked out is tinted, labelled **Inferred**, carries the basis it was
derived from, says plainly that it is counting toward the numbers above, and
offers *That's right* and *No* side by side. Anything still inferred when you
build is written onto the case notes by name, because an inference nobody can
see is a fact to whoever reads the case next week.

**The concierge decides very little.** What to ask next, which documents bear
on this property and whether the draft can be screened are computed from the
field table, the Karnataka playbooks and the engine before the model is called,
and handed to it as state it may not contradict. Document requests come from
the playbook steps whose `needs` name them, so each one traces to a real
procedure and the sentence explaining what it settles is that step's own. The
model's job is language: reading what you wrote into typed particulars, and
asking the next question like a person would.

It is forbidden from inferring a khata type, jurisdiction, land-conversion
status or survey number — those are matters of record and the exact things the
product exists to check. And because the deciding half is deterministic, none
of this depends on the model obeying: a guess it makes anyway is captured as an
inference you must confirm, never as fact.

With no credentials configured the conversation still works. It cannot read
free text, so it answers the question it just asked — buttons for a choice, a
typed answer for anything else, with Indian quantities understood (`1200 sqft`,
`30x40`, `85L`, `1.15 cr`). It says so in as many words rather than implying a
model is present.

Nothing is created until you press build. Opening the page, typing, and leaving
creates nothing to clean up.

### Agentic layer (optional)

Ten agents sit on top of the deterministic screen. **They are an addition, not a
dependency** — with no credentials configured the app behaves exactly as it does
today, and the Intelligence tab explains what is missing rather than breaking.

```bash
export ANTHROPIC_API_KEY=sk-ant-...     # or: ant auth login
export REALYTICA_AGENT_WEB_SEARCH=1      # optional; enables the research agent
pnpm dev
```

| Agent | What it does |
| --- | --- |
| **Document intelligence** | Reads the actual uploaded PDF and extracts typed fields with **page citations**, replacing the simulated OCR. Contradictions with what you entered are reported, not smoothed over. |
| **Proof pathways** | For every gap the engine finds, works out *every* route to closing it — portal, office, intermediary, seller, or reconstruct-from-secondary — costed, timed and sequenced, with what can go wrong. |
| **Analyst copilot** | Grounded Q&A over the case. Cites evidence ids, and says "the documents on file do not answer this" rather than guessing. |
| **Market research** | Web search for local transaction and infrastructure signal. Off by default. |
| **Diligence planner** | Ranks insights and drafts the actual document-request messages for a human to send. |
| **Critic** | Adversarially checks the run against the Karnataka corpus — what was asserted without support, what contradicts the documents. |
| **Explorer** | Follows open-ended leads under a hard iteration and cost ceiling, recording what it chose to pursue and what came of it. |
| **Title graph** | Reduces the ownership chain to findings: breaks, contradictions, and who actually holds what. |
| **Planner** | Reads the case and decides which of the above it warrants and at what depth, rather than running everything every time. |
| **Orchestrator** | Sequences the rest and enforces their data dependencies; one agent failing does not sink the run. |

**The roster is tiered.** Not every agent needs the same model, and running
all of them on a frontier model makes cost-per-case — not accuracy — the
variable that decides what this can be priced at. Extraction and
classification are mechanical; judgment, adversarial checking and title-chain
reasoning are not. Measured on a representative run, tiering cuts the bill
about 66%.

| Tier | Default model | Agents |
| --- | --- | --- |
| `extraction` | `claude-haiku-4-5-20251001` | Document intelligence |
| `reasoning` | `claude-sonnet-5` | Planner, proof pathways, market research, diligence planner, explorer, orchestrator |
| `judgment` | `claude-opus-5` | Critic, analyst copilot, title graph |

Configuration:

| Variable | Effect |
| --- | --- |
| `REALYTICA_MODEL_EXTRACTION` / `_REASONING` / `_JUDGMENT` | Route one tier. Accepts `model` or `provider:model`. |
| `REALYTICA_TIER_<AGENT>` | Move one agent between tiers, e.g. `REALYTICA_TIER_DOCUMENT_INTELLIGENCE=judgment` for a deployment whose scans are poor. |
| `REALYTICA_ROUTE_<AGENT>` | Route one agent, overriding everything else. |
| `REALYTICA_AGENT_MODEL` | Collapses every tier onto one route. What you reach for to pin the roster during an incident. |
| `REALYTICA_AGENTS_DISABLED=1` | Turn the agent layer off entirely. |

**Providers are not locked in.** A route is written `provider:model`, or bare
`model` for Anthropic — so every existing configuration keeps working and keeps
meaning what it meant:

```bash
REALYTICA_MODEL_REASONING=openai_compatible:meta-llama/llama-3.3-70b-instruct
REALYTICA_ROUTE_DOCUMENT_INTELLIGENCE=anthropic:claude-haiku-4-5-20251001
REALYTICA_OPENAI_BASE_URL=https://openrouter.ai/api/v1   # or a self-hosted LiteLLM
REALYTICA_OPENAI_API_KEY=...
```

Precedence, most specific first: `REALYTICA_ROUTE_<AGENT>` → `REALYTICA_AGENT_MODEL`
→ `REALYTICA_MODEL_<TIER>` → the built-in default. Every route records where its
decision came from, because a surprising route is otherwise an archaeology
exercise across four variables, and the one time that matters is during an
incident.

**The abstraction declares capabilities rather than flattening to what every
provider shares.** That distinction is the whole design. Anthropic's
server-verified document citations are what separate *"the khata number is on
page 3, checked"* from a model asserting a page it may have invented — a
lowest-common-denominator port would quietly cost this product its grounding.
So a provider states what it can do, a call that wanted something unavailable
degrades explicitly, and the gap travels into the evidence and the telemetry.
Losing a feature is allowed; losing it silently is not. **Model ops** in the
sidebar shows every route, what it degrades, and which degradations change the
meaning of a result rather than only its cost.

Every run records the model and tier it actually used, and `CaseIntelligence.cost`
carries the per-agent breakdown alongside what the same tokens would have cost
on the judgment model — so the saving is a measurement, not a claim.

**Three boundaries are enforced in code, not just prompted:**

- **The engine stays the arithmetic authority.** Agents supply inputs and
  narrative; they never overwrite a computed valuation. A model that is wrong
  can contradict or widen the evidence, but cannot silently move the number you
  act on.
- **Model output is labelled.** Everything an agent infers enters the evidence
  ledger as `model_inference`, visibly distinct from a documented fact.
  Extracted document fields are the exception — they carry real page citations,
  so they enter as `document` evidence with a genuine source.
- **Only one agent talks to the outside world, and it gets a stripped context.**
  Market research receives locality and market terms only; the address, owner,
  price and document contents never leave your machine.

Runs report their real token usage and an estimated cost, so a run is never a
surprise on the bill.

**Every prompt is versioned, and editing one is visible.** The nine prompts the
agents run live in a registry rather than inline in the agent files, each with
its shipped text as version 1. **Prompts** in the sidebar shows them, what
guardrails each version keeps, and what a draft would give up.

Editing is allowed, because an operator who cannot fix a preamble will work
around the tool instead — where nothing is recorded at all. What is not
negotiable is that a change is visible. The shared preamble is not stylistic:
it is the text that says *never invent a document, a transaction, a statute, a
case number, a date or a figure*, and an invented survey number is the one
failure this product cannot ship. So a version that drops a guardrail is
accepted, carries the failed checks, and marks every run that used it. Saving
or activating such a version needs a per-guardrail acknowledgement and the
guardrail's id typed out — never a generic "are you sure". The built-in version
can never be edited or deleted, so there is always a way back.

The guardrail checker is phrase matching within a proximity window, and its
source says plainly what that buys: about one faithful rewrite in six to ten is
flagged as a drop, and it cannot see negation. A satisfied invariant is weak
evidence; an unsatisfied one is a strong prompt to read the diff. The thing
that actually stops a fabricated figure reaching a user is the output-side
evaluation gate, not this.

Every run records the prompt versions it used and their content hashes, so
*"the extraction got worse last Tuesday"* stays answerable after somebody edits
a prompt.

| Variable | Effect |
| --- | --- |
| `REALYTICA_PROMPT_<KEY>` | Pin one prompt to a version id or number, overriding the stored selection. E.g. `REALYTICA_PROMPT_CRITIC_SYSTEM=1` to force the shipped text. |

**The run graph draws what actually happened.** The **Run graph** tab on a case
is a pannable, zoomable canvas of one orchestration: lanes are the schedule the
orchestrator really used rather than the plan's nominal ordering, edges
distinguish "ran after" from "consumed the output of" from "re-ran something
upstream", and the feedback loop that re-runs the deterministic screen after
document intelligence changes a field is drawn as the loop it is. Clicking a
node gives its model, route, duration, cost, steps, outputs, capability gaps
and the prompt versions it ran under — and links to the exact prompt version,
so a suspicious answer is one click from the text that produced it.

The graph is derived on read rather than stored, so it can never disagree with
the runs it describes. Nodes carry no cost when their route has no declared
rates; a total that excludes one reads `≥` with the shortfall named, because a
lower bound presented as a total is the same lie as pricing an unknown route at
zero.

### Statutory values are versioned, not asserted

Guidance values, stamp-duty slabs and buffer distances change by circular, notification and court
order. Every statutory value in a state pack is a `StatutoryRule` carrying an `asOf` date, its source
instrument, and a verify-before-relying note, all shown in the UI beside the numbers they drive.

**Treat the shipped figures as placeholders to confirm against current circulars.** The rajakaluve
and lake buffer distances especially: the applicable setback depends on how BBMP/BDA classify that
specific drain and has been revised repeatedly by NGT orders, so the app tells you to commission a
survey rather than asserting a distance.

### Coverage

| Country | Covered | Why it is bounded |
| --- | --- | --- |
| India | **Karnataka (Bengaluru)** | Stamp duty, registration fees and the property-register instrument are set at *state* level. A Khata extract is a Karnataka instrument; Telangana or Maharashtra would expect a different document entirely. |
| Netherlands | Noord-Holland, Utrecht, Zuid-Holland | Dutch conveyancing instruments (Kadaster, WOZ, energielabel) are national, so only market-data reach is limited — not the rules. |

A case entered outside a covered state still screens, but raises a material risk saying the document
checklist, statutory anchor and transaction costs are not that state's — rather than silently
measuring the property against the wrong rules.

The screening engine is **deterministic** — seeded by case id, no wall-clock or random input inside
scoring — so the same case always produces the same result and a re-run is diffable. Document
classification and field extraction are simulated locally against filename and document-kind
patterns; there is no external model call and nothing leaves your machine.

### Adding a market

Add a `CountryPack` and its `LocalityReference` entries in `packages/shared/src/reference.ts`, and a
`StatePack` under `packages/shared/src/packs/` where the state sets its own rules. The
engine, the API and every screen pick it up without further change — that is what the pack
architecture buys.

---

## Roadmap (from the product definition)

| Phase | Scope |
| --- | --- |
| 1 — MVP | India, one state/metro, one property type, professional users first |
| 2 | Second property type and geography, comparison, collaboration, deeper diligence, professional review, more data integrations |
| 3 | Netherlands Country Pack |
| 4 | Realytica Project Intelligence |
| 5 | Realytica Portfolio Intelligence |

The product family beyond Property Screen: **Diligence** (*what exactly am I getting into?*),
**Project Intelligence** (*does this opportunity make commercial sense?*) and **Portfolio
Intelligence** (*where are the risks and opportunities across our properties?*).

---

## Note on the data in this build

The reference market data, comparable transactions and document extraction in this MVP are
**realistic but synthetic** — calibrated to plausible magnitudes for each locality so the product
can be evaluated end to end, not sourced from live registries. Wiring the country packs to real
feeds (IGR/RERA/municipal rolls in India; Kadaster/BAG/CBS in the Netherlands) is Phase 2 work.
Nothing in the UI presents synthetic data as a verified fact: every figure carries its source type
in the evidence ledger.
