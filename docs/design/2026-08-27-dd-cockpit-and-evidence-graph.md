# The DD cockpit and the evidence graph

Design for Realytica Diligence as an end-to-end due-diligence workspace:
eight domains, portals and automations per domain, chat as the command
surface, and one knowledge graph underneath everything — the FigJam
evidence-graph board turned into architecture.

## The layout: a three-pane cockpit, not a chat page

A Playground-style single chat pane is the wrong shape for this product:
checklists, accept/reject queues, RAG matrices and evidence viewers need
dedicated widgets, and a linear transcript buries them. But chat as a
walled-off tab is equally wrong: it cannot see what the analyst is looking
at. The synthesis:

- **Left — the engagement navigator.** The eight domains (Land, Legal,
  Approvals, Compliance, Technical, Financial, Project/Ops, Risk) plus
  Evidence and Report. Every row carries live badges — open blockers,
  unanswered checks, coverage % — the `viewState` pattern generalised. The
  navigator is the graph's own top level rendered as navigation.
- **Center — the canvas.** One surface at a time: a domain workboard, the
  evidence viewer (document/photo with extraction overlay), the graph
  explorer, or the report. Domain workboards all share ONE anatomy (below);
  they are driven by a domain registry, the way `ASSESSMENT_PROFILES`
  drives assessment — data, never eight bespoke pages.
- **Right — chat, always docked.** Never a tab. Chat and canvas share
  selection context in both directions: the node/finding/document selected
  on canvas is what chat means by "this"; any node chat cites renders as a
  chip that focuses the canvas on click.

**The law that makes chat "the main interface" safely — authorship, not
capability.** A user command issued through chat ("mark the soil report
received", "open compliance", "fetch the EC") executes directly: chat is
just an input method, and the actor is the person. A conclusion the model
itself authors (a finding, a fact, a mapping) is always a proposal a person
accepts — the same `source: 'user' | 'agent'` + review-state discipline the
technical findings already run on. Navigation, retrieval, portal fetches
and drafts are acting; anything that becomes case truth is asserting, and
model-asserted truth never lands without review.

## One domain workboard anatomy, repeated eight times

1. **Status strip** — coverage %, open flags by severity, costed exposure,
   staleness. Analytics live here, per domain, not on a separate page.
2. **Connectors & automations** — this domain's portals (Kaveri, Bhoomi,
   e-Khata, RERA, KSPCB, BESCOM, BWSSB, fire…) as fetch-or-manual-route
   cards (the `RecordFetchCard` pattern generalised into a per-domain
   connector registry), plus watchers: renewal expiry, staleness, new
   registration against the survey number.
3. **Evidence** — documents, photos and portal records mapped to this
   domain, and the gaps against its required list (the gap IS the RFI
   generator).
4. **Checks** — cross-checks with verdicts (clear / attention / blocker /
   unknown), each expandable to the facts it tested.
5. **Findings & risks** — the accept/reject queue plus the accepted list
   with severity, cost, owner, deviation flag.
6. **Actions / RFIs** — what to request, from whom, by when.

## The ontology: four layers over the existing title graph

`packages/shared/src/graph/` already has the three hardest properties:
a closed ontology with endpoint rules, deterministic merge keys, and
byte-identical rebuild from the case's own stores. The DD graph is that
engine extended, not a new system.

**Layer 1 — Entities (what exists).** Engagement, Parcel, Building, Zone,
Party, Authority, Instrument, Approval, AssetSystem. (Today's kinds plus
Zone and AssetSystem.)

**Layer 2 — Evidence (what we hold).** Document, Photo, PortalRecord,
SiteObservation, QuestionnaireAnswer. Every evidence node carries
provenance: who supplied it, when it was captured, its authority
(certified / primary / secondary copy), geotag where physical.

