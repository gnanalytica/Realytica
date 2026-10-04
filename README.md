# Realytica

One workspace for a property's whole life — land, design, approvals, construction, sales and handover, then running the finished building — and for every profession that works on it.

A project moves through **four stages** (Land, Pre-construction, Under construction, Completed), its work is divided into **departments** (Legal, Finance, Engineering, Commercial, Procurement, with Design worked inside Engineering), and each department holds **workstreams** — Title, Approvals, Valuation, Progress — with a living **quick assessment**, the **certified reports** professionals sign, their checks, records and documents. One chat works across all of it; the links between departments live in a Neo4j graph.

| | |
|---|---|
| Web app | `apps/web` — React, Vite, Tailwind |
| API | `apps/api` — Express, one serverless function on Vercel (Mumbai) |
| Site app | `mobile/` — Expo (React Native) for Android and iOS, offline-first |
| Domain | `packages/shared` — the model and every rule that is a pure function of a project |
| Models | `packages/agents` — document reading, the chat, the project orchestrator |

Read next: [what the product does](docs/product.md) · [how it is built](docs/architecture.md) · [how it looks and moves](docs/design.md) · [the API](docs/api.md) · [the site app](docs/mobile.md) · [the demo](docs/demo.md) · [deploying](docs/runbooks/deployment.md) · [sign-in](docs/auth.md)

## Run it

```bash
pnpm install
pnpm dev
```

The web app is on http://localhost:5173 and the API on http://localhost:5174. Node 20.10+ and pnpm 10.

With nothing configured, sign-in is off (every request is a local operator), data lives in `apps/api/data/v2/`, the graph is a local journal file, and document reading uses the bundled OCR. Add a model key to read scans and run the chat on a model; see below.

### Settings

Every variable is prefixed `REALYTICA_`. Put local ones in `.env.local` (git-ignored).

| Variable | What it does |
|---|---|
| `AUTH_MODE` | `off` locally; `google` in production (with `AUTH_CLIENT_ID`, `AUTH_BOOTSTRAP_EMAILS`). See [docs/auth.md](docs/auth.md). |
| `API_KEY`, `BASE_URL` | The model endpoint: Anthropic directly, or a gateway such as OpenRouter. |
| `MODEL_EXTRACTION`, `MODEL_REASONING`, `MODEL_JUDGMENT`, `MODEL_BASIC` | The model each tier runs; `MODEL_BASIC` is the free model the chat tries first. |
| `NEO4J_URL`, `NEO4J_USER`, `NEO4J_PASSWORD`, `NEO4J_DATABASE` | The graph. Required on Vercel; locally the journal stands in. |
| `DATA_DIR` | Where the filesystem store writes. On Vercel a Blob store (`BLOB_STORE_ID`) is used instead. |
| `STORAGE_NAMESPACE` | The data generation, `v2` by default. |
| `GOOGLE_MAPS_API_KEY` | Places and the satellite map. |
| `UNBLOCKER_PROVIDER`, `UNBLOCKER_API_KEY` | Portal comparables search (99acres, MagicBricks). |
| `RESEND_API_KEY`, `ALERT_FROM`, `APP_URL` | Alert emails. Without them alerts stay in the app and on phones. |
| `EXPO_ACCESS_TOKEN` | Optional: authenticates push sends to the site app. |
| `ALLOWED_ORIGINS`, `RATE_LIMIT_*`, `OPERATORS` | Hardening; see [docs/runbooks/deployment.md](docs/runbooks/deployment.md). |

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
packages/shared     The domain: projects, stages, departments, workstreams, checks, approvals,
                    progress, quick assessments, certified reports, alerts, links, the graph
packages/agents     Model calls: document intelligence, the chat, the project orchestrator
packages/site-intel Public map layers and place lookups
test/               Every test, run by `pnpm test`; test/fixtures holds synthetic documents
docs/               Product, architecture, design, API, site app, demo, runbooks
```
