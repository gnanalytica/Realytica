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

## Setting each one up

Console wording drifts; what does not is the value you are looking for and
where it goes. Each step below ends with the variable it produces.

### 1-2. Vercel and Blob

The project is already on Vercel. For storage, open the project → **Storage** →
create or connect a **Blob** store. Connecting it writes the variables itself:
`BLOB_STORE_ID` for a private store, `BLOB_READ_WRITE_TOKEN` for a public one.
Set neither by hand. A private store authenticates per invocation with
`VERCEL_OIDC_TOKEN`, which the platform injects at runtime.

Prefer **private**. The bytes behind these URLs are somebody's title deed, and
a public blob URL is a permanently unauthenticated credential: whoever holds it
reads the file forever, with no session and nothing in an access log tying it
to a person.

### 3. OpenRouter — the model endpoint

1. Sign up at [openrouter.ai](https://openrouter.ai).
2. **Keys** → create a key. Copy it once; it is not shown again.
3. Optionally set a credit limit on the key while you are there — a spend cap
   is easier to set now than to wish for later.
4. Add credit only when you want paid models. Models with a `:free` suffix
   need none.

→ `REALYTICA_API_KEY`, plus `REALYTICA_BASE_URL=https://openrouter.ai/api`

Model names are OpenRouter's own (`anthropic/claude-haiku-4.5`,
`google/gemini-2.5-flash`), and go in the three `REALYTICA_MODEL_*` variables.
Check one before trusting a tier to it: `pnpm probe:model --model <name>`.

### 4. Neo4j Aura — the graph

1. Sign up at [console.neo4j.io](https://console.neo4j.io).
2. Create a **free instance**. It takes a couple of minutes to start.
3. **The password is shown once**, on creation, with a download button. Take
   the download. There is no way to retrieve it afterwards — only to reset it,
   which invalidates whatever you already deployed.
4. Copy the connection URI. It looks like
   `neo4j+s://xxxxxxxx.databases.neo4j.io` — the `+s` is TLS and the driver
   handles the scheme as given, so paste it whole.

→ `REALYTICA_NEO4J_URL`, `REALYTICA_NEO4J_USER` (`neo4j`), `REALYTICA_NEO4J_PASSWORD`

The app creates its own constraints and indexes on first boot. Nothing to
prepare in the console.

### 5. Google Maps — optional, and five APIs rather than one

A key alone is not enough: each API is enabled separately, and a disabled one
fails at the call rather than at setup. In
[console.cloud.google.com](https://console.cloud.google.com) → APIs & Services,
enable exactly these — they are what the code calls:

| API | Used for |
|---|---|
| **Geocoding API** | address → coordinate |
| **Street View Static API** | the site photo, and its metadata check |
| **Maps Static API** | the map image on the case |
| **Distance Matrix API** | travel time to amenities |
| **Places API (New)** | nearby amenities — `places.googleapis.com/v1`, which is a **different** enablement from the legacy Places API. Enabling the old one leaves this failing. |

Then Credentials → create an **API key**, and restrict it: HTTP referrer or IP
as fits your deployment, and **restrict it to the five APIs above**. An
unrestricted Maps key found in a bundle or a log is somebody else's billing.

→ `REALYTICA_GOOGLE_MAPS_API_KEY`

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
