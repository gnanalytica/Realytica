# Querying the reasoning graph from Claude

`.mcp.json` at the repo root wires the [Neo4j MCP server](https://neo4j.com/docs/mcp/current/quickstart/)
to the same graph the app writes. It is **project scope**: committed, so it
works for anyone who clones this repo, and Claude Code asks each person to
approve it the first time.

## What it gets you

Four tools — `get-schema`, `read-cypher`, `write-cypher` (disabled by default,
see below) and `list-gds-procedures` — against the graph store. That means
questions the app has no screen for:

```cypher
// Which projects carry an unconverted-land finding?
MATCH (n:Ryt:finding) WHERE toLower(n.label) CONTAINS 'conversion'
RETURN n.projectId, n.label

// What does a conclusion rest on, two hops out?
MATCH (n:Ryt { id: $nodeId })-[:RYT_EDGE*1..2]-(m:Ryt) RETURN DISTINCT m.kind, m.label

// Everything a person wrote, which exists nowhere else
MATCH (n:Ryt:authored) RETURN n.projectId, n.label

// The chain of title on one file, oldest instrument first
MATCH (i:Ryt:instrument { projectId: $projectId })-[:RYT_EDGE { kind: 'affects' }]->(p:Ryt:parcel)
RETURN p.label, i.label, i.detail ORDER BY i.detail

// What did this file's graph say in March, before the last screen moved it?
MATCH (:Ryt { projectId: $projectId })-[r:RYT_EDGE]->(m:Ryt)
WHERE r.closedAt IS NULL OR r.closedAt > '2026-03-31'
RETURN r.kind, m.kind, m.label
```

One node label family: `:Ryt`, the project graph. Every node also carries a
label for its **kind** (`:parcel`, `:check`, `:finding` …), its **layer**
(`:entity`, `:evidence`, `:claim`, `:judgement`, `:deliberation`) and its
**origin** (`:derived`, `:authored`), so those three filters need no property
read. Relationships are all `:RYT_EDGE` with the semantic relation on
`r.kind`, and a relation the registers no longer assert carries `r.closedAt`
rather than being deleted — so the default is `r.closedAt IS NULL` unless you
are deliberately asking about the past.

## Setup

```bash
pip install neo4j-mcp-server        # Python ≥3.10
docker compose up -d neo4j          # the graph itself
```

Then point the API at Neo4j so there is something to query — **without these
the app uses the append-only journal beside the case store and the database
stays empty**:

```bash
export REALYTICA_NEO4J_URL=bolt://localhost:7687
export REALYTICA_NEO4J_USER=neo4j
export REALYTICA_NEO4J_PASSWORD=realytica-dev
pnpm dev
```

`GET /api/health` reports `"graph": "neo4j"` when it took. If it says
`"journal"`, the MCP server will connect to an empty database and every query
will honestly return nothing.

The config reads the same `REALYTICA_NEO4J_*` variables the app does, with the
`docker-compose.yml` development credentials as defaults, so a local setup
needs no extra environment and a real deployment needs no edit to this file.

## Why it is read-only by default

`NEO4J_READ_ONLY` defaults to `true`, and that is a product decision rather
than caution.

The graph is an **index** over data that lives elsewhere — with one exception.
`derived` nodes are a projection of the project registers and a rebuild
replaces them, so a stray write is overwritten and merely confusing. But
`authored` nodes are the analyst annotations written through
`POST /api/projects/:id/graph/annotations`, they are held **nowhere else**,
and the sync path is written specifically so a rebuild can never delete one.
A `write-cypher` call does not go through that path. One `DETACH DELETE` from
a chat window would destroy the only copy of somebody's reasoning, silently,
with no audit event — the app's own audit trail would never see it, because
the app was not involved.

They are separable in Cypher without reading properties, which is what makes
the danger easy to see before you act on it:

```cypher
MATCH (n:Ryt:authored) RETURN n          // the irreplaceable half
MATCH (n:Ryt:parcel)   RETURN n          // one node kind
MATCH (n:Ryt:entity)   RETURN n          // one layer
```

So: read-only unless you deliberately lift it for a migration you are
supervising.

```bash
REALYTICA_NEO4J_MCP_READ_ONLY=false claude   # you are now the safety
```

## When it does not start

The server **verifies connectivity at startup and exits** if Neo4j is not
reachable — it does not sit and retry. Claude Code then shows the server as
failed, which is the correct signal but an opaque one, so the two causes:

```
level=ERROR msg="Server error" error="impossible to verify connectivity … connection refused"
```

means Neo4j is not running (`docker compose up -d neo4j`), and an
authentication error means the password does not match the one in
`docker-compose.yml` (`realytica-dev`) or your deployment's.

Run it by hand to see the reason, which Claude Code will not show you:

```bash
NEO4J_URI=bolt://localhost:7687 NEO4J_USERNAME=neo4j NEO4J_PASSWORD=realytica-dev \
  python -m neo4j_mcp_server
```

## Notes

- Neo4j's own docs show the config under a `servers` key. That is VS Code's
  format; Claude Code and Claude Desktop use `mcpServers`, which is what this
  file uses.
- Claude Desktop does not read `.mcp.json`. Copy the inner `neo4j` block into
  `claude_desktop_config.json` under `mcpServers` and substitute the values —
  Desktop does not expand `${VAR}`.
- Aura instead of self-hosted is `{"type":"http","url":"https://<instance-id>.mcp-instances.neo4j.io"}`.
- The remote Claude Code sessions this repo uses run in throwaway containers
  with no Neo4j and no port to reach yours, so this is a local-machine setup.
