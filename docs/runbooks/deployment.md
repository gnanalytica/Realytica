# Deploying Realytica

Every variable named here is one the code actually reads — collected by
grepping for it, not from memory. Nothing is required except a model key:
the screening engine is deterministic and runs with no accounts at all.

## Accounts to create

| # | Account | What it buys | Free tier |
|---|---|---|---|
| 1 | **Vercel** | Hosting. You have this. | Hobby |
| 2 | **Vercel Blob** | Durable case store and uploaded documents. **Required in production** — without it every cold start reports an empty database and re-seeds the demo. | included |
| 3 | **OpenRouter** | Every model, one key, Anthropic wire format. | yes, plus `:free` models |
| 4 | **Neo4j Aura** | The reasoning graph. **Required in production** — the app refuses to boot without it. | yes, pauses after 72h idle |
| 5 | **Google Maps Platform** | Geocoding, Street View, nearby amenities. Optional: without it the site context reports named gaps rather than empty results. | monthly credit |

Skip the statutory-records vendor. `REALYTICA_RECORDS_*` fronts an aggregator
this deployment does not have, and configuring it half-way is worse than not
at all — `_KINDS` is deliberately not defaulted, because a provider claiming a
record kind it cannot deliver manufactures a failed fetch where an honest one
would name the manual route.

## Where each value goes

**Vercel → Project → Settings → Environment Variables**, ticked for
**Production and Preview**. Locally, the same names in your shell or a
`.env.local` you never commit.

```bash
# 3. OpenRouter — the only variable the agent layer actually needs
REALYTICA_BASE_URL=https://openrouter.ai/api
REALYTICA_API_KEY=sk-or-v1-...

# Which model each tier runs. Names are OpenRouter's own.
REALYTICA_MODEL_EXTRACTION=anthropic/claude-haiku-4.5
REALYTICA_MODEL_REASONING=google/gemini-2.5-flash
REALYTICA_MODEL_JUDGMENT=anthropic/claude-sonnet-4.5

# 4. Neo4j Aura, if you want the graph to persist across instances
REALYTICA_NEO4J_URL=neo4j+s://xxxxx.databases.neo4j.io
REALYTICA_NEO4J_USER=neo4j
REALYTICA_NEO4J_PASSWORD=...

# 5. Google Maps, if you want site context
REALYTICA_GOOGLE_MAPS_API_KEY=...

# Optional switches
REALYTICA_AGENT_WEB_SEARCH=1     # lets research and explorer reach the web
REALYTICA_AGENTS_DISABLED=1      # turns the agent layer off entirely
```

**Vercel Blob sets its own variables.** Connect the store in the dashboard and
it writes `BLOB_STORE_ID` (private store) or `BLOB_READ_WRITE_TOKEN` (public).
A private store authenticates per invocation with `VERCEL_OIDC_TOKEN`, which
the platform injects — do not try to set either by hand.

To run against Anthropic directly instead of OpenRouter, drop
`REALYTICA_BASE_URL` and make `REALYTICA_API_KEY` an Anthropic key. Nothing
else changes.

## Which store owns what

Three stores, and they are not alternatives — each holds something the others
structurally cannot.

| Store | Holds | Why not one of the others |
|---|---|---|
| **Vercel Blob** | the document BYTES — the scanned deed, the site photo | a graph database is not a file store |
| **Case store** (JSON, in Blob) | the record: what was uploaded, extracted, screened, concluded | a nested aggregate read whole; the graph is a projection OF this, so it cannot also be derived from it |
| **Neo4j** | the reasoning graph: relationships, traversal, and the annotations | the only store that answers "what is connected to what" and "what did we believe in March" |

So Blob does not compete with Neo4j. It holds the files, and the record the
graph is built from.

**Neo4j is required in production, and the app enforces it.** On a serverless
host the journal adapter writes to `/tmp`, which does not survive a cold start.
An annotation written there would be accepted, reported as saved, and lost —
the worst outcome available. So a deployment with `VERCEL=1` and no
`REALYTICA_NEO4J_URL` refuses to boot and names the variables to set. A deploy
that fails loudly is fixed in a minute; one that loses notes quietly is found
weeks later by the person whose notes are gone.

Configured but *unreachable* is treated completely differently: the app keeps
serving, because the deterministic screen is the product's floor and a graph
outage must not stop a valuer creating a case. Writes fail and are logged, the
derived half rebuilds when the store returns, and annotations attempted during
the outage are refused with a 503 rather than accepted.

Locally the journal is the default and needs no account.

## Verify after deploying

```bash
curl https://<your-app>/api/agents/capability
```

`available: true` means the model endpoint answered. The boot log names both
adapters — `[storage] using the …` and `[graph] using the …` — and a graph
store configured but unreachable says so rather than failing silently.

```bash
pnpm probe:model --model anthropic/claude-haiku-4.5
```

Sends a real one-page PDF through the configured endpoint and reports, as
three separate verdicts, whether the document reached the model, whether
citations came back, and whether they were verified. Run it after pointing a
tier at a new model — the three fail independently, and the middle one failing
quietly is the expensive case.
