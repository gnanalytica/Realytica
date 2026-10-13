# Realytica

An AI project office that everyone on a building project can work in or connect to.

It takes in every document, in English or any other language. It reads the latest laws and policy changes and works out the action items. It finds by itself where the project has issues and suggests them. For any data or document it tells the people concerned what the information is and what their action item is. It shows analytics and action items at each level: portfolio, project, department, function and person. It answers with sources, fills an empty template or questionnaire from everything on the project, and gives monthly or quarterly reports. People work in it directly, integrate with it, or use connectors from the tools they already have. Eventually it is voice enabled. A named person still accepts what counts.

That is the product as it is defined. Not all of it is built: reading every language, watching the law (listed pages only, and a person confirms), filling a template (Word and Excel), connectors and voice (asking and hearing in the web chat) are partly built, and several parts do nothing until a setting is given. [What is built and what is not](docs/product.md#what-is-built-and-what-is-not) says which, line by line.

A project moves through **four stages** (Land, Pre-construction, Under construction, Completed), its work is divided into **departments** (Legal, Finance, Engineering, Commercial, Procurement, with Design worked inside Engineering), and each department holds **functions** — Title, Approvals, Litigation, Valuation, Budget, Lenders, Progress, Sales, Marketing and forty more, Design's twenty-two among them. Every function but one keeps fixed, **typed fields** that a person fills or links and a paper or a named source offers values for; a model writes none of the words that are kept, and a value it offers counts for nothing until a person accepts it. Eight functions are built in full, with a living **quick assessment**, the **certified reports** professionals sign, their checks, records and documents; the rest are field sheets and documents. [docs/departments.md](docs/departments.md) lists them all. The record keeps its past from this release on: a field says what it held before, a set kept by the week, month or quarter is opened from the last period, compared with it and issued under a name, a project is read as at a past day, and a photo station shows the same place month beside month ([what is tracked over time](docs/product.md#what-is-tracked-over-time), with its limits). One chat works across all of it; the links between departments live in a Neo4j graph.

| | |
|---|---|
| Web app | `apps/web` — React, Vite, Tailwind |
| API | `apps/api` — Express, one serverless function on Vercel (Mumbai) |
| Site app | `mobile/` — Expo (React Native) for Android and iOS, offline-first |
| Domain | `packages/shared` — the model and every rule that is a pure function of a project |
| Models | `packages/agents` — document reading, the chat, the project orchestrator, voice notes put into words |
| Maps | `packages/site-intel` — public map layers, guidance values and place lookups |

Read next: [what the product does](docs/product.md) · [how it is built](docs/architecture.md) · [how it looks and moves](docs/design.md) · [the API](docs/api.md) · [declaring a function's fields](docs/fields.md) · [every department's fields](docs/departments.md) · [the site app](docs/mobile.md) · [the demo](docs/demo.md) · [deploying](docs/runbooks/deployment.md) · [sign-in](docs/auth.md) · [integrations](docs/integrations.md)

## Run it

```bash
pnpm install
pnpm dev
```

The web app is on http://localhost:5173 and the API on http://localhost:5174 (`PORT` moves the API). Node 20.10 or later and pnpm 10; CI runs Node 22 and pnpm 10.33.

With nothing configured, sign-in is off (every request is a local operator), data lives in `apps/api/data/v2/`, the graph is a local journal file, and document reading uses a file's text layer and the bundled OCR (English and Kannada). The chat then answers by rule: what is pending from a party, what changed in cost since the last report, what is running late, what needs you, what is due, a cost figure by name, and opening a report by its month. With no model a cost report with a text layer still offers its package rows to the Cost Report, a technical report its observations, and a tracked list or a tender form loads as it was sent; a scanned cost report's tables are read only as far as the bundled OCR manages, which on the invented scans measured was every row of one and no usable row of another, and the table is then pasted. Add a model key to have a model read what those could not and to run the chat on a model; see below.

### Settings

Every variable is prefixed `REALYTICA_`, except the few a row marks as written in full. Put local ones in `.env.local` (git-ignored).

| Variable | What it does |
|---|---|
| `AUTH_MODE` | `off` locally; `google` in production (with `AUTH_CLIENT_ID`, `AUTH_BOOTSTRAP_EMAILS`). See [docs/auth.md](docs/auth.md). |
| `API_KEY`, `BASE_URL` | The model endpoint: Anthropic directly, or a gateway such as OpenRouter. |
| `MODEL_EXTRACTION`, `MODEL_REASONING`, `MODEL_JUDGMENT`, `MODEL_BASIC` | The model each tier runs; `MODEL_BASIC` is the free model the chat tries first. |
| `MODEL_PAGE_CHECK` | Optional: the model that checks a value against the page it was said to be on. Unset, the extraction model checks its own reading. |
| `MODEL_TRANSCRIPTION` | Optional: the model that puts a voice note into words. It needs a gateway (`BASE_URL`); OpenRouter has a default. |
| `NEO4J_URL`, `NEO4J_USER`, `NEO4J_PASSWORD`, `NEO4J_DATABASE` | The graph. Required on Vercel; locally the journal stands in. |
| `DATA_DIR` | Where the filesystem store writes. On Vercel a Blob store is used instead, named by `BLOB_STORE_ID` or `BLOB_READ_WRITE_TOKEN`: Vercel sets these, and they are written in full, with no prefix. |
| `STORAGE_NAMESPACE` | The data generation, `v2` by default. |
| `GOOGLE_MAPS_API_KEY` | Places and the satellite map. |
| `UNBLOCKER_PROVIDER`, `UNBLOCKER_API_KEY` | Portal comparables search (99acres, MagicBricks). Written in full, with no prefix. |
| `RESEND_API_KEY`, `ALERT_FROM`, `APP_URL` | Alert emails, the mail that tells people of papers filed and values decided and of a period that has fallen due, and the email that tells people a report prepared on the report day is ready to check. Without them all of these stay in the app and on phones, and prepared reports wait on the Reports page. Also the email that says a webhook endpoint is failing. |
| `OUTSIDE_SECRET`, `INBOUND_EMAIL_DOMAIN`, `RESEND_WEBHOOK_SECRET`, `REQUEST_FROM` | Requests by email and their replies, with `RESEND_API_KEY`. Without them a request is only recorded, and the Send dialog says email is not set up. |
| `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE`, `WHATSAPP_TEMPLATE_LANGUAGE`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_GRAPH_VERSION` | Requests by WhatsApp (Meta Cloud API) and their replies. Without them WhatsApp does nothing and says so. |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | A Google Cloud service account's key file, as JSON or base64, with the Drive API enabled. A project's owner shares a Drive folder with that account's address and pastes the folder link under Documents > Connect a folder. Written in full, with no prefix. Without it the screen says the firm has not set this up. |
| `CREDENTIAL_KEY` | Seals stored secrets: flow credentials and webhook signing secrets. Without it no webhook endpoint can be registered. |
| `RATE_LIMIT_KEY` | Requests a minute for one API key under `/api/v1`. 120 by default. See [docs/integrations.md](docs/integrations.md). |
| `EXPO_ACCESS_TOKEN` | Optional: authenticates push sends to the site app. |
| `CRON_SECRET` | The secret Vercel sends with the timers. The daily one brings alerts up to date, tells whoever issues a set kept by period that a period has fallen due, prepares reports on a project's report day, reads the law and policy pages that are due and runs the daily review of each file (four of its six kinds are rules and need no model); notices and webhook retries also come round every ten minutes, and connected folders every hour. Written in full, with no prefix. Without it no timer does anything. |
| `AUTOMATIONS` | `on` mounts `/api/flows` and lets saved flows fire. Off by default, and the web app has no screen for flows. |
| `ALLOWED_ORIGINS`, `RATE_LIMIT_API`, `RATE_LIMIT_MODEL`, `RATE_LIMIT_UPLOAD`, `RATE_LIMIT_PAIRING`, `OPERATORS` | Hardening; see [docs/runbooks/deployment.md](docs/runbooks/deployment.md) and, for `OPERATORS`, [docs/auth.md](docs/auth.md). |
| `VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_MAPS_BROWSER_KEY` | Read when the web app is built, and written in full: the sign-in client, and an optional browser key for the map. |

### Checks

```bash
pnpm check        # typecheck, lint, class and type-scale checks, every test
pnpm test         # the tests alone
pnpm build:vercel # the deployable output in .vercel/output
```

## Repository

```
apps/api            Express API: routes, auth, storage, the graph adapters, document reading
apps/web            The web app
mobile/             The site app (Expo); its own package, outside the pnpm workspace
packages/shared     The domain: projects, stages, departments, functions, checks, approvals,
                    progress, cost, tenders, quick assessments, certified reports, alerts, links, the graph
packages/agents     Model calls: document intelligence, the chat, the project orchestrator
packages/site-intel Public map layers and place lookups
test/               Every test, run by `pnpm test`; test/fixtures holds synthetic documents
evals/              Measurements that need a model key: `pnpm eval`, `eval:reading`, `eval:multilingual`
scripts/            The Vercel build, the lint checks, the document loader and the probes
docs/               Product, architecture, design, API, site app, demo, runbooks
```
