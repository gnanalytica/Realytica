# Diagrams

Two standalone pages. Open either file directly in a browser — no build, no
server, no network beyond a webfont. Everything they need is inlined.

## `project-graph.html`

What one diligence file looks like once it is projected into the graph the
product stores: 503 nodes and 814 edges across the five layers, with the
closed vocabulary and a neighbourhood walker.

Built from a real run rather than drawn: `seedDemoProject()` → `screenProject()`
→ two chat turns → `buildProjectGraph()`, with the ontology taken from
`PROJECT_NODE_KINDS` / `PROJECT_EDGE_ENDPOINT_RULES`. So the node counts, the
title chain and the endpoint-rule table are what the code actually emits.

## `agent-architecture.html`

The agent wiring: twelve agents on three model tiers, the deterministic engine,
their tools, the external services they reach, and the path each kind of input
takes through them. Click a node for its tier, model, source file, tool list and
the system prompt it is actually sent.

Routes and tiers come from `allRoutes()` and `AGENT_TIERS`; the prompts come
from `BUILT_IN_PROMPTS`, except the two cockpit agents whose prompt is a
`const SYSTEM` in their own module — those are lifted from source, because
showing them the registry's prompt would be a lie about what is sent.

## These are snapshots, not live views

Both were generated at the commit that added them and are not rebuilt by
anything. Nothing fails if they drift; they just quietly stop being true, which
is the usual fate of a checked-in diagram. Treat a change to the ontology, the
agent tiers or the prompt registry as a reason to regenerate rather than
assuming the page followed along.