**Layer 3 — Claims (what the evidence says).** A Fact is
*(evidence) asserts (statement) about (entity)*, with confidence and an
as-of date. Two facts disagreeing about the same property produce a
**Contradiction node** — kept, surfaced, never silently resolved. (This is
`detectContradictions` today, promoted to the whole graph.)

**Layer 4 — Judgements (what we conclude).** Check tests facts; Finding is
produced by a check or an observation; Risk is driven by findings; Action /
RFI / Recommendation mitigates a risk. Every judgement node carries
mandatory `derivedFrom` edges downward — the board's own RISK-domain rule:
*every conclusion must trace back to evidence and check.*

**Closed edge vocabulary:** about, asserts, evidences, extracted_from,
located_in, issued_by, party_to, tests, produces, drives, mitigates,
contradicts, supersedes, depends_on, deviates_from. Endpoint-validated,
like today's edges. The board's cross-domain arrows become typed
`depends_on` edges: LAND risk → LEGAL check (title dependency), APPROVALS
check → TECHNICAL check (approved vs as-built), TECHNICAL finding →
FINANCIAL finding (cost impact), COMPLIANCE risk → RISK scoring
(regulatory severity).

**Laws:**
1. Closed vocabulary — no free-form node or edge types, ever.
2. No orphan claims — every Fact names its evidence and its entity.
3. Contradictions are first-class and permanent.
4. `derivedFrom` is mandatory on every judgement.
5. Supersede, never delete — staleness and history need time.
6. **The graph is a projection, not a second store.** Rebuilt
   deterministically from the case's stores on every run (exactly how
   `buildTitleGraph` works), with stable ids via `stableDigest` so
   citations survive rebuilds. This is what avoids sync hell.

## The graph as context, instead of feeding everything

- **Retrieval = subgraph extraction.** Resolve the entities a question
  mentions → expand k hops (weighting contradicts / produces / depends_on
  edges highest) → always include open blockers and contradictions touching
  the neighbourhood → serialise as compact triples with node ids.
- **Tools = graph queries.** `get_subgraph(entity, hops)`,
  `find_contradictions(domain)`, `trace(nodeId)` — the full derivation
  chain from any conclusion down to its evidence. The copilot's citation
  discipline extends from `[ev:id]` to any graph node id.
- **The report is a graph traversal.** Each section renders a domain's
  judgement nodes, each with its trace. Traceability by construction — the
  final report cannot contain a conclusion the graph cannot explain.

## Capture and mapping

- **Capture at the point of truth.** A site photo is taken against a Zone +
  AssetSystem (+ optional entity), geotagged and timestamped — it enters the
  graph already connected, not as a loose file to be sorted later.
- **Documents: classify → propose mappings → confirm.** One document feeds
  many domains (the board's coverage map: TCS list → Approvals, Technical,
  Compliance, Financial). Mapping proposals are agent-authored, so they go
  through the same accept step as everything else.
- **Gaps are first-class.** The required-list diff per domain drives RFI
  generation: what to ask for, from whom, evidenced by which absence.

## What stays exactly as it is

- Evidence-or-refuse, propose-then-accept, closed ontologies,
  provenance-first. These are the moat; every layer above assumes them.
- Property Screen keeps its five-group buyer-question layout. The cockpit
  is the Diligence surface — a second shell over the same engine, not a
  replacement for the screening product.
- The records adapter, staleness watch, and canvas component family are the
  seeds of connectors, watchers, and the graph explorer respectively.

## Build order

1. **Ontology extension** (`packages/shared/src/graph/`): evidence, claim
   and judgement layers; project the existing stores (documents, photos,
   checks, technical findings, risks) into the graph. Pure and testable
   before any UI moves.
2. **`trace()` + subgraph retrieval** + the copilot's graph tools.
3. **Shell**: docked chat with shared selection context.
4. **Domain registry + workboard anatomy** — start with Technical and
   Approvals, where the data already exists.
5. **Capture-time mapping** (photo → zone/system, document → domains).
6. **Connector + watcher registry** per domain.
7. **Report as graph traversal.**
