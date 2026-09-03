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

**Free models can read a document.** Measured against a live key: OpenRouter
extracts a PDF server-side before dispatch, so `minimax/minimax-m3:free`
answered with the value planted in a one-page deed even though it advertises
no file input. What free models do NOT return is a verified citation — the
per-call gap catches that and the page reference becomes the model's own word.
They also share an upstream rate-limit pool, so a run can 429 or hit a
"provider overloaded" from the vendor behind them. Fine for evaluating the
product; not what a signed report should rest on.

### 4. Neo4j Aura — the graph

1. Sign up at [console.neo4j.io](https://console.neo4j.io).
2. Create a **free instance**. It takes a couple of minutes to start.
3. **The password is shown once**, on creation, with a download button. Take
   the download. There is no way to retrieve it afterwards — only to reset it,
   which invalidates whatever you already deployed.
4. Copy the connection URI. It looks like
   `neo4j+s://xxxxxxxx.databases.neo4j.io` — the `+s` is TLS and the driver
   handles the scheme as given, so paste it whole.

**Use the downloaded file rather than assuming the values.** On a free
instance Aura does not use `neo4j` for either the username or the database —
both are the instance id, e.g. `c24f4a74`. A session opened without naming the
database runs against whatever the server calls default, which is not
necessarily the one the credentials describe, and that fails quietly: the write
either errors naming a database nobody set, or succeeds somewhere nobody looks.

→ `REALYTICA_NEO4J_URL`, `REALYTICA_NEO4J_USER`, `REALYTICA_NEO4J_PASSWORD`,
`REALYTICA_NEO4J_DATABASE`

`REALYTICA_NEO4J_DATABASE` may be left unset when the credentials say `neo4j`;
set it to whatever `NEO4J_DATABASE` in the file says otherwise.

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

Then Credentials → create an **API key**, and set **Application restriction:
None**, **API restriction: the five APIs above**.

That first setting looks wrong and is not. Every Maps call in this app is made
by the API function, not the browser — `site-context.ts` proxies Street View
and static-map imagery through our own route precisely so the key is never
published to a page. A server request carries no `Referer`, so an
**HTTP-referrer-restricted key fails every one of them**, and it does so in
two different voices depending on the endpoint: Geocoding and Distance Matrix
answer `REQUEST_DENIED — API keys with referer restrictions cannot be used
with this API`, while Places (New) answers `403
API_KEY_HTTP_REFERRER_BLOCKED`. Neither sentence appears in the site-context
UI, which simply reports the amenity gaps as unknown.

IP restriction is the theoretically better answer and is not available here:
Vercel functions egress from a shared pool with no stable address to list.

So the API restriction is the whole of the protection, and it is worth
getting exact — a key restricted to these five buys an attacker geocoding,
not the rest of the project. Keep it out of the web bundle (it is only ever
read server-side, and the `REALYTICA_` prefix is not exposed to Vite), and
rotate it if it reaches a log.

A key that already carries a referrer restriction cannot be repaired by
adding APIs to it; change the application restriction to None, or mint a
second key for the server and leave the first to whatever browser code
needs it.

→ `REALYTICA_GOOGLE_MAPS_API_KEY`

## Where each value goes

**Vercel → Project → Settings → Environment Variables**, ticked for
**Production and Preview**. Locally, the same names in your shell or a
`.env.local` you never commit.

### Two that are not optional

Everything above is a capability you can decline. These two are not, and the
app enforces both by refusing to boot rather than by degrading — a deployment
serving every project to anybody who finds the URL is the failure this prevents,
and it is not one you notice from the outside.

```bash
# Who may sign in. See docs/auth.md — five minutes for an OAuth client.
REALYTICA_AUTH_MODE=google
REALYTICA_AUTH_CLIENT_ID=1234-abc.apps.googleusercontent.com
VITE_GOOGLE_CLIENT_ID=1234-abc.apps.googleusercontent.com   # build-time, same id
REALYTICA_AUTH_BOOTSTRAP_EMAILS=you@yourfirm.in             # set BEFORE the first deploy

# Exact origins the web app is served from. Scheme and host, comma-separated,
# no path and no trailing slash.
REALYTICA_ALLOWED_ORIGINS=https://your-app.example.com
```

Unset, each one throws at startup with a message naming itself, and every
`/api/*` route answers `500 FUNCTION_INVOCATION_FAILED`. The static SPA keeps
serving perfectly throughout, which is what makes this worth stating twice: the
site looks up. Check `/api/health`, not `/`.

Adding a custom domain later means revisiting both — a new origin for the
allowlist and a new authorised origin at the identity provider.
[custom-domain.md](custom-domain.md) is the whole cutover.

### The rest

```bash
# 3. OpenRouter — the only variable the agent layer actually needs
REALYTICA_BASE_URL=https://openrouter.ai/api
REALYTICA_API_KEY=sk-or-v1-...

# Which model each tier runs. Names are OpenRouter's own.
REALYTICA_MODEL_EXTRACTION=anthropic/claude-haiku-4.5
REALYTICA_MODEL_REASONING=google/gemini-2.5-flash
REALYTICA_MODEL_JUDGMENT=anthropic/claude-sonnet-4.5

# 4. Neo4j Aura, if you want the graph to persist across instances
REALYTICA_NEO4J_URL=neo4j+s://xxxxxxxx.databases.neo4j.io
REALYTICA_NEO4J_USER=xxxxxxxx        # NOT always "neo4j" — read the credentials file
REALYTICA_NEO4J_PASSWORD=...
REALYTICA_NEO4J_DATABASE=xxxxxxxx    # omit only if the file says "neo4j"

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
