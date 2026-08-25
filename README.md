# Valytica — Property Intelligence

> Understand a property **before** you commit money, professional effort, financing or acquisition
> resources.

Valytica is an AI-powered property intelligence platform. This repository contains the MVP release —
**Valytica Property Screen** — as a local-first, installable `pnpm` application. It answers one
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
| `@valytica/web` | 5173 | Vite + React UI |
| `@valytica/api` | 5174 | Express API, JSON-file store, screening engine |

The API auto-seeds four demo cases (two Indian, two Dutch) on first boot, so the app is populated
the moment it opens. Wipe them from **About → Reset demo data**.

**Requirements:** Node 20.10+ and pnpm 10+. Nothing else — no database, no cloud account, no API key.
Everything runs on your machine and all state lives in `apps/api/data/`.

### Other commands

```bash
pnpm dev:web      # UI only (expects the API on 5174)
pnpm dev:api      # API only
pnpm build        # production build of the web app
pnpm start        # serve the production build alongside the API
pnpm typecheck    # strict typecheck across the whole workspace
pnpm clean        # remove node_modules and build output
```

---

## What Property Screen does

Create a property case, upload whatever documents you have, and run a screen. Valytica produces:

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
valytica/
├── apps/
│   ├── api/                 @valytica/api  — Express + JSON-file store
│   │   ├── src/routes/      cases · documents · screen · reference · demo
│   │   └── data/            your local state (gitignored)
│   └── web/                 @valytica/web  — Vite + React + Tailwind
│       └── src/
│           ├── components/  UI kit, layout, hand-written SVG charts
│           ├── lib/         API client, formatters, theme tokens
│           └── pages/       dashboard · new case · case workspace · compare · about
├── packages/
│   └── shared/              @valytica/shared — domain contract + screening engine
│       └── src/
│           ├── types.ts     the frozen domain model both apps build against
│           ├── engine.ts    classification, extraction, valuation, scoring
│           └── reference.ts country packs and locality market data
└── docs/SOURCE_SPEC.md      the transcribed product definition
```

**Global Core + Country Pack + State/Municipality Pack**, as the specification requires. The core
engine is country-agnostic; India and the Netherlands each supply a country pack (currency, parcel
identifier, expected documents, statutory rate basis, transaction taxes, registry names), and each
locality supplies market data (median price per m², statutory rate, yield, liquidity, zoning, FAR,
replacement cost, an eight-quarter trend).

The screening engine is **deterministic** — seeded by case id, no wall-clock or random input inside
scoring — so the same case always produces the same result and a re-run is diffable. Document
classification and field extraction are simulated locally against filename and document-kind
patterns; there is no external model call and nothing leaves your machine.

### Adding a market

Add a `CountryPack` and its `LocalityReference` entries in `packages/shared/src/reference.ts`. The
engine, the API and every screen pick it up without further change — that is what the pack
architecture buys.

---

## Roadmap (from the product definition)

| Phase | Scope |
| --- | --- |
| 1 — MVP | India, one state/metro, one property type, professional users first |
| 2 | Second property type and geography, comparison, collaboration, deeper diligence, professional review, more data integrations |
| 3 | Netherlands Country Pack |
| 4 | Valytica Project Intelligence |
| 5 | Valytica Portfolio Intelligence |

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
