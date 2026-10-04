# Deploying Realytica

Every variable named here is one the code actually reads — collected by
grepping for it, not from memory. Production runs on Vercel (one function in
`bom1`, Mumbai, beside the static web build), with a private Blob store, Neo4j
Aura, Google sign-in and a model gateway.

## Accounts to create

| # | Account | What it buys | Free tier |
|---|---|---|---|
| 1 | **Vercel** | Hosting. You have this. | Hobby |
| 2 | **Vercel Blob** | Durable project store and uploaded documents. **Required in production** — without it every cold start starts from nothing. | included |
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
no file input. What free models do NOT return is a verified citation, and
nor does Claude through OpenRouter: the gateway strips them. The per-call gap
records that, and each value's page is then checked against the page itself,
from its own text or by showing that page alone to the checking model (below),
so a page on file is never the model's own word.
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

**A second key, for the browser, is optional.** With it the site map draws
Google's satellite and street layers and opens street view inside the map.
Without it the map draws Esri imagery and OpenStreetMap, and street view is a
link to Google Maps. This key is seen by every browser, so restrict it the
other way round: by website, to the production address and the preview
addresses, and by API to the Maps JavaScript API alone. It is read when the
web build is made, so a deployment has to be rebuilt after it is set or
changed. Each street view a person opens is billed by Google as one panorama
load on this key.

→ `VITE_GOOGLE_MAPS_BROWSER_KEY`

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

### The rest

```bash
# 3. OpenRouter — the only variable the agent layer actually needs
REALYTICA_BASE_URL=https://openrouter.ai/api
REALYTICA_API_KEY=sk-or-v1-...

# Which model each tier runs. Names are OpenRouter's own.
REALYTICA_MODEL_EXTRACTION=anthropic/claude-haiku-4.5
REALYTICA_MODEL_REASONING=google/gemini-2.5-flash
REALYTICA_MODEL_JUDGMENT=anthropic/claude-sonnet-4.5
# Optional: the model that checks a value's page when no citation can, shown
# that one page alone. Another vendor's makes the check independent of the
# reading; unset, the extraction model checks its own reading.
REALYTICA_MODEL_PAGE_CHECK=google/gemini-3.8-flash

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
| **Project store** (JSON, in Blob) | the record: every document, check, approval, milestone, site entry, certified report and alert | a nested aggregate read whole; the graph is a projection OF this, so it cannot also be derived from it |
| **Neo4j** | the project graph: stages, departments, workstreams, people and every record placed in them, and the links between departments | the only store that answers "what does this lapse reach", "who answers for it" and "what did we believe in March" |

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

**A preview deployment keeps no graph.** A preview (Vercel's `VERCEL_ENV` is
`preview`) runs a branch against the same project store and the same Neo4j as
production. A branch that draws the graph differently would rewrite every
stored project in its own shape, production would write it back, and a note
pinned to a node only one of them draws would lose its link for good. So a
preview writes nothing to Neo4j and reads nothing from it: every graph it
shows is its own projection of the record, `GET /api/health` answers
`graph: "projection"`, and a note is refused with a 503. Deleting a project on
a preview still removes its graph, because the record itself is gone. The
project record is still shared: what is saved on a preview is saved for
production too.

### Alerts by email and push — optional

```bash
REALYTICA_RESEND_API_KEY=re_...          # a Resend key; without it alerts stay in the app
REALYTICA_ALERT_FROM="Realytica <alerts@yourfirm.in>"   # a sender Resend has verified
REALYTICA_APP_URL=https://your-app.example.com          # the link in the email
REALYTICA_EXPO_ACCESS_TOKEN=...          # optional; authenticates push sends
```

Alerts go only to a department's lead and signer, and only for what is worth
interrupting someone over: an approval expiring or lapsed, a certified report
to revisit, work logged before it is allowed, a late milestone, a serious issue
from site. Phones receive pushes once paired and allowed.

## Data generations

Everything the app stores sits under a generation folder: `v2/store/…` and
`v2/uploads/…` on Blob, `<data dir>/v2/…` on disk (`REALYTICA_STORAGE_NAMESPACE`,
default `v2`). To start clean, deploy with a new generation; the previous one
is left where it was, so rolling the code back finds its own data again.
Nothing is deleted by changing it.

The graph keeps nodes by project id, so a new generation's projects never meet
an old one's. To remove an old generation's nodes from Neo4j once you are sure:

```cypher
MATCH (n:Ryt) WHERE NOT n.projectId IN $liveProjectIds DETACH DELETE n
```

## Releasing

Merging to `main` deploys: Vercel builds `pnpm build:vercel` and promotes it.
Before merging, `pnpm check` passes locally and in CI. After it is live:

1. `GET /api/health` answers `ok`, names the auth mode, and `graph: "neo4j"`.
2. Sign in, open a project, and open a workstream's Connections panel: the
   badge says **Neo4j** when the walk was answered by the graph store.
3. Pair a phone from People and file one site entry.

To roll back, promote the previous deployment in Vercel (instant), and if the
release changed the data generation, the previous generation is still there.

### Going back to v1

Two tags mark where the product stood:

| Tag | Commit | What it is |
|---|---|---|
| `v1-final` | `7628f5a` (#55) | The due-diligence workspace before the v2 revamp |
| `v2-demo` | `3cfae52` (#61) | v2, demo-ready with the Sobha pack in production |

v1 predates data generations: it reads the store and uploads at the storage
root, where its projects still are, and never reads `v2/`. So going back is a
code change only:

```bash
git revert --no-edit v1-final..main   # one revert commit per v2 change, on a branch
```

Open it as a pull request; merging deploys v1 against its own data. The v2
data stays under `v2/` for the way forward again.

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
